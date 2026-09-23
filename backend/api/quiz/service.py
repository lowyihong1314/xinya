"""抢答（快速抢答墙）的业务逻辑。原 app/quiz/services.py，**逐字平移**。

状态全在 Redis 里，没有一张表：
    quiz:token:{token}    一个 JSON，就是整场活动（标题 / 等待秒数 / 发布时刻 / 截止时刻）
    quiz:{token}:entries  hash，guest_id → 一条抢答记录（hsetnx 保证一人一次）
    quiz:{token}:guests   set，在场 guest_id，用来算 player_count
    quiz:sid_map          hash，连接 id → "{token}|{guest_id}"，断线时按它把人从 guests 里摘掉

★ 这次只搬了文件位置，函数体一个字没改 —— 包括下面几处「看着像 bug 但故意保留」的地方：

  ① ``_status_for_session`` 里 ``published`` 之后先是 "waiting"，到了 cutoff 才变 "open"。
     也就是说 wait_seconds 是**倒计时**，不是「开放时长」；抢答一旦开放就永不自动关闭，
     只能由主持人 close/reset。前端的三个状态按钮就是按这个语义画的。

  ② ``guest_count`` 把所有异常吞成 0（``except Exception: return 0``）。
     Redis 抖一下的时候页面上人数会瞬间归零而不是报错 —— 这是有意的降级，
     人数只是展示位，不值得把整个 snapshot 拖成 500。

  ③ ``record_tap`` 里 ``received_at_ms < int(cutoff)`` 回的是 "too_early"，
     但 ``status`` 此时一定是 "waiting"，所以这条分支和上面 not_published 的文案重复
     （都是「抢答还未开始」），只有 reason 不同。前端按 reason 分支，别合并。

  ④ ``socket_room()`` 现在**只有还没搬的 app/socket_events.py 在用**。
     SSE 那边的频道由 core.realtime.channel_of("quiz", token) 自己拼，
     千万别把这个函数的返回值当 room_id 传给 publish_sync —— 那会拼成 rt:quiz:quiz:{token}。
     等入向事件搬完，这个函数连同 sid_map_key 一起删。
"""

import json
import secrets
import string
import time
from copy import deepcopy

from backend.core.redis import redis_client

QUIZ_TTL_SECONDS = 24 * 60 * 60
TOKEN_LENGTH = 6
TOKEN_ALPHABET = string.ascii_lowercase + string.digits
MAX_TITLE_LENGTH = 240
DEFAULT_WAIT_SECONDS = 6
MIN_WAIT_SECONDS = 3
MAX_WAIT_SECONDS = 600
MAX_LEADERBOARD = 500
GUEST_TTL_SECONDS = 2 * 60 * 60


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


def entries_key(token):
    return f"quiz:{token}:entries"


def guests_key(token):
    return f"quiz:{token}:guests"


def sid_map_key():
    return "quiz:sid_map"


def socket_room(token):
    # ⚠️ 只给还没搬的 Socket.IO 入向事件用。SSE 走 publish_sync("quiz", token, ...)，
    #    room_id 传裸 token，前缀由 core.realtime.channel_of 拼，别传这个函数的返回值。
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
        "title": "",
        "wait_seconds": DEFAULT_WAIT_SECONDS,
        "cutoff_at_ms": None,
        "published_at_ms": None,
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
    title = _clean_text(data.get("title"), MAX_TITLE_LENGTH)

    raw_wait = data.get("wait_seconds", DEFAULT_WAIT_SECONDS)
    try:
        wait_seconds = int(raw_wait)
    except (TypeError, ValueError):
        raise QuizError("请设置有效的等待秒数", 400, "invalid_wait_seconds")
    if wait_seconds < MIN_WAIT_SECONDS or wait_seconds > MAX_WAIT_SECONDS:
        raise QuizError(
            f"等待秒数需在 {MIN_WAIT_SECONDS}~{MAX_WAIT_SECONDS} 之间",
            400,
            "invalid_wait_seconds",
        )

    return {"title": title, "wait_seconds": wait_seconds}


# ─────────────────────── 在场人数（谁还开着页面） ───────────────────────


def add_guest(token, guest_id, sid=None):
    normalized = normalize_token(token)
    guest_id = _clean_text(guest_id, 80)
    if not guest_id:
        return guest_count(normalized)
    redis_client.sadd(guests_key(normalized), guest_id)
    redis_client.expire(guests_key(normalized), GUEST_TTL_SECONDS)
    if sid:
        redis_client.hset(sid_map_key(), sid, f"{normalized}|{guest_id}")
    return guest_count(normalized)


def remove_guest_by_sid(sid):
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
    redis_client.srem(guests_key(token), guest_id)
    return token


def guest_count(token):
    try:
        return int(redis_client.scard(guests_key(normalize_token(token))))
    except Exception:
        return 0


