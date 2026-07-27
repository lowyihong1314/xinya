"""Live game engine for the 问答游戏 (Kahoot-style quiz).

Question banks live in SQL (models.quiz_game); a running game session is kept in
Redis so it survives across eventlet workers, mirroring app.quiz (the buzzer).
The per-question timer is driven by the host client (no server-side timers), and
the server also auto-reveals once every online player has answered.
"""

import json
import secrets
import string
import time
from copy import deepcopy

from app.redis_client import redis_client
from models import db
from models.quiz_game import QuizGameQuestion, QuizGameSet

GAME_TTL_SECONDS = 12 * 60 * 60
TOKEN_LENGTH = 6
TOKEN_ALPHABET = string.ascii_lowercase + string.digits
DEFAULT_QUESTION_TIME = 30
MIN_QUESTION_TIME = 5
MAX_QUESTION_TIME = 300
MAX_NAME_LENGTH = 24
BASE_GAIN = 500
SPEED_GAIN = 500
STREAK_STEP = 50
MAX_STREAK_BONUS_STEPS = 5


class QuizGameError(ValueError):
    def __init__(self, message, status_code=400, reason=None):
        super().__init__(message)
        self.status_code = status_code
        self.reason = reason or "invalid_request"


def now_ms():
    return time.time_ns() // 1_000_000


# ─────────────────────── keys / helpers ───────────────────────


def normalize_token(value):
    token = str(value or "").strip().lower()
    if not token:
        raise QuizGameError("缺少游戏 token", 400, "missing_token")
    if len(token) > 24 or any(ch not in TOKEN_ALPHABET for ch in token):
        raise QuizGameError("游戏 token 格式不正确", 400, "invalid_token")
    return token


def session_key(token):
    return f"quizg:token:{token}"


def players_key(token):
    return f"quizg:{token}:players"


def answers_key(token):
    return f"quizg:{token}:answers"


def scored_key(token, q_index):
    return f"quizg:{token}:scored:{q_index}"


def sid_map_key():
    return "quizg:sid_map"


def socket_room(token):
    return f"quizg:{token}"


def _json_loads(value):
    if not value:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", "ignore")
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return None


def _json_dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _clean_text(value, limit):
    text = " ".join(str(value or "").strip().split())
    return text[:limit]


def _generate_token():
    return "".join(secrets.choice(TOKEN_ALPHABET) for _ in range(TOKEN_LENGTH))


def _build_token():
    for _ in range(20):
        token = _generate_token()
        if not redis_client.exists(session_key(token)):
            return token
    raise QuizGameError("无法生成游戏 token", 500, "token_generation_failed")


# ─────────────────────── session lifecycle ───────────────────────


def _snapshot_questions(quiz_set):
    questions = []
    for q in quiz_set.questions:
        options = q.options
        if not isinstance(options, list) or len(options) < 2:
            continue
        answer = q.answer if isinstance(q.answer, int) and 0 <= q.answer < len(options) else 0
        questions.append(
            {
                "section": q.section or "",
                "zh": q.zh or "",
                "en": q.en or "",
                "options": options,
                "answer": answer,
            }
        )
    return questions


def _save_session(session):
    current_ms = now_ms()
    next_session = deepcopy(session)
    next_session["updated_at_ms"] = current_ms
    next_session["token_expires_at_ms"] = current_ms + GAME_TTL_SECONDS * 1000
    token = normalize_token(next_session.get("room_token"))
    redis_client.set(session_key(token), _json_dumps(next_session), ex=GAME_TTL_SECONDS)
    return next_session


def get_session(token):
    normalized = normalize_token(token)
    session = _json_loads(redis_client.get(session_key(normalized)))
    if not session:
        return None
    session["room_token"] = normalized
    return session


def require_session(token):
    session = get_session(token)
    if not session:
        raise QuizGameError("游戏不存在或已过期", 404, "session_not_found")
    return session


