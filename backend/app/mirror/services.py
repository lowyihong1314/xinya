"""Room engine for 「别人眼中的我」 — the anonymous peer-respect rating activity.

Everything lives in Redis (like app.quiz / app.quiz_game) so a room survives
across eventlet workers and expires on its own; nothing is written to SQL,
because the whole point of the activity is that the scores are throwaway and
anonymous.

Anonymity rules baked into this module:
  * a rating is stored under the **rater's** hash (rater -> target -> score) and
    is never handed to any client; only aggregates leave the server,
  * a member only ever receives their own result (see ``player_snapshot``),
  * the host screen only sees group-level numbers plus who has finished,
  * a result stays hidden until it is backed by at least ``min_reveal_count``
    real scores, so nobody can reverse-engineer "who gave me the 2".
"""

import base64
import binascii
import hashlib
import json
import secrets
import string
import time
from copy import deepcopy

from backend.core.redis import redis_client

MIRROR_TTL_SECONDS = 12 * 60 * 60
TOKEN_LENGTH = 6
TOKEN_ALPHABET = string.ascii_lowercase + string.digits
MAX_NAME_LENGTH = 24
MAX_TITLE_LENGTH = 120
DEFAULT_TITLE = "别人眼中的我"
SCORE_MIN = 1
SCORE_MAX = 5
SKIP_VALUE = "skip"
DEFAULT_MIN_REVEAL = 3
# A face photo is downscaled on the phone before it is sent; this cap is just a
# backstop against someone posting a full-size picture into the room.
MAX_PHOTO_BYTES = 400 * 1024
PHOTO_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
MIN_MIN_REVEAL = 1
MAX_MIN_REVEAL = 20


class MirrorError(ValueError):
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
        raise MirrorError("缺少活动 token", 400, "missing_token")
    if len(token) > 24 or any(ch not in TOKEN_ALPHABET for ch in token):
        raise MirrorError("活动 token 格式不正确", 400, "invalid_token")
    return token


def session_key(token):
    return f"mirror:token:{token}"


def members_key(token):
    return f"mirror:{token}:members"


def ratings_key(token, rater_id):
    """rater -> {target_id: score}. The only place a rating is ever stored."""
    return f"mirror:{token}:r:{rater_id}"


def photos_key(token):
    """member_id -> "<mime>|<base64>". Faces live and die with the room."""
    return f"mirror:{token}:photos"


def sid_map_key():
    return "mirror:sid_map"


def socket_room(token):
    return f"mirror:{token}"


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


def _decode(value):
    if isinstance(value, bytes):
        return value.decode("utf-8", "ignore")
    return value


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
    raise MirrorError("无法生成活动 token", 500, "token_generation_failed")


def clamp_min_reveal(raw):
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = DEFAULT_MIN_REVEAL
    return max(MIN_MIN_REVEAL, min(MAX_MIN_REVEAL, value))


# ─────────────────────── session lifecycle ───────────────────────


def _save_session(session):
    current_ms = now_ms()
    next_session = deepcopy(session)
    next_session["updated_at_ms"] = current_ms
    next_session["token_expires_at_ms"] = current_ms + MIRROR_TTL_SECONDS * 1000
    token = normalize_token(next_session.get("room_token"))
    redis_client.set(session_key(token), _json_dumps(next_session), ex=MIRROR_TTL_SECONDS)
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
        raise MirrorError("活动不存在或已过期", 404, "session_not_found")
    return session


def create_session(user_id=None, title=None, min_reveal_count=None):
    token = _build_token()
    current_ms = now_ms()
    session = {
        "room_token": token,
        "title": _clean_text(title, MAX_TITLE_LENGTH) or DEFAULT_TITLE,
        "status": "lobby",
        "min_reveal_count": clamp_min_reveal(min_reveal_count),
        "roster": [],
        "created_by_user_id": user_id,
        "created_at_ms": current_ms,
        "started_at_ms": None,
        "revealed_at_ms": None,
    }
    _clear_ratings(token, [])
    redis_client.delete(members_key(token))
    return _save_session(session)


def save_config(token, payload):
    session = require_session(token)
    data = payload or {}
    if "title" in data:
        session["title"] = _clean_text(data.get("title"), MAX_TITLE_LENGTH) or DEFAULT_TITLE
    if "min_reveal_count" in data:
        session["min_reveal_count"] = clamp_min_reveal(data.get("min_reveal_count"))
    return _save_session(session)


# ─────────────────────── members / presence ───────────────────────


