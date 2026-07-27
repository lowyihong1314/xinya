from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from models import db
from models.quiz_game import QuizGameQuestion, QuizGameSet

from . import ai, services

quiz_game_bp = Blueprint("quiz_game_bp", __name__)

MAX_TITLE = 255
MAX_QUESTIONS = 200
MAX_OPTIONS = 6
MIN_OPTIONS = 2


def _error(message, status_code=400, reason="invalid_request"):
    return jsonify({"status": "error", "message": message, "reason": reason}), status_code


def _handle_exception(exc):
    if isinstance(exc, services.QuizGameError):
        return _error(str(exc), exc.status_code, exc.reason)
    print("⚠️ Quiz game route error:", exc)
    return _error("问答游戏服务错误", 500, "server_error")


def _clean_text(value, limit):
    return " ".join(str(value or "").strip().split())[:limit]


def _clamp_question_time(raw):
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = services.DEFAULT_QUESTION_TIME
    return max(services.MIN_QUESTION_TIME, min(services.MAX_QUESTION_TIME, value))


def _sanitize_questions(raw_list):
    if not isinstance(raw_list, list):
        raise services.QuizGameError("题目格式不正确", 400, "invalid_questions")
    if len(raw_list) > MAX_QUESTIONS:
        raise services.QuizGameError(f"题目数量不能超过 {MAX_QUESTIONS}", 400, "too_many_questions")

    cleaned = []
    for idx, raw in enumerate(raw_list):
        if not isinstance(raw, dict):
            raise services.QuizGameError(f"第 {idx + 1} 题格式不正确", 400, "invalid_question")
        zh = str(raw.get("zh") or "").strip()
        if not zh:
            raise services.QuizGameError(f"第 {idx + 1} 题缺少题目文字", 400, "missing_question_text")

        raw_options = raw.get("options")
        if not isinstance(raw_options, list):
            raise services.QuizGameError(f"第 {idx + 1} 题选项格式不正确", 400, "invalid_options")
        options = []
        for opt in raw_options:
            if isinstance(opt, dict):
                opt_zh = str(opt.get("zh") or "").strip()
                opt_en = str(opt.get("en") or "").strip()
            else:
                opt_zh = str(opt or "").strip()
                opt_en = ""
            if opt_zh or opt_en:
                options.append({"zh": opt_zh, "en": opt_en})
        if len(options) < MIN_OPTIONS:
            raise services.QuizGameError(f"第 {idx + 1} 题至少需要 {MIN_OPTIONS} 个选项", 400, "too_few_options")
        if len(options) > MAX_OPTIONS:
            raise services.QuizGameError(f"第 {idx + 1} 题选项不能超过 {MAX_OPTIONS} 个", 400, "too_many_options")

        try:
            answer = int(raw.get("answer", 0))
        except (TypeError, ValueError):
            answer = 0
        if not (0 <= answer < len(options)):
            raise services.QuizGameError(f"第 {idx + 1} 题的正确答案超出范围", 400, "invalid_answer")

        cleaned.append(
            {
                "section": _clean_text(raw.get("section"), 255),
                "zh": zh,
                "en": str(raw.get("en") or "").strip(),
                "options": options,
                "answer": answer,
            }
        )
    return cleaned


# ─────────────────────── question-set CRUD ───────────────────────


@quiz_game_bp.route("/sets", methods=["GET"])
@login_required
def list_sets():
    try:
        sets = QuizGameSet.query.order_by(QuizGameSet.position.asc(), QuizGameSet.id.asc()).all()
        return jsonify({"status": "success", "sets": [s.to_dict() for s in sets]})
    except Exception as exc:
        return _handle_exception(exc)


@quiz_game_bp.route("/sets", methods=["POST"])
@login_required
def create_set():
    try:
        payload = request.get_json(silent=True) or {}
        title = _clean_text(payload.get("title"), MAX_TITLE)
        if not title:
            raise services.QuizGameError("请填写题库名称", 400, "missing_title")
        max_pos = db.session.query(db.func.max(QuizGameSet.position)).scalar() or 0
        quiz_set = QuizGameSet(
            title=title,
            description=str(payload.get("description") or "").strip() or None,
            question_time=_clamp_question_time(payload.get("question_time")),
            position=max_pos + 1,
            created_by_user_id=getattr(current_user, "id", None),
        )
        db.session.add(quiz_set)
        db.session.flush()
        if isinstance(payload.get("questions"), list):
            _replace_questions(quiz_set, payload["questions"])
        db.session.commit()
        return jsonify({"status": "success", "set": quiz_set.to_dict(with_questions=True)})
    except Exception as exc:
        db.session.rollback()
        return _handle_exception(exc)