def create_session(user_id, set_id):
    quiz_set = QuizGameSet.query.get(set_id)
    if not quiz_set:
        raise QuizGameError("题库不存在", 404, "set_not_found")
    questions = _snapshot_questions(quiz_set)
    if not questions:
        raise QuizGameError("题库还没有有效题目", 400, "empty_set")

    token = _build_token()
    current_ms = now_ms()
    session = {
        "room_token": token,
        "set_id": quiz_set.id,
        "title": quiz_set.title,
        "question_time": quiz_set.question_time or DEFAULT_QUESTION_TIME,
        "status": "lobby",
        "q_index": -1,
        "q_ends_at_ms": 0,
        "questions": questions,
        "created_by_user_id": user_id,
        "created_at_ms": current_ms,
    }
    # A fresh room starts with no players / answers.
    redis_client.delete(players_key(token), answers_key(token))
    return _save_session(session)


# ─────────────────────── players / presence ───────────────────────


def _load_players(token):
    raw = redis_client.hgetall(players_key(token)) or {}
    players = {}
    for key, value in raw.items():
        if isinstance(key, bytes):
            key = key.decode("utf-8", "ignore")
        parsed = _json_loads(value)
        if parsed:
            players[key] = parsed
    return players


def _save_player(token, player):
    redis_client.hset(players_key(token), player["id"], _json_dumps(player))
    redis_client.expire(players_key(token), GAME_TTL_SECONDS)


def player_list(token):
    players = _load_players(token)
    rows = [
        {"id": p["id"], "name": p.get("name", ""), "score": p.get("score", 0), "online": bool(p.get("online"))}
        for p in players.values()
    ]
    rows.sort(key=lambda r: r["name"].lower())
    return rows


def online_count(token):
    return sum(1 for p in _load_players(token).values() if p.get("online"))


def leaderboard(token):
    players = _load_players(token)
    ordered = sorted(players.values(), key=lambda p: (-p.get("score", 0), p.get("name", "")))
    return [
        {
            "rank": i + 1,
            "id": p["id"],
            "name": p.get("name", ""),
            "score": p.get("score", 0),
            "lastGain": p.get("lastGain", 0),
            "streak": p.get("streak", 0),
        }
        for i, p in enumerate(ordered)
    ]


def add_player(token, guest_id, guest_name, sid=None):
    session = require_session(token)
    token = session["room_token"]
    guest_id = _clean_text(guest_id, 80) or f"guest_{secrets.token_hex(4)}"
    name = _clean_text(guest_name, MAX_NAME_LENGTH)
    if not name:
        raise QuizGameError("请先输入名字", 400, "missing_name")

    players = _load_players(token)
    player = players.get(guest_id) or {"id": guest_id, "score": 0, "streak": 0, "lastGain": 0}
    player["name"] = name
    player["online"] = True
    _save_player(token, player)
    if sid:
        redis_client.hset(sid_map_key(), sid, f"{token}|{guest_id}")
        redis_client.expire(sid_map_key(), GAME_TTL_SECONDS)
    return session, player


def mark_offline_by_sid(sid):
    if not sid:
        return None
    raw = redis_client.hget(sid_map_key(), sid)
    redis_client.hdel(sid_map_key(), sid)
    if not raw:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "ignore")
    token, _, guest_id = str(raw).partition("|")
    if not token or not guest_id:
        return None
    players = _load_players(token)
    player = players.get(guest_id)
    if not player:
        return None
    player["online"] = False
    _save_player(token, player)
    return token


def kick_player(token, guest_id):
    session = require_session(token)
    token = session["room_token"]
    redis_client.hdel(players_key(token), guest_id)
    redis_client.hdel(answers_key(token), guest_id)
    return session


# ─────────────────────── question / answer helpers ───────────────────────


def _current_question(session):
    index = session.get("q_index", -1)
    questions = session.get("questions") or []
    if index < 0 or index >= len(questions):
        return None
    return questions[index]