def _load_members(token):
    raw = redis_client.hgetall(members_key(token)) or {}
    members = {}
    for key, value in raw.items():
        parsed = _json_loads(value)
        if parsed:
            members[_decode(key)] = parsed
    return members


def _save_member(token, member):
    redis_client.hset(members_key(token), member["id"], _json_dumps(member))
    redis_client.expire(members_key(token), MIRROR_TTL_SECONDS)


def member_list(token):
    members = _load_members(token)
    rows = [
        {
            "id": m["id"],
            "name": m.get("name", ""),
            "online": bool(m.get("online")),
            "joined_at_ms": m.get("joined_at_ms", 0),
            "photo_at_ms": m.get("photo_at_ms") or 0,
        }
        for m in members.values()
    ]
    rows.sort(key=lambda row: (row.get("joined_at_ms", 0), row.get("name", "")))
    return rows


def add_member(token, guest_id, guest_name, sid=None):
    session = require_session(token)
    token = session["room_token"]
    guest_id = _clean_text(guest_id, 80) or f"m_{secrets.token_hex(4)}"
    name = _clean_text(guest_name, MAX_NAME_LENGTH)
    if not name:
        raise MirrorError("请先输入名字", 400, "missing_name")

    members = _load_members(token)
    member = members.get(guest_id) or {"id": guest_id, "joined_at_ms": now_ms()}
    member["name"] = name
    member["online"] = True
    _save_member(token, member)
    if sid:
        redis_client.hset(sid_map_key(), sid, f"{token}|{guest_id}")
        redis_client.expire(sid_map_key(), MIRROR_TTL_SECONDS)
    return session, member


def mark_offline_by_sid(sid):
    if not sid:
        return None
    raw = redis_client.hget(sid_map_key(), sid)
    redis_client.hdel(sid_map_key(), sid)
    raw = _decode(raw)
    if not raw:
        return None
    token, _, guest_id = str(raw).partition("|")
    if not token or not guest_id:
        return None
    member = _load_members(token).get(guest_id)
    if not member:
        return None
    member["online"] = False
    _save_member(token, member)
    return token


def remove_member(token, guest_id):
    session = require_session(token)
    token = session["room_token"]
    guest_id = _clean_text(guest_id, 80)
    if not guest_id:
        return session
    redis_client.hdel(members_key(token), guest_id)
    redis_client.hdel(photos_key(token), guest_id)
    redis_client.delete(ratings_key(token, guest_id))
    return session


# ─────────────────────── selfies ───────────────────────


def _parse_photo_data_url(value):
    raw = str(value or "").strip()
    if not raw.startswith("data:"):
        raise MirrorError("照片格式不正确", 400, "invalid_photo")
    header, _, payload = raw.partition(",")
    if not payload or ";base64" not in header:
        raise MirrorError("照片格式不正确", 400, "invalid_photo")
    mime = header[len("data:") : header.index(";")].strip().lower()
    if mime not in PHOTO_MIME_TYPES:
        raise MirrorError("只接受 JPEG / PNG / WebP 照片", 400, "invalid_photo_type")
    try:
        blob = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        raise MirrorError("照片解码失败", 400, "invalid_photo")
    if not blob:
        raise MirrorError("照片是空的", 400, "invalid_photo")
    if len(blob) > MAX_PHOTO_BYTES:
        raise MirrorError("照片太大了，请重拍", 413, "photo_too_large")
    return mime, payload


def save_photo(token, guest_id, data_url):
    session = require_session(token)
    token = session["room_token"]
    guest_id = _clean_text(guest_id, 80)
    member = _load_members(token).get(guest_id)
    if not member:
        raise MirrorError("请先加入活动", 409, "not_joined")

    mime, payload = _parse_photo_data_url(data_url)
    redis_client.hset(photos_key(token), guest_id, f"{mime}|{payload}")
    redis_client.expire(photos_key(token), MIRROR_TTL_SECONDS)
    member["photo_at_ms"] = now_ms()
    _save_member(token, member)
    return session, member


def get_photo(token, guest_id):
    """Return (bytes, mime) for a member's selfie, or None."""
    token = normalize_token(token)
    raw = redis_client.hget(photos_key(token), _clean_text(guest_id, 80))
    raw = _decode(raw)
    if not raw:
        return None
    mime, _, payload = str(raw).partition("|")
    if not payload or mime not in PHOTO_MIME_TYPES:
        return None
    try:
        return base64.b64decode(payload), mime
    except (binascii.Error, ValueError):
        return None


