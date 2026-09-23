"""唱游房间：建房、列房、推歌、投屏、标记行、全场通知。

原 app/changyou_room/routes.py（Flask Blueprint，挂在 /api/changyou_room）。
只做框架适配：装饰器、参数提取、响应构造。校验顺序、状态码、错误文案、
响应体的键名与嵌套形状全部逐字照搬 —— 前端
frontend/src/music/changyou/react/room/api.ts 的 parseJson 按 ``data.error``
取文案，控制台/播放端两个页面按 ``room`` / ``entry`` / ``projection`` 三个键分支。

房间状态层（Redis 读写、载荷拼装、出向推送）在同目录 service.py。

URL 变化（/api 这一段没了；BASE_PATH 由 nginx 剥掉，应用内一律写裸路径）：

    /api/changyou_room/list                     → /changyou_room/list
    /api/changyou_room/create                   → /changyou_room/create
    /api/changyou_room/room/<room_id>           → /changyou_room/room/{room_id}
    /api/changyou_room/room/<room_id>/push      → /changyou_room/room/{room_id}/push
    /api/changyou_room/room/<room_id>/project   → /changyou_room/room/{room_id}/project
    /api/changyou_room/room/<room_id>/marker    → /changyou_room/room/{room_id}/marker
    /api/changyou_room/room/<room_id>/notify    → /changyou_room/room/{room_id}/notify
    /api/changyou_room/room/<room_id>/current   → /changyou_room/room/{room_id}/current

── ★ Socket.IO 这次只搬了一半 ─────────────────────────────────────────────

**出向推送**已经换成 core.realtime.publish_sync（见 service.py）。
**入向事件**（app/socket_events.py）本次**没动**，两个都还挂在 Flask-SocketIO 上：

  · ``changyou_join_room`` —— 客户端进房。SSE 没有"加入房间"这个动作，
    订阅本身就是加入：GET /changyou_room/realtime?room={room_id}。
    对应的 ``changyou_room_joined`` 回执也随之消失（EventSource 的 onopen 即回执）。
  · ``changyou_push_song`` —— 客户端直接广播一份 payload 给同房间其他人，
    **绕过了服务端的任何校验和 Redis 落盘**（连是不是房主都不看）。
    它在语义上对应 ``POST /room/{room_id}/push``，但那条路由会校验权限、
    写 Redis、再推一份**服务端拼的** payload；
    所以迁移时不是"照搬"，而是让前端改调 POST —— 这一步要前后端一起做，
    本次不动。skip_sid（"广播给除自己以外的人"）的替代品是 publish_sync 的
    sender 参数，见 core/realtime._payload 的注释。

  ⚠️ 也就是说：在前端切到 SSE 之前，这些 publish_sync 发出去的消息**没有订阅者**
  （Redis PUBLISH 无人订阅即丢弃，不报错）。这是计划内的中间态，
  但意味着"控制台投屏 → 播放端实时刷新"这条链路在切换完成前是断的，
  播放端只能靠自己刷新 /room/{id}/current。上线排期要知道这件事。

  ⚠️ 本模块还**没有** core.realtime.register(RealtimeApp(...))，所以
  GET /changyou_room/realtime 现在会 404。补注册要一并定 authorize
  （房间是公开可看的，见下面 get_room_current 的注释）和 snapshot 回调，
  那是前端改造那一步的事。

── ★ 三条硬性约束（违反会启动即失败或线上事故）──────────────────────────

  ① 本文件**不能**写 ``from __future__ import annotations``：core.auth.login_required
     用 functools.wraps 包了一层，FastAPI 求值注解时用的是 core/auth.py 的命名空间，
     开了这行会在那里找不到 Optional 而**启动即 NameError**。详见
     api/permission_mgmt/router.py 顶部。
  ② 路由一律 ``def``（同步）：底下是同步 Redis + 同步 DB 查询，
     写成 async def 会把 worker 的事件循环焊死。
  ③ 装饰器顺序：``@router.xxx`` 在上、``@login_required`` 在下。

── ★ 逐字保留的「看着像 bug」 ──────────────────────────────────────────

  · 权限名常量的值是 ``"changyou_contorl"``（control 拼错了），而它会被**拼进
    403 的中文文案**里给用户看。不改 —— 改了要同步改 DB 里已分配的权限名、
    前端权限管理页和 core/permissions.py 的清单，是一次独立的数据迁移。
  · notify_room 里的 ``hdel(..., "notification_message", "notification_updated_at")``
    删的是**两个从来没被写过的字段**（通知不落 Redis，纯广播）。留着，见那里的注释。
  · push / project / marker 三条路由把请求体里的数字字段直接 ``int(...)``，
    传 "abc" 会抛 ValueError → 500。Flask 时代就是 500，保持。
  · get_room_current **没有 @login_required**（见那条路由的注释）。
"""

