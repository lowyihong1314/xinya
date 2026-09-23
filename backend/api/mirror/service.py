"""「别人眼中的我」的房间引擎 —— 匿名互评活动。原 app/mirror/services.py，**逐字平移**。

状态全在 Redis 里，一张表都没有（和 app.quiz / app.quiz_game 一样）：房间跨 worker
共享、自己过期，分数本来就是一次性的、用完即弃。

    mirror:token:{token}   一个 JSON，就是整场活动（标题 / 阶段 / 名单 / 揭晓门槛）
    mirror:{token}:members hash，member_id → 成员（名字 / 在线 / 入场时刻 / 自拍时刻）
    mirror:{token}:r:{id}  hash，**评分者**的那一份：target_id → 分数（"1".."5" 或 "skip"）
    mirror:{token}:photos  hash，member_id → "<mime>|<base64>"，脸随房间一起过期
    mirror:sid_map         hash，连接 id → "{token}|{member_id}"，断线时按它把人标成离线

★★ 匿名性是**在数据层**保证的，这是产品的核心承诺，改任何一条都等于毁约：
  · 评分只按「评分者 → 被评者」存进评分者自己的 hash，**永远不发给任何客户端**，
    出服务端的只有聚合数；
  · 一个人只拿得到自己的结果（见 ``player_snapshot`` 里的 ``my_result``）；
  · 主持台只看得到组级数字和谁评完了 —— ``host_snapshot`` 里**一个分数都没有**；
  · 样本不足 ``min_reveal_count``（默认 3）时结果整个藏起来（average / counts 都发 null），
    否则 2 个人的平均分能被反推出「谁给我打的 2 分」。

★ 这次只搬了文件位置，函数体一个字没改 —— 包括下面几处「看着像 bug 但故意保留」的地方：

  ① ``is_finished`` 在名单只有 1 人时（expected == 0）直接返回 True。
     于是 ``record_rating`` 里的 ``all_done`` 会在这种房间里立刻成立。实际进不了这条路：
     ``start_round`` 要求至少 2 人才能开始，开始之后名单是冻结的。

  ② ``remove_member``（踢人）不把人从**已冻结的 roster** 里删掉，只删 members /
     photos / ratings。所以本轮进行中踢人，roster_count 不变、被踢者仍占一个位置，
     其他人还会看到他的卡片。前端的进度条按 roster_count 画，改这里会让分母跳变。

  ③ ``normalize_score`` 对 ``True`` 这种 bool 会当成 int 1 收下（Python 的 bool 是 int）。
     前端只发 1..5 和 "skip"，没被触发过。

  ④ ``socket_room()`` 现在**只有还没搬的 app/mirror/socket_events.py 在用**。
     SSE 那边的频道由 core.realtime.channel_of("mirror", token) 自己拼，
     千万别把这个函数的返回值当 room_id 传给 publish_sync —— 那会拼成
     rt:mirror:mirror:{token}，订阅端永远收不到。旧 Socket.IO 删干净时这个函数
     连同 sid_map_key 一起删。

本次唯一的新增是 ``attach_connection``（文件中段，presence 那一节），原因写在那里。
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
# 自拍在手机上已经压过一轮才发上来，这个上限只是兜底：防止有人把一张原图怼进房间。
# 400KB 是按「一屏几十个头像都塞在 Redis 里」估的，不是随手写的数。
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


# ─────────────────────── key 与小工具 ───────────────────────


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
    """评分者 → {被评者: 分数}。一条评分**只**存在这里，别处一份副本都没有。

    key 里带的是**评分者**的 id：要查「谁给我打了分」就得把全名单的 hash 都翻一遍
    （``_tally`` 正是这么做的，边翻边丢掉来源）。反过来按被评者建 key 会方便得多，
    但那样 Redis 里就直接躺着一张「某某被谁打了几分」的表 —— 匿名就不成立了。
    """
    return f"mirror:{token}:r:{rater_id}"


def photos_key(token):
    """member_id → "<mime>|<base64>"。脸和房间同生共死，不落盘、不进数据库。"""
    return f"mirror:{token}:photos"


def sid_map_key():
    return "mirror:sid_map"


def socket_room(token):
    # ⚠️ 只给还没删的 Socket.IO 入向事件用。SSE 走 publish_sync("mirror", token, ...)，
    #    room_id 传**裸 token**，前缀由 core.realtime.channel_of 拼，
    #    传这个函数的返回值会拼成 rt:mirror:mirror:{token}，订阅端永远收不到。
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


# ─────────────────────── 活动的生命周期 ───────────────────────


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


# ─────────────────────── 成员与在场状态 ───────────────────────


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


def attach_connection(token, guest_id, connection_id):
    """把一条 SSE 连接挂到一个**已存在**的成员身上：标回在线 + 登记连接 id。

    ★ 本模块这次唯一的新增函数。原因是 Socket.IO 时代「入场」和「建连」是同一件事
      （``mirror:guest:join`` 的 handler 里直接拿得到 ``request.sid``，
      于是 ``add_member(..., sid=request.sid)`` 顺手就把 sid_map 写了）；
      SSE 时代拆成了两个请求、两个时刻：
          POST {BASE}/mirror/guest/join          ← 报名字，这时还没有连接 id
          GET  {BASE}/mirror/realtime?room=&as=  ← 建连，这时才有 connection_id
      没有这个函数的话 sid_map 里永远是上一次的 id，断线时 ``mark_offline_by_sid``
      找不到人，主持台的在线小点就只亮不灭。

    ★ 故意**不创建**成员：没 join 过的人还没有名字，凭一个 ?as= 就进名单的话，
      主持台会多出一排无名氏。找不到人就返回 None，调用方什么也不做。
    """
    token = normalize_token(token)
    guest_id = _clean_text(guest_id, 80)
    if not guest_id or not connection_id:
        return None
    member = _load_members(token).get(guest_id)
    if not member:
        return None
    member["online"] = True
    _save_member(token, member)
    # 与 add_member 里那两行完全一致（值的格式也一样），
    # mark_offline_by_sid 靠 "|" 切出 token 和 guest_id。
    redis_client.hset(sid_map_key(), connection_id, f"{token}|{guest_id}")
    redis_client.expire(sid_map_key(), MIRROR_TTL_SECONDS)
    return member


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


# ─────────────────────── 自拍 ───────────────────────


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
    """返回 (二进制, mime)；没有照片、mime 不认识、base64 坏了都返回 None（不抛）。"""
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


# ─────────────────────── 评分 ───────────────────────


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
    """名单里除自己以外的所有人，按**每个评分者各不相同**但可复现的顺序排。

    排序键是 sha1(token|评分者|被评者)：
      · 每个人的卡片顺序都不一样 —— 不然旁边的人瞄一眼「第 3 张是谁」就能对上号，
        匿名当场失效；
      · 又是纯函数，断线重连算出来的顺序和之前一模一样，接着评就行，不用存顺序。
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
    # 一个被评者只认第一次，手抖连点两下就是个安全的空操作。
    # 用 hsetnx 而不是「先 hexists 再 hset」：后者两步之间有窗口，狂点能塞进两条。
    redis_client.hsetnx(ratings_key(token, rater_id), target_id, value)
    redis_client.expire(ratings_key(token, rater_id), MIRROR_TTL_SECONDS)

    all_done = len(finished_ids(session, token)) >= len(roster_ids) and len(roster_ids) > 0
    return session, all_done