def _public_question(session):
    q = _current_question(session)
    if not q:
        return None
    return {
        "index": session["q_index"],
        "total": len(session.get("questions") or []),
        "section": q.get("section", ""),
        "zh": q.get("zh", ""),
        "en": q.get("en", ""),
        "options": q.get("options", []),
        "time": session.get("question_time", DEFAULT_QUESTION_TIME),
        "endsAt": session.get("q_ends_at_ms", 0),
    }


def _answers(token):
    raw = redis_client.hgetall(answers_key(token)) or {}
    answers = {}
    for key, value in raw.items():
        if isinstance(key, bytes):
            key = key.decode("utf-8", "ignore")
        parsed = _json_loads(value)
        if parsed:
            answers[key] = parsed
    return answers


def _reveal_data(session, answers):
    q = _current_question(session)
    counts = [0] * len(q.get("options", [])) if q else []
    for a in answers.values():
        choice = a.get("choice")
        if isinstance(choice, int) and 0 <= choice < len(counts):
            counts[choice] += 1
    return {
        "correct": q.get("answer") if q else None,
        "counts": counts,
        "index": session.get("q_index", -1),
        "total": len(session.get("questions") or []),
    }


def _my_result(session, player, answers):
    q = _current_question(session)
    a = answers.get(player["id"]) if player else None
    board = leaderboard(session["room_token"])
    rank = next((row["rank"] for row in board if row["id"] == player["id"]), None) if player else None
    return {
        "answered": bool(a),
        "choice": a.get("choice") if a else None,
        "correct": bool(a) and q is not None and a.get("choice") == q.get("answer"),
        "gain": player.get("lastGain", 0) if player else 0,
        "score": player.get("score", 0) if player else 0,
        "rank": rank,
        "streak": player.get("streak", 0) if player else 0,
    }


# ─────────────────────── snapshots ───────────────────────


def base_meta(session):
    return {
        "room_token": session["room_token"],
        "set_id": session.get("set_id"),
        "title": session.get("title", ""),
        "status": session.get("status", "lobby"),
        "server_now_ms": now_ms(),
        "token_expires_at_ms": session.get("token_expires_at_ms"),
    }


def host_snapshot(session):
    token = session["room_token"]
    status = session.get("status", "lobby")
    answers = _answers(token)
    snap = base_meta(session)
    snap.update(
        {
            "role": "host",
            "players": player_list(token),
            "player_count": len(_load_players(token)),
            "question": _public_question(session),
            "answered_count": len(answers),
            "reveal": _reveal_data(session, answers) if status == "reveal" else None,
            "leaderboard": leaderboard(token) if status in ("reveal", "podium") else None,
        }
    )
    return snap


def player_snapshot(session, player):
    token = session["room_token"]
    status = session.get("status", "lobby")
    answers = _answers(token)
    mine = answers.get(player["id"]) if player else None
    snap = base_meta(session)
    snap.update(
        {
            "role": "player",
            "me": {
                "id": player["id"],
                "name": player.get("name", ""),
                "score": player.get("score", 0),
            }
            if player
            else None,
            "question": _public_question(session),
            "my_choice": mine.get("choice") if mine else None,
            "reveal": {**_reveal_data(session, answers), "me": _my_result(session, player, answers)}
            if status == "reveal"
            else None,
            "leaderboard": leaderboard(token) if status == "podium" else None,
        }
    )
    return snap


# ─────────────────────── game flow ───────────────────────


def start_question(token, index):
    session = require_session(token)
    token = session["room_token"]
    questions = session.get("questions") or []
    if index >= len(questions):
        return show_podium(token)

    question_time = session.get("question_time", DEFAULT_QUESTION_TIME)
    session["status"] = "question"
    session["q_index"] = index
    session["q_ends_at_ms"] = now_ms() + question_time * 1000
    redis_client.delete(answers_key(token))
    redis_client.delete(scored_key(token, index))

    # New question: clear the previous per-round gain marker.
    players = _load_players(token)
    for player in players.values():
        player["lastGain"] = 0
        _save_player(token, player)

    return _save_session(session)