import json
import secrets
from typing import Optional

from fastapi import APIRouter, Body

from backend.api.changyou_room.service import (
    ROOM_LIST_KEY,
    ROOM_TTL_SECONDS,
    build_notification_payload,
    build_room_current_payload,
    cleanup_rooms,
    emit_room_notification,
    emit_room_update,
    fetch_room,
    normalize_user_id,
    now_ts,
    room_key,
    serialize_room,
)
# 从 core.permissions / core.auth 取，不从 app.auth：后者顶上还 import 着 flask、
# flask_login、app.extensions，一行 import 会把整个 Flask 栈拖进 FastAPI 进程。
from backend.core.auth import current_user, get_current_user_permissions, login_required
from backend.core.config import settings
from backend.core.permissions import CHANGYOU_ROOM_CONTROL_PERMISSION
from backend.core.redis import redis_client
from backend.core.responses import json_response
from backend.models.songbook import SongbookEntry

# prefix 用 settings.api_prefix 拼而不是写死：api_prefix 今天是空串
# （BASE_PATH 已经区分了项目），但配置项留着就是为了需要时能整体加回来。
router = APIRouter(prefix=f"{settings.api_prefix}/changyou_room", tags=["changyou_room"])

# 对应 Flask 的 ``request.get_json() or {}``：没有 body 时落到 None，
# 路由里 ``payload or {}`` 补成空字典，后面的校验分支自然走原来那条路。
# （差异：Flask 的 get_json() 不带 silent 时，Content-Type 不对会回 400 的 HTML
#  错误页；FastAPI 回 422 的 JSON。两边前端都解析不出业务文案，不算行为变更。）
_JSON_BODY = Body(default=None)


# ─────────────────────── 权限：房主 or 全局控制权限 ───────────────────────


def _current_user_has_room_control_permission():
    if not current_user.is_authenticated:
        return False
    try:
        return CHANGYOU_ROOM_CONTROL_PERMISSION in get_current_user_permissions(current_user)
    except Exception as exc:
        # 权限表读失败时**降级成"没权限"而不是 500**：唱游是现场演出场景，
        # 宁可控制台少一个按钮，也不要整个房间打不开。
        # print 而不是 log 是原样保留（进程 stdout 由 systemd 收着）。
        print(f"[唱游房间权限] 读取用户权限失败: {exc}")
        return False


def _current_user_owns_room(room):
    if not room:
        return False
    current_user_id = normalize_user_id(getattr(current_user, "id", None))
    return bool(current_user_id and room.get("creator_id") == current_user_id)


def _current_user_can_control_room(room=None):
    """房主永远能控制自己的房间；其他人要有 changyou_contorl 权限。

    顺序不能换：先判房主再查权限表，房主这条路径一次库都不用查。
    """
    if not current_user.is_authenticated:
        return False
    if _current_user_owns_room(room):
        return True
    return _current_user_has_room_control_permission()


def _room_control_permission_denied():
    # 文案里嵌着权限名常量（值是拼错的 "changyou_contorl"）—— 见模块 docstring。
    return json_response(
        {"error": f"只有房间创建者或拥有 {CHANGYOU_ROOM_CONTROL_PERMISSION} 权限的用户才可以控制房间"},
        403,
    )


def _room_or_404(room_id):
    """五条路由共用的开头：房间不在 / 已过期 → 404。

    返回 (room, error_response)，两者恒有且只有一个不是 None。
    """
    room = fetch_room(room_id)
    if not room:
        return None, json_response({"error": "房间不存在或已过期"}, 404)
    return room, None


# ─────────────────────────────── 路由 ───────────────────────────────


@router.get("/list")
@login_required
def list_rooms():
    cleanup_rooms()
    # 只取最近 100 个：zset 按创建时间倒序，再老的房间早就过 24h TTL 了。
    room_ids = redis_client.zrevrange(ROOM_LIST_KEY, 0, 99)
    rooms = []
    for room_id in room_ids:
        room = fetch_room(room_id)
        if room:
            rooms.append(room)
    return json_response({"rooms": rooms})