@quiz_game_bp.route("/sets/<int:set_id>", methods=["GET"])
@login_required
def get_set(set_id):
    try:
        quiz_set = QuizGameSet.query.get(set_id)
        if not quiz_set:
            raise services.QuizGameError("题库不存在", 404, "set_not_found")
        return jsonify({"status": "success", "set": quiz_set.to_dict(with_questions=True)})
    except Exception as exc:
        return _handle_exception(exc)


@quiz_game_bp.route("/sets/<int:set_id>", methods=["PUT", "PATCH"])
@login_required
def update_set(set_id):
    try:
        quiz_set = QuizGameSet.query.get(set_id)
        if not quiz_set:
            raise services.QuizGameError("题库不存在", 404, "set_not_found")
        payload = request.get_json(silent=True) or {}
        if "title" in payload:
            title = _clean_text(payload.get("title"), MAX_TITLE)
            if not title:
                raise services.QuizGameError("请填写题库名称", 400, "missing_title")
            quiz_set.title = title
        if "description" in payload:
            quiz_set.description = str(payload.get("description") or "").strip() or None
        if "question_time" in payload:
            quiz_set.question_time = _clamp_question_time(payload.get("question_time"))
        if "is_archived" in payload:
            quiz_set.is_archived = bool(payload.get("is_archived"))
        if isinstance(payload.get("questions"), list):
            _replace_questions(quiz_set, payload["questions"])
        db.session.commit()
        return jsonify({"status": "success", "set": quiz_set.to_dict(with_questions=True)})
    except Exception as exc:
        db.session.rollback()
        return _handle_exception(exc)


@quiz_game_bp.route("/sets/<int:set_id>", methods=["DELETE"])
@login_required
def delete_set(set_id):
    try:
        quiz_set = QuizGameSet.query.get(set_id)
        if not quiz_set:
            raise services.QuizGameError("题库不存在", 404, "set_not_found")
        db.session.delete(quiz_set)
        db.session.commit()
        return jsonify({"status": "success"})
    except Exception as exc:
        db.session.rollback()
        return _handle_exception(exc)


@quiz_game_bp.route("/sets/<int:set_id>/questions", methods=["PUT"])
@login_required
def replace_questions(set_id):
    try:
        quiz_set = QuizGameSet.query.get(set_id)
        if not quiz_set:
            raise services.QuizGameError("题库不存在", 404, "set_not_found")
        payload = request.get_json(silent=True) or {}
        _replace_questions(quiz_set, payload.get("questions"))
        db.session.commit()
        return jsonify({"status": "success", "set": quiz_set.to_dict(with_questions=True)})
    except Exception as exc:
        db.session.rollback()
        return _handle_exception(exc)


def _replace_questions(quiz_set, raw_questions):
    cleaned = _sanitize_questions(raw_questions or [])
    QuizGameQuestion.query.filter_by(set_id=quiz_set.id).delete()
    for position, item in enumerate(cleaned):
        question = QuizGameQuestion(
            set_id=quiz_set.id,
            position=position,
            section=item["section"] or None,
            zh=item["zh"],
            en=item["en"] or None,
            answer=item["answer"],
        )
        question.options = item["options"]
        db.session.add(question)


# ─────────────────────── AI 出题助手 ───────────────────────


@quiz_game_bp.route("/ai/generate", methods=["POST"])
@login_required
def ai_generate_questions():
    try:
        payload = request.get_json(silent=True) or {}
        questions = ai.generate_questions(
            payload.get("prompt"),
            count=payload.get("count", 5),
            set_title=_clean_text(payload.get("set_title"), MAX_TITLE),
        )
        return jsonify({"status": "success", "questions": questions})
    except ValueError as exc:
        return _error(str(exc), 400, "ai_error")
    except Exception as exc:
        return _handle_exception(exc)


# ─────────────────────── live game session ───────────────────────


@quiz_game_bp.route("/session", methods=["POST"])
@login_required
def create_game_session():
    try:
        payload = request.get_json(silent=True) or {}
        set_id = payload.get("set_id")
        if not set_id:
            raise services.QuizGameError("请选择题库", 400, "missing_set_id")
        session = services.create_session(getattr(current_user, "id", None), int(set_id))
        return jsonify(
            {
                "status": "success",
                "token": session["room_token"],
                "session": services.host_snapshot(session),
            }
        )
    except Exception as exc:
        return _handle_exception(exc)


@quiz_game_bp.route("/session/<token>", methods=["GET"])
def get_game_session(token):
    """Public: lets a guest load the room title/status before joining."""
    try:
        session = services.require_session(token)
        snap = services.base_meta(session)
        snap.update(
            {
                "player_count": len(services._load_players(session["room_token"])),
                "total_questions": len(session.get("questions") or []),
            }
        )
        return jsonify({"status": "success", "session": snap})
    except Exception as exc:
        return _handle_exception(exc)