# ─────────────────────── 抢答榜 ───────────────────────


def _load_entries(token):
    raw = redis_client.hgetall(entries_key(token)) or {}
    entries = []
    for value in raw.values():
        if isinstance(value, bytes):
            value = value.decode("utf-8", "ignore")
        parsed = _json_loads(value)
        if parsed:
            entries.append(parsed)
    entries.sort(key=lambda item: item.get("server_received_at_ms", 0))
    leaderboard = []
    for rank, entry in enumerate(entries[:MAX_LEADERBOARD], start=1):
        row = dict(entry)
        row["rank"] = rank
        leaderboard.append(row)
    return leaderboard


def _clear_entries(token):
    redis_client.delete(entries_key(token))


def _status_for_session(session, current_ms=None):
    stored_status = session.get("status")
    if stored_status == "closed":
        return "closed"
    cutoff = session.get("cutoff_at_ms")
    if not cutoff or not session.get("published_at_ms"):
        return "draft"
    current_ms = current_ms if current_ms is not None else now_ms()
    return "open" if current_ms >= int(cutoff) else "waiting"


def build_snapshot(token_or_session):
    session = token_or_session if isinstance(token_or_session, dict) else require_session(token_or_session)
    token = session.get("room_token")
    current_ms = now_ms()
    status = _status_for_session(session, current_ms)
    return {
        "room_token": token,
        "status": status,
        "server_now_ms": current_ms,
        "config": {
            "title": session.get("title") or "",
            "wait_seconds": session.get("wait_seconds") or DEFAULT_WAIT_SECONDS,
        },
        "cutoff_at_ms": session.get("cutoff_at_ms"),
        "published_at_ms": session.get("published_at_ms"),
        "player_count": guest_count(token) if token else 0,
        "leaderboard": _load_entries(token) if token else [],
        "token_expires_at_ms": session.get("token_expires_at_ms"),
    }


def save_config(token, config_payload):
    session = require_session(token)
    config = sanitize_config(config_payload)
    session.update(config)
    return _save_session(session)


def publish_session(token):
    session = require_session(token)
    wait_seconds = session.get("wait_seconds") or DEFAULT_WAIT_SECONDS
    published_at = now_ms()
    session["published_at_ms"] = published_at
    session["cutoff_at_ms"] = published_at + int(wait_seconds) * 1000
    session["status"] = "waiting"
    _clear_entries(session["room_token"])
    return _save_session(session)


def reset_session(token):
    """退回发布页：清掉这一轮的发布时刻、截止时刻和整张榜。"""
    session = require_session(token)
    session["published_at_ms"] = None
    session["cutoff_at_ms"] = None
    session["status"] = "draft"
    _clear_entries(session["room_token"])
    return _save_session(session)


def close_session(token):
    session = require_session(token)
    session["status"] = "closed"
    return _save_session(session)


def record_tap(token, guest_id, guest_name, client_clicked_at_ms=None):
    session = require_session(token)
    normalized_token = session["room_token"]
    guest_id = _clean_text(guest_id or f"guest_{secrets.token_hex(4)}", 80)
    guest_name = _clean_text(guest_name, 80)
    if not guest_name:
        raise QuizError("请先输入名称", 400, "missing_guest_name")

    received_at_ms = now_ms()
    status = _status_for_session(session, received_at_ms)
    if status == "closed":
        raise QuizError("抢答已关闭", 409, "closed")
    cutoff = session.get("cutoff_at_ms")
    if not cutoff or not session.get("published_at_ms"):
        raise QuizError("抢答还未开始", 409, "not_published")
    if received_at_ms < int(cutoff):
        raise QuizError("抢答还未开始", 409, "too_early")

    try:
        client_clicked_at_ms = int(client_clicked_at_ms) if client_clicked_at_ms is not None else None
    except (TypeError, ValueError):
        client_clicked_at_ms = None

    entry = {
        "guest_id": guest_id,
        "guest_name": guest_name,
        "client_clicked_at_ms": client_clicked_at_ms,
        "server_received_at_ms": received_at_ms,
        "delta_from_cutoff_ms": received_at_ms - int(cutoff),
    }

    # hsetnx = 一个 guest 只认第一次，之后再点静默算「已抢过」。
    # 用 hsetnx 而不是「先 hexists 再 hset」：后者两步之间有窗口，
    # 同一个人狂点时能塞进两条，榜上就会出现重名。
    claimed = redis_client.hsetnx(entries_key(normalized_token), guest_id, _json_dumps(entry))
    redis_client.expire(entries_key(normalized_token), QUIZ_TTL_SECONDS)
    if not claimed:
        raise QuizError("你已经抢答过了", 409, "already_tapped")

    return build_snapshot(session)