@router.post("/create")
@login_required
def create_room(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    topic = str(data.get("topic") or "").strip()
    if not topic:
        return json_response({"error": "主题不能为空"}, 400)
    # 去掉 - 和 _ 再截 8 位：房间号要能念给现场的人听、能手打进 URL。
    # 代价是去掉字符后可能不足 8 位（token_urlsafe(5) 约 7 个字符），原样保留。
    room_id = secrets.token_urlsafe(5).replace("-", "").replace("_", "")[:8]
    now = now_ts()
    creator_id = normalize_user_id(getattr(current_user, "id", None))
    # 原变量名就叫 payload，这里因为 body 参数占了这个名字改叫 room_fields，
    # 内容一个键都没变（Redis hash 的字段全是字符串，空串代表"未设置"）。
    room_fields = {
        "topic": topic,
        "creator_id": str(creator_id or ""),
        "creator_name": getattr(current_user, "display_name", None) or getattr(current_user, "username", None) or f"用户 {current_user.id}",
        "created_at": str(now),
        "expires_at": str(now + ROOM_TTL_SECONDS),
        "song_entry_id": "",
        "version_kind": "base",
        "editor_user_id": "",
        "projection_page_index": "",
        "projection_page_count": "",
        "projection_page_label": "",
        "projection_content": "",
        "projection_blocks": "",
        "marker_index": "",
    }
    redis_client.hset(room_key(room_id), mapping=room_fields)
    redis_client.expire(room_key(room_id), ROOM_TTL_SECONDS)
    redis_client.zadd(ROOM_LIST_KEY, {room_id: now})
    return json_response({"success": True, "room": serialize_room(room_id, room_fields)})


@router.get("/room/{room_id}")
@login_required
def get_room(room_id: str):
    room, denied = _room_or_404(room_id)
    if denied is not None:
        return denied
    # role 只在这条路由上出现（不在 serialize_room 里），前端控制台据此决定
    # 显示投屏控制面板还是只读播放视图。
    role = "controller" if _current_user_can_control_room(room) else "player"
    room["role"] = role
    return json_response({"room": room})


@router.post("/room/{room_id}/push")
@login_required
def push_room_song(room_id: str, payload: Optional[dict] = _JSON_BODY):
    """推一首歌到房间，并清空上一首留下的投屏状态。"""
    room, denied = _room_or_404(room_id)
    if denied is not None:
        return denied
    if not _current_user_can_control_room(room):
        return _room_control_permission_denied()

    data = payload or {}
    song_entry_id = int(data.get("song_entry_id") or 0)
    version_kind = str(data.get("version_kind") or "base").strip()
    editor_user_id_raw = data.get("editor_user_id")
    editor_user_id = int(editor_user_id_raw) if editor_user_id_raw not in (None, "") else None
    entry = SongbookEntry.query.get(song_entry_id)
    if not entry:
        return json_response({"error": "歌曲不存在"}, 404)

    # 换歌必须把 projection_* 和 marker_index 一起清空：不清的话播放端会
    # 拿上一首的投屏内容盖住新歌（serialize_room 里 projection 优先于 entry.content）。
    redis_client.hset(room_key(room_id), mapping={
        "song_entry_id": str(song_entry_id),
        "version_kind": version_kind,
        "editor_user_id": str(editor_user_id or ""),
        "projection_page_index": "",
        "projection_page_count": "",
        "projection_page_label": "",
        "projection_content": "",
        "projection_blocks": "",
        "marker_index": "",
    })
    redis_client.expire(room_key(room_id), ROOM_TTL_SECONDS)
    # 重新读一遍而不是改内存里那份：serialize_room 要按 Redis 里的字符串重算，
    # 手工拼的 room 和推送出去的 room 一旦不同，播放端和控制台就会不一致。
    room = fetch_room(room_id)
    current_payload = build_room_current_payload(room)
    emit_room_update(current_payload)
    return json_response({"success": True, **current_payload})


@router.post("/room/{room_id}/project")
@login_required
def project_room_page(room_id: str, payload: Optional[dict] = _JSON_BODY):
    """投屏某一页（歌词块 + 当前高亮行）。"""
    room, denied = _room_or_404(room_id)
    if denied is not None:
        return denied
    if not _current_user_can_control_room(room):
        return _room_control_permission_denied()

    data = payload or {}
    song_entry_id = int(data.get("song_entry_id") or 0)
    version_kind = str(data.get("version_kind") or "base").strip()
    editor_user_id_raw = data.get("editor_user_id")
    editor_user_id = int(editor_user_id_raw) if editor_user_id_raw not in (None, "") else None
    page_index = max(0, int(data.get("page_index") or 0))
    page_count = max(0, int(data.get("page_count") or 0))
    page_label = str(data.get("page_label") or "").strip()
    content = str(data.get("content") or "")
    blocks = data.get("blocks") or []
    marker_index_raw = data.get("marker_index")
    marker_index = int(marker_index_raw) if marker_index_raw not in (None, "") else None

    entry = SongbookEntry.query.get(song_entry_id)
    if not entry:
        return json_response({"error": "歌曲不存在"}, 404)

    # ★ 校验顺序不能调：歌曲不存在先回 404，blocks 类型错才回 400。
    # 倒过来的话，"歌被删了 + 前端传了个对象"这种组合会从 404 变成 400，
    # 前端 catch 里按文案分支的提示就变了。
    if not isinstance(blocks, list):
        return json_response({"error": "投放块格式不正确"}, 400)

    redis_client.hset(room_key(room_id), mapping={
        "song_entry_id": str(song_entry_id),
        "version_kind": version_kind,
        "editor_user_id": str(editor_user_id or ""),
        "projection_page_index": str(page_index),
        "projection_page_count": str(page_count),
        "projection_page_label": page_label,
        "projection_content": content,
        # ensure_ascii=False：歌词全是中文，转义后体积翻几倍，Redis 里也没法直接看。
        "projection_blocks": json.dumps(blocks, ensure_ascii=False),
        "marker_index": str(marker_index) if marker_index is not None else "",
    })
    redis_client.expire(room_key(room_id), ROOM_TTL_SECONDS)
    room = fetch_room(room_id)
    current_payload = build_room_current_payload(room)
    emit_room_update(current_payload)
    return json_response({"success": True, **current_payload})


@router.post("/room/{room_id}/marker")
@login_required
def update_room_marker(room_id: str, payload: Optional[dict] = _JSON_BODY):
    """只挪高亮行，不动投屏内容（演出时点得最频繁的一条）。"""
    room, denied = _room_or_404(room_id)
    if denied is not None:
        return denied
    if not _current_user_can_control_room(room):
        return _room_control_permission_denied()

    data = payload or {}
    marker_index_raw = data.get("marker_index")
    marker_index = int(marker_index_raw) if marker_index_raw not in (None, "") else None
    redis_client.hset(room_key(room_id), mapping={
        "marker_index": str(marker_index) if marker_index is not None else "",
    })
    redis_client.expire(room_key(room_id), ROOM_TTL_SECONDS)
    room = fetch_room(room_id)
    current_payload = build_room_current_payload(room)
    emit_room_update(current_payload)
    return json_response({"success": True, **current_payload})


@router.post("/room/{room_id}/notify")
@login_required
def notify_room(room_id: str, payload: Optional[dict] = _JSON_BODY):
    """全场通知：一行字或一个二维码。**纯广播，不落 Redis**。"""
    room, denied = _room_or_404(room_id)
    if denied is not None:
        return denied
    if not _current_user_can_control_room(room):
        return _room_control_permission_denied()

    data = payload or {}
    kind = str(data.get("kind") or "text").strip().lower()
    # 兼容两个字段名：老前端发 message，新前端发 content。
    content = str(data.get("content") or data.get("message") or "").strip()
    if kind not in {"text", "qr"}:
        return json_response({"error": "通知类型不支持"}, 400)
    if not content:
        return json_response({"error": "通知内容不能为空"}, 400)
    # 超长**截断而不是报错**：现场操作时弹一个错误框还不如把话显示出来。
    # 两个上限不同是因为 qr 装的是 URL，140 字不够用。
    if kind == "text" and len(content) > 140:
        content = content[:140].rstrip()
    if kind == "qr" and len(content) > 1200:
        content = content[:1200].rstrip()

    # TODO(原样保留): 这两个字段**从来没有被写入过** —— 通知是纯广播，
    # 不进房间 hash。所以这行 hdel 恒为空操作。不删是因为它可能在清理某个
    # 更早版本留在线上的历史字段（那些 key 的 TTL 是 24h，早该过期了，但
    # 删掉这行等于赌这件事，收益为零）。
    redis_client.hdel(room_key(room_id), "notification_message", "notification_updated_at")
    redis_client.expire(room_key(room_id), ROOM_TTL_SECONDS)
    notification = build_notification_payload(kind, content)
    emit_room_notification(room_id, notification)
    return json_response({"success": True, "notification": notification})


@router.get("/room/{room_id}/current")
def get_room_current(room_id: str):
    """播放端拉当前状态。

    ★ **故意没有 @login_required**（原代码就没有）：播放端是现场大屏 / 观众手机
    扫码打开的公开页面，要求登录等于让所有人先登录才能看歌词。
    房间号是 8 位随机串 + 24 小时 TTL，这就是它全部的"鉴权"。
    不要顺手给它加登录 —— 加了当场就是演出事故。
    """
    room, denied = _room_or_404(room_id)
    if denied is not None:
        return denied
    return json_response(build_room_current_payload(room))
