import json
import secrets
import string
import time
from copy import deepcopy

from app.redis_client import redis_client

QUIZ_TTL_SECONDS = 24 * 60 * 60
TOKEN_LENGTH = 6
TOKEN_ALPHABET = string.ascii_lowercase + string.digits
MAX_QUESTION_LENGTH = 1200
MAX_ANSWER_LENGTH = 240
MAX_ANSWERS = 9


class QuizError(ValueError):
    def __init__(self, message, status_code=400, reason=None):
        super().__init__(message)
        self.status_code = status_code
        self.reason = reason or "invalid_request"


def now_ms():
    return time.time_ns() // 1_000_000


def normalize_token(value):
    token = str(value or "").strip().lower()
    if not token:
        raise QuizError("缺少抢答 token", 400, "missing_token")
    if len(token) > 24 or any(ch not in TOKEN_ALPHABET for ch in token):
        raise QuizError("抢答 token 格式不正确", 400, "invalid_token")
    return token


def session_key(token):
    return f"quiz:token:{token}"


def winner_key(token):
    return f"quiz:{token}:winner"


def socket_room(token):
    return f"quiz:{token}"


def _json_loads(value):
    if not value:
        return None
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return None


def _json_dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _generate_token():
    return "".join(secrets.choice(TOKEN_ALPHABET) for _ in range(TOKEN_LENGTH))


def _build_token():
    for _ in range(20):
        token = _generate_token()
        if not redis_client.exists(session_key(token)):
            return token
    raise QuizError("无法生成抢答 token", 500, "token_generation_failed")


def _default_session(token, user_id=None):
    current_ms = now_ms()
    return {
        "room_token": token,
        "status": "draft",
        "start_at_ms": None,
        "question": "",
        "correct_answer_index": None,
        "answers": [],
        "winner": None,
        "created_by_user_id": user_id,
        "created_at_ms": current_ms,
        "updated_at_ms": current_ms,
        "token_expires_at_ms": current_ms + QUIZ_TTL_SECONDS * 1000,
    }


def _save_session(session):
    current_ms = now_ms()
    next_session = deepcopy(session)
    next_session["updated_at_ms"] = current_ms
    next_session["token_expires_at_ms"] = current_ms + QUIZ_TTL_SECONDS * 1000
    token = normalize_token(next_session.get("room_token"))
    redis_client.set(session_key(token), _json_dumps(next_session), ex=QUIZ_TTL_SECONDS)
    if next_session.get("winner"):
        redis_client.set(winner_key(token), _json_dumps(next_session["winner"]), ex=QUIZ_TTL_SECONDS)
    return next_session


def get_session(token):
    normalized = normalize_token(token)
    session = _json_loads(redis_client.get(session_key(normalized)))
    if not session:
        return None
    session["room_token"] = normalized
    winner = _json_loads(redis_client.get(winner_key(normalized)))
    if winner:
        session["winner"] = winner
    return session


def require_session(token):
    session = get_session(token)
    if not session:
        raise QuizError("抢答活动不存在或已过期", 404, "session_not_found")
    return session


def create_session(user_id=None):
    token = _build_token()
    return _save_session(_default_session(token, user_id=user_id))


def _clean_text(value, limit):
    text = " ".join(str(value or "").strip().split())
    return text[:limit]


def sanitize_config(payload):
    data = payload or {}
    try:
        start_at_ms = int(data.get("start_at_ms"))
    except (TypeError, ValueError):
        raise QuizError("请设置抢答开始时间", 400, "invalid_start_time")
    if start_at_ms <= 0:
        raise QuizError("请设置有效的抢答开始时间", 400, "invalid_start_time")

    question = _clean_text(data.get("question"), MAX_QUESTION_LENGTH)
    if not question:
        raise QuizError("请填写题目", 400, "missing_question")

    raw_answers = data.get("answers")
    if not isinstance(raw_answers, list):
        raise QuizError("请设置答案选项", 400, "invalid_answers")

    answers = []
    used_indexes = set()
    for raw in raw_answers[:MAX_ANSWERS]:
        if not isinstance(raw, dict):
            continue
        try:
            index = int(raw.get("index"))
        except (TypeError, ValueError):
            continue
        if index < 1 or index > MAX_ANSWERS or index in used_indexes:
            continue
        text = _clean_text(raw.get("text"), MAX_ANSWER_LENGTH)
        enabled = bool(raw.get("enabled", True)) and bool(text)
        if not text:
            continue
        used_indexes.add(index)
        answers.append({"index": index, "text": text, "enabled": enabled})

    enabled_indexes = {answer["index"] for answer in answers if answer.get("enabled")}
    if not enabled_indexes:
        raise QuizError("至少需要一个启用答案", 400, "missing_answers")

    try:
        correct_answer_index = int(data.get("correct_answer_index"))
    except (TypeError, ValueError):
        raise QuizError("请选择正确答案", 400, "missing_correct_answer")
    if correct_answer_index not in enabled_indexes:
        raise QuizError("正确答案必须是启用答案", 400, "invalid_correct_answer")

    return {
        "start_at_ms": start_at_ms,
        "question": question,
        "correct_answer_index": correct_answer_index,
        "answers": answers,
    }