def record_answer(token, guest_id, choice):
    session = require_session(token)
    token = session["room_token"]
    if session.get("status") != "question":
        raise QuizGameError("现在不能作答", 409, "not_open")
    if now_ms() > session.get("q_ends_at_ms", 0):
        raise QuizGameError("时间到", 409, "time_up")
    q = _current_question(session)
    if not q:
        raise QuizGameError("没有题目", 409, "no_question")
    try:
        choice = int(choice)
    except (TypeError, ValueError):
        raise QuizGameError("无效选项", 400, "invalid_choice")
    if not (0 <= choice < len(q.get("options", []))):
        raise QuizGameError("无效选项", 400, "invalid_choice")

    guest_id = _clean_text(guest_id, 80)
    if guest_id not in _load_players(token):
        raise QuizGameError("请先加入游戏", 409, "not_joined")

    question_time = session.get("question_time", DEFAULT_QUESTION_TIME)
    elapsed_ms = max(0, question_time * 1000 - (session["q_ends_at_ms"] - now_ms()))
    entry = {"choice": choice, "ms": elapsed_ms}
    claimed = redis_client.hsetnx(answers_key(token), guest_id, _json_dumps(entry))
    redis_client.expire(answers_key(token), GAME_TTL_SECONDS)
    if not claimed:
        raise QuizGameError("你已经作答过了", 409, "already_answered")

    answered = len(_answers(token))
    all_answered = answered >= online_count(token) and online_count(token) > 0
    return session, choice, all_answered


def reveal(token):
    """Score the current question and switch to reveal. Idempotent per question."""
    session = require_session(token)
    token = session["room_token"]
    if session.get("status") != "question":
        return session, False

    index = session.get("q_index", -1)
    # Atomic guard so a host 'reveal' and an auto-reveal never double-score.
    if not redis_client.set(scored_key(token, index), "1", nx=True, ex=GAME_TTL_SECONDS):
        return require_session(token), False

    q = _current_question(session)
    question_time = session.get("question_time", DEFAULT_QUESTION_TIME)
    answers = _answers(token)
    players = _load_players(token)

    for guest_id, player in players.items():
        a = answers.get(guest_id)
        if a and q and a.get("choice") == q.get("answer"):
            frac = min(1.0, a.get("ms", 0) / (question_time * 1000))
            gain = BASE_GAIN + round(SPEED_GAIN * (1 - frac))
            player["streak"] = player.get("streak", 0) + 1
            bonus = min(player["streak"] - 1, MAX_STREAK_BONUS_STEPS) * STREAK_STEP
            player["lastGain"] = gain + bonus
            player["score"] = player.get("score", 0) + player["lastGain"]
        else:
            player["streak"] = 0
            player["lastGain"] = 0
        _save_player(token, player)

    session["status"] = "reveal"
    return _save_session(session), True


def next_question(token):
    session = require_session(token)
    token = session["room_token"]
    index = session.get("q_index", -1)
    if index + 1 >= len(session.get("questions") or []):
        return show_podium(token)
    return start_question(token, index + 1)


def show_podium(token):
    session = require_session(token)
    token = session["room_token"]
    session["status"] = "podium"
    session["q_ends_at_ms"] = 0
    return _save_session(session)


def reset_game(token):
    """Back to the lobby, scores cleared. Players stay joined."""
    session = require_session(token)
    token = session["room_token"]
    session["status"] = "lobby"
    session["q_index"] = -1
    session["q_ends_at_ms"] = 0
    redis_client.delete(answers_key(token))
    players = _load_players(token)
    for player in players.values():
        player["score"] = 0
        player["streak"] = 0
        player["lastGain"] = 0
        _save_player(token, player)
    return _save_session(session)