def has_photo(token, guest_id):
    return bool(redis_client.hexists(photos_key(token), _clean_text(guest_id, 80)))


# ─────────────────────── ratings ───────────────────────


def _roster(session):
    roster = session.get("roster") or []
    return [row for row in roster if isinstance(row, dict) and row.get("id")]


def _roster_ids(session):
    return [row["id"] for row in _roster(session)]


def _clear_ratings(token, member_ids):
    keys = [ratings_key(token, member_id) for member_id in member_ids]
    if keys:
        redis_client.delete(*keys)


def _rater_scores(token, rater_id):
    raw = redis_client.hgetall(ratings_key(token, rater_id)) or {}
    return {_decode(key): _decode(value) for key, value in raw.items()}


def _rated_count(token, rater_id):
    try:
        return int(redis_client.hlen(ratings_key(token, rater_id)))
    except Exception:
        return 0


def targets_for(session, rater_id):
    """Everyone else in the roster, in a stable per-rater shuffled order.

    The order is derived from (rater_id, target_id) so the cards come up in a
    different sequence for each person — nobody can line up "the 3rd card" with
    a neighbour's screen — yet a reconnect rebuilds the exact same sequence.
    """
    others = [row for row in _roster(session) if row["id"] != rater_id]
    token = session.get("room_token", "")

    def sort_key(row):
        seed = f"{token}|{rater_id}|{row['id']}".encode("utf-8")
        return hashlib.sha1(seed).hexdigest()

    return sorted(others, key=sort_key)


def is_finished(session, token, rater_id):
    expected = max(0, len(_roster_ids(session)) - 1)
    if expected == 0:
        return True
    return _rated_count(token, rater_id) >= expected


def finished_ids(session, token):
    return [member_id for member_id in _roster_ids(session) if is_finished(session, token, member_id)]


def normalize_score(raw):
    if isinstance(raw, str) and raw.strip().lower() == SKIP_VALUE:
        return SKIP_VALUE
    try:
        score = int(raw)
    except (TypeError, ValueError):
        raise MirrorError("评分无效", 400, "invalid_score")
    if not (SCORE_MIN <= score <= SCORE_MAX):
        raise MirrorError("评分无效", 400, "invalid_score")
    return str(score)


def record_rating(token, rater_id, target_id, score):
    session = require_session(token)
    token = session["room_token"]
    if session.get("status") != "rating":
        raise MirrorError("现在不能评分", 409, "not_open")

    rater_id = _clean_text(rater_id, 80)
    target_id = _clean_text(target_id, 80)
    roster_ids = _roster_ids(session)
    if rater_id not in roster_ids:
        raise MirrorError("你不在本轮名单里", 409, "not_in_roster")
    if target_id not in roster_ids:
        raise MirrorError("对方不在本轮名单里", 409, "target_not_in_roster")
    if rater_id == target_id:
        raise MirrorError("不能评价自己", 400, "self_rating")

    value = normalize_score(score)
    # First answer per target wins; a double-tap is a harmless no-op.
    redis_client.hsetnx(ratings_key(token, rater_id), target_id, value)
    redis_client.expire(ratings_key(token, rater_id), MIRROR_TTL_SECONDS)

    all_done = len(finished_ids(session, token)) >= len(roster_ids) and len(roster_ids) > 0
    return session, all_done


def _tally(token, session, target_id):
    """Aggregate every score handed to ``target_id``. Raters stay unnamed."""
    counts = [0, 0, 0, 0, 0]
    skipped = 0
    total = 0
    for rater_id in _roster_ids(session):
        if rater_id == target_id:
            continue
        value = _rater_scores(token, rater_id).get(target_id)
        if value is None:
            continue
        if value == SKIP_VALUE:
            skipped += 1
            continue
        try:
            score = int(value)
        except (TypeError, ValueError):
            continue
        if SCORE_MIN <= score <= SCORE_MAX:
            counts[score - 1] += 1
            total += score
    rated = sum(counts)
    return {"counts": counts, "skipped": skipped, "rated": rated, "total": total}


def personal_result(token, session, target_id):
    tally = _tally(token, session, target_id)
    min_reveal = clamp_min_reveal(session.get("min_reveal_count"))
    visible = tally["rated"] >= min_reveal
    average = round(tally["total"] / tally["rated"], 2) if tally["rated"] else None
    return {
        "rated_count": tally["rated"],
        "skipped_count": tally["skipped"],
        "peer_count": max(0, len(_roster_ids(session)) - 1),
        "min_reveal_count": min_reveal,
        "visible": visible,
        "average": average if visible else None,
        "counts": tally["counts"] if visible else None,
    }