def _status_for_session(session, current_ms=None):
    if session.get("winner"):
        return "answered"
    stored_status = session.get("status")
    if stored_status == "closed":
        return "closed"
    if not session.get("start_at_ms") or not session.get("question") or not session.get("answers"):
        return "draft"
    current_ms = current_ms if current_ms is not None else now_ms()
    return "open" if current_ms >= int(session["start_at_ms"]) else "waiting"


def build_snapshot(token_or_session):
    session = token_or_session if isinstance(token_or_session, dict) else require_session(token_or_session)
    current_ms = now_ms()
    status = _status_for_session(session, current_ms)
    config = {
        "start_at_ms": session.get("start_at_ms"),
        "question": session.get("question") or "",
        "correct_answer_index": session.get("correct_answer_index"),
        "answers": session.get("answers") or [],
    }
    return {
        "room_token": session.get("room_token"),
        "status": status,
        "server_now_ms": current_ms,
        "config": config,
        "winner": session.get("winner"),
        "token_expires_at_ms": session.get("token_expires_at_ms"),
    }


def save_config(token, config_payload):
    session = require_session(token)
    config = sanitize_config(config_payload)
    session.update(config)
    session["winner"] = None
    session["status"] = _status_for_session(session)
    redis_client.delete(winner_key(session["room_token"]))
    return _save_session(session)


def publish_session(token):
    session = require_session(token)
    session["status"] = _status_for_session(session)
    return _save_session(session)


def reset_session(token):
    session = require_session(token)
    session["winner"] = None
    session["status"] = _status_for_session(session)
    redis_client.delete(winner_key(session["room_token"]))
    return _save_session(session)


def close_session(token):
    session = require_session(token)
    session["status"] = "closed"
    return _save_session(session)


def _answer_by_index(session, index):
    for answer in session.get("answers") or []:
        if int(answer.get("index")) == int(index) and answer.get("enabled"):
            return answer
    return None


def record_answer(token, guest_id, guest_name, answer_index, client_clicked_at_ms=None):
    session = require_session(token)
    normalized_token = session["room_token"]
    guest_id = _clean_text(guest_id or f"guest_{secrets.token_hex(4)}", 80)
    guest_name = _clean_text(guest_name, 80)
    if not guest_name:
        raise QuizError("请先输入名称", 400, "missing_guest_name")

    try:
        answer_index = int(answer_index)
    except (TypeError, ValueError):
        raise QuizError("请选择答案", 400, "invalid_answer")

    received_at_ms = now_ms()
    if session.get("status") == "closed":
        raise QuizError("抢答已关闭", 409, "closed")
    if not session.get("start_at_ms") or received_at_ms < int(session["start_at_ms"]):
        raise QuizError("抢答还未开始", 409, "too_early")
    if session.get("winner") or redis_client.exists(winner_key(normalized_token)):
        raise QuizError("已经有人抢答成功", 409, "already_answered")

    answer = _answer_by_index(session, answer_index)
    if not answer:
        raise QuizError("答案不可用", 400, "invalid_answer")
    correct_answer_index = session.get("correct_answer_index")
    correct_answer = _answer_by_index(session, correct_answer_index)
    if not correct_answer:
        raise QuizError("正确答案配置不完整", 409, "missing_correct_answer")

    try:
        client_clicked_at_ms = int(client_clicked_at_ms) if client_clicked_at_ms is not None else None
    except (TypeError, ValueError):
        client_clicked_at_ms = None

    winner = {
        "guest_id": guest_id,
        "guest_name": guest_name,
        "answer_index": answer["index"],
        "answer_text": answer["text"],
        "correct_answer_index": correct_answer["index"],
        "correct_answer_text": correct_answer["text"],
        "is_correct": answer["index"] == correct_answer["index"],
        "client_clicked_at_ms": client_clicked_at_ms,
        "server_received_at_ms": received_at_ms,
        "delta_from_start_ms": received_at_ms - int(session["start_at_ms"]),
    }

    claimed = redis_client.set(
        winner_key(normalized_token),
        _json_dumps(winner),
        ex=QUIZ_TTL_SECONDS,
        nx=True,
    )
    if not claimed:
        raise QuizError("已经有人抢答成功", 409, "already_answered")

    session["winner"] = winner
    session["status"] = "answered"
    saved = _save_session(session)
    return build_snapshot(saved)