def _tally(token, session, target_id):
    """把所有给 ``target_id`` 的分数聚合成一堆数字。来源在这里被彻底丢掉。

    返回的 counts 是 1..5 各有几票、skipped 是几个人跳过、rated 是有效票数、
    total 是分数之和 —— **没有任何一项能追回到某个评分者**。
    """
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



# ─────────────────────── 流程 ───────────────────────


def _photo_stamps(token):
    members = _load_members(token)
    return {mid: (m.get("photo_at_ms") or 0) for mid, m in members.items()}


def start_round(token):
    """把此刻大厅里的人冻结成本轮名单，进入评分阶段。"""
    session = require_session(token)
    token = session["room_token"]
    members = member_list(token)
    if len(members) < 2:
        raise MirrorError("至少需要 2 位成员才能开始", 400, "not_enough_members")

    # 把上一轮的残留评分清干净 —— 并集要带上旧 roster，不然中途离场的人
    # 留在 Redis 里的那份评分会被下一轮的 _tally 数进去。
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
    """退回大厅，评分全部抹掉。人不用重新加入（members 保留）。"""
    session = require_session(token)
    token = session["room_token"]
    member_ids = {row["id"] for row in member_list(token)} | set(_roster_ids(session))
    _clear_ratings(token, sorted(member_ids))
    session["roster"] = []
    session["status"] = "lobby"
    session["started_at_ms"] = None
    session["revealed_at_ms"] = None
    return _save_session(session)


# ─────────────────────── 快照 ───────────────────────


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
            # ★ 主持台拿不到任何分数 —— 既没有某个人的，也没有全场平均。
            #   结果只存在于每个成员自己的手机上（player_snapshot 的 my_result）。
            #   谁要在这里加一个「全场平均分」，匿名承诺就破了：主持人手里有名单，
            #   开始前后各看一次平均分，差值就是刚进来那个人的分。
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
            # 只回这个人自己打出去的分，所以重连能接着评，
            # 而且任何时候都不会把别人的答案带出去。
            "my_scores": my_scores,
            "rated_count": len(my_scores),
            "finished": is_finished(session, token, member_id) if in_roster else False,
            "finished_count": len(finished_ids(session, token)) if status != "lobby" else 0,
            "roster_count": len(roster_ids),
            "my_result": personal_result(token, session, member_id) if status == "reveal" and in_roster else None,
        }
    )
    return snap