# ─────────────────────── flow ───────────────────────


def _photo_stamps(token):
    members = _load_members(token)
    return {mid: (m.get("photo_at_ms") or 0) for mid, m in members.items()}


def start_round(token):
    """Freeze the roster from whoever is in the lobby and open rating."""
    session = require_session(token)
    token = session["room_token"]
    members = member_list(token)
    if len(members) < 2:
        raise MirrorError("至少需要 2 位成员才能开始", 400, "not_enough_members")

    # Wipe anything left over from an earlier round, including people who have
    # since left the room.
    _clear_ratings(token, sorted({row["id"] for row in members} | set(_roster_ids(session))))
    session["roster"] = [
        {"id": row["id"], "name": row["name"], "photo_at_ms": row.get("photo_at_ms") or 0} for row in members
    ]
    session["status"] = "rating"
    session["started_at_ms"] = now_ms()
    session["revealed_at_ms"] = None
    return _save_session(session)


def reveal_results(token):
    session = require_session(token)
    if session.get("status") == "reveal":
        return session, False
    if session.get("status") != "rating":
        raise MirrorError("还没有开始评分", 409, "not_rating")
    session["status"] = "reveal"
    session["revealed_at_ms"] = now_ms()
    return _save_session(session), True


def reset_round(token):
    """Back to the lobby with every rating wiped. Members stay joined."""
    session = require_session(token)
    token = session["room_token"]
    member_ids = {row["id"] for row in member_list(token)} | set(_roster_ids(session))
    _clear_ratings(token, sorted(member_ids))
    session["roster"] = []
    session["status"] = "lobby"
    session["started_at_ms"] = None
    session["revealed_at_ms"] = None
    return _save_session(session)


# ─────────────────────── snapshots ───────────────────────


def base_meta(session):
    return {
        "room_token": session["room_token"],
        "title": session.get("title") or DEFAULT_TITLE,
        "status": session.get("status", "lobby"),
        "min_reveal_count": clamp_min_reveal(session.get("min_reveal_count")),
        "server_now_ms": now_ms(),
        "token_expires_at_ms": session.get("token_expires_at_ms"),
    }


def host_snapshot(session):
    token = session["room_token"]
    status = session.get("status", "lobby")
    roster = _roster(session)
    done = set(finished_ids(session, token)) if status != "lobby" else set()
    stamps = _photo_stamps(token)
    snap = base_meta(session)
    snap.update(
        {
            "role": "host",
            "members": member_list(token),
            "member_count": len(_load_members(token)),
            "roster": [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "finished": row["id"] in done,
                    "photo_at_ms": stamps.get(row["id"], row.get("photo_at_ms") or 0),
                }
                for row in roster
            ],
            "roster_count": len(roster),
            "finished_count": len(done),
            # No scores of any kind reach the host screen — not per person and
            # not as a group total. Results exist only on each member's phone.
        }
    )
    return snap


def player_snapshot(session, member):
    token = session["room_token"]
    status = session.get("status", "lobby")
    member_id = member["id"] if member else ""
    roster_ids = _roster_ids(session)
    in_roster = member_id in roster_ids

    targets = []
    my_scores = {}
    if status in ("rating", "reveal") and in_roster:
        stamps = _photo_stamps(token)
        targets = [
            {
                "id": row["id"],
                "name": row["name"],
                "photo_at_ms": stamps.get(row["id"], row.get("photo_at_ms") or 0),
            }
            for row in targets_for(session, member_id)
        ]
        my_scores = _rater_scores(token, member_id)

    snap = base_meta(session)
    snap.update(
        {
            "role": "player",
            "me": {
                "id": member_id,
                "name": member.get("name", ""),
                "photo_at_ms": member.get("photo_at_ms") or 0,
            }
            if member
            else None,
            "in_roster": in_roster,
            "member_count": len(_load_members(token)),
            "targets": targets,
            # Only this member's own answers come back, so a reconnect resumes
            # where they left off without ever exposing anyone else's.
            "my_scores": my_scores,
            "rated_count": len(my_scores),
            "finished": is_finished(session, token, member_id) if in_roster else False,
            "finished_count": len(finished_ids(session, token)) if status != "lobby" else 0,
            "roster_count": len(roster_ids),
            "my_result": personal_result(token, session, member_id) if status == "reveal" and in_roster else None,
        }
    )
    return snap
