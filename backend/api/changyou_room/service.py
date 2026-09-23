"""唱游房间的状态层：Redis 房间读写 + 播放载荷拼装 + 出向实时推送。

原 app/changyou_room/routes.py 的模块级私有函数，整段平移过来；
路由层（鉴权、参数提取、响应构造）见同目录 router.py。

函数名只去掉了原来的下划线前缀（跨模块 import 私有名太别扭），逻辑一行没动：

    _room_key                  → room_key
    _now_ts                    → now_ts
    _normalize_user_id         → normalize_user_id
    _serialize_room            → serialize_room
    _fetch_room                → fetch_room
    _cleanup_rooms             → cleanup_rooms
    _build_room_current_payload→ build_room_current_payload
    _emit_room_update          → emit_room_update
    _build_notification_payload→ build_notification_payload
    _emit_room_notification    → emit_room_notification
    _socket_room               → 没了，见下面「房间名」一段

── Socket.IO → SSE ────────────────────────────────────────────────────────

旧实现是 ``socket_broker.emit(event, payload, room=f"changyou:{room_id}")``，
房间名自带 ``changyou:`` 前缀；SSE 这边前缀由频道的 app 段承担
（core/realtime.py 的硬约定：room_id 必须是**裸 id**，否则频道会变成
``rt:changyou_room:changyou:abc`` 这种前缀重复的样子）：

    socket_broker.emit("changyou_room_update", payload, room="changyou:abc")
        → publish_sync("changyou_room", "abc", "changyou_room_update", payload)
          实际频道 rt:changyou_room:abc

★ 事件名和 data 的形状**一个字都没动** —— 前端
  music/changyou/react/room/ChangyouRoomPublicPage.tsx 的两个 socket.on
  和 ChangyouRoomController/index.tsx 的一个 socket.on 还按它们分支。
  SSE 侧客户端拿到的是 core/realtime._payload 那层信封
  （``{event, room, ts, data, sender}``），原 emit 的实参落在 ``data`` 里。

★ publish_sync 的返回值（False = Redis 挂了）**故意不检查**：
  旧的 socket_broker.emit 也是发完就不管，推送失败不该让一个已经写进 Redis 的
  投屏操作回 500。客户端重连时会重新拉 /room/{id}/current，漏帧能自愈。

── 逐字保留的几处「看着像 bug」 ─────────────────────────────────────────

① serialize_room 里 ``int(data.get("projection_page_index") or 0) or 0``
   后面那个 ``or 0`` 是废的（0 or 0 还是 0）。不删：删了是等价的，但这一行
   与相邻两行的写法一致，留着更容易跟原文件对读。
② fetch_room 在 ttl <= 0 时把 room 从索引里摘掉并返回 None。
   ``redis_client.ttl`` 对「key 在但没设过期」返回 -1 —— 本模块每次写都跟着
   expire，理论上到不了这个分支；真到了也按「已过期」处理，与原行为一致。
③ build_room_current_payload 里 ``projection.get("content") or content``：
   投屏内容为空串时回落到整首歌的 content，不是留空。原样保留。
"""

import json
import time
from urllib.parse import quote

from backend.core.realtime import publish_sync
from backend.core.redis import redis_client
from backend.models.songbook import SongbookEntry
from backend.models.songbook_user_edit import SongbookUserEdit
from backend.models.user_data import User

ROOM_PREFIX = "changyou:room:"
ROOM_LIST_KEY = "changyou:rooms:index"
ROOM_TTL_SECONDS = 24 * 60 * 60

# core/realtime.py 频道里的 app 段。必须匹配 ^[a-z][a-z0-9_]*$，且与前端
# 将来订阅 GET /changyou_room/realtime?room=<room_id> 时的路径段是同一个词。
REALTIME_APP = "changyou_room"


def room_key(room_id: str):
    return f"{ROOM_PREFIX}{room_id}"


def now_ts():
    return int(time.time())


def normalize_user_id(value):
    """空串 / None / 非数字 → None；0 也 → None（Redis 里存的是字符串，空串代表"没有"）。"""
    try:
        normalized = int(value or 0)
    except (TypeError, ValueError):
        return None
    return normalized or None


def serialize_room(room_id: str, data: dict):
    """Redis hash（全是字符串）→ 前端那份 ChangyouRoom 形状。

    键名与嵌套结构对应 frontend/src/music/changyou/react/room/api.ts 里的
    ChangyouRoom / ChangyouRoomProjection 两个 type，改一个键就是线上故障。
    """
    creator_id = normalize_user_id(data.get("creator_id"))
    creator_name = data.get("creator_name") or None
    song_entry_id = int(data.get("song_entry_id") or 0) or None
    version_kind = data.get("version_kind") or "base"
    editor_user_id = int(data.get("editor_user_id") or 0) or None
    projection_content = data.get("projection_content") or ""
    projection_blocks_raw = data.get("projection_blocks") or ""
    projection_blocks = []
    if projection_blocks_raw:
        try:
            projection_blocks = json.loads(projection_blocks_raw)
        except (TypeError, ValueError, json.JSONDecodeError):
            # 解析不了就当没投屏块，而不是抛 —— 房间状态坏一格不该让整个房间打不开。
            projection_blocks = []
    projection_page_index = int(data.get("projection_page_index") or 0) or 0
    projection_page_count = int(data.get("projection_page_count") or 0) or 0
    marker_index_raw = data.get("marker_index")
    marker_index = int(marker_index_raw) if marker_index_raw not in (None, "") else None

    # 三者全空才算「没投屏」：只判 content 的话，翻到一页纯图/纯空行的投屏会被
    # 当成未投屏，播放端就退回整首歌。
    projection = None
    if projection_content or projection_blocks or projection_page_count:
        projection = {
            "page_index": projection_page_index,
            "page_count": projection_page_count,
            "page_label": data.get("projection_page_label") or None,
            "content": projection_content,
            "blocks": projection_blocks,
            "marker_index": marker_index,
        }

    return {
        "room_id": room_id,
        "topic": data.get("topic") or "未命名房间",
        "creator_id": creator_id,
        "creator_name": creator_name,
        "created_at": int(data.get("created_at") or 0) or None,
        "expires_at": int(data.get("expires_at") or 0) or None,
        "song_entry_id": song_entry_id,
        "version_kind": version_kind,
        "editor_user_id": editor_user_id,
        # TODO(迁移): 这是**前端 SPA 的路径**，不是 API 路径，所以不带 api_prefix；
        # 但它也没带 BASE_PATH —— BASE_PATH=/UTBA_DEMO 时前端直接用这个值跳转会 404。
        # 原 Flask 代码就是这么拼的，本次逐字保留，不顺手改。
        # 真要修是 core.urls.public_url(f"/changyou-room/{quote(room_id)}")，
        # 但那会改变已经发出去的二维码/分享链接的形状，得和前端一起改。
        "playback_url": f"/changyou-room/{quote(room_id)}",
        "projection": projection,
    }


def fetch_room(room_id: str):
    raw = redis_client.hgetall(room_key(room_id))
    if not raw:
        return None
    ttl = redis_client.ttl(room_key(room_id))
    if ttl <= 0:
        # 房间过期了但 zset 索引里还挂着 —— 顺手摘掉，否则 /list 每次都要白捞一遍。
        redis_client.zrem(ROOM_LIST_KEY, room_id)
        return None
    return serialize_room(room_id, raw)


def cleanup_rooms():
    """索引对账：hash 已经被 TTL 回收、zset 里还留着的，删掉。"""
    room_ids = redis_client.zrevrange(ROOM_LIST_KEY, 0, -1)
    for room_id in room_ids:
        if not redis_client.exists(room_key(room_id)):
            redis_client.zrem(ROOM_LIST_KEY, room_id)


def build_room_current_payload(room: dict):
    """房间 + 当前歌曲（含"谁的编辑版"）+ 当前投屏，一次性给播放端。

    这是 /room/{id}/current 的响应体，也是三个控制接口推送出去的 data，
    两边必须是同一个函数 —— 分成两份的那天，SSE 收到的和刷新拿到的就会不一致。
    """
    song_entry_id = room.get("song_entry_id")
    if not song_entry_id:
        return {
            "room": room,
            "entry": None,
            "projection": room.get("projection"),
        }

    entry = SongbookEntry.query.get(song_entry_id)
    if not entry:
        # 歌被删了：房间照常返回，只是没有 entry。前端按 entry === null 显示空态。
        return {
            "room": room,
            "entry": None,
            "projection": room.get("projection"),
        }

    content = entry.content
    active_version_label = "原版"
    active_editor_user_id = None
    active_editor_name = None
    if room.get("version_kind") == "user" and room.get("editor_user_id"):
        override = SongbookUserEdit.query.filter_by(
            base_entry_id=entry.id,
            user_id=room["editor_user_id"],
        ).first()
        if override:
            # 找不到这个人的编辑版就静默回落到原版（label 仍是"原版"），不报错。
            content = override.content
            user = User.query.get(room["editor_user_id"])
            active_editor_name = (
                getattr(user, "display_name", None)
                or getattr(user, "username", None)
                or f"用户 {room['editor_user_id']}"
            )
            active_editor_user_id = room["editor_user_id"]
            active_version_label = f"{active_editor_name} 的编辑版"

    projection = room.get("projection") or None
    if projection and projection.get("content"):
        content = projection.get("content") or content

    entry_data = entry.to_dict(include_content=True)
    entry_data["content"] = content
    entry_data["active_version"] = room.get("version_kind") or "base"
    entry_data["active_version_label"] = active_version_label
    entry_data["active_editor_user_id"] = active_editor_user_id
    entry_data["active_editor_name"] = active_editor_name
    return {
        "room": room,
        "entry": entry_data,
        "projection": projection,
    }


def emit_room_update(payload: dict):
    """把 build_room_current_payload 的结果推给房间里的所有播放端。"""
    room = payload.get("room") or {}
    room_id = room.get("room_id")
    if not room_id:
        # 没有 room_id 就没有频道可发。原实现也是静默 return。
        return
    publish_sync(REALTIME_APP, str(room_id), "changyou_room_update", payload)


def build_notification_payload(kind: str, content: str):
    """通知只有两种 kind，不认识的一律当 text —— 调用方已经先校验过白名单。"""
    normalized_kind = "qr" if kind == "qr" else "text"
    return {
        "kind": normalized_kind,
        "content": content,
        "updated_at": now_ts(),
    }


def emit_room_notification(room_id: str, notification: dict):
    # data 里**仍然带 room_id**：SSE 信封外层已经有 room 字段，看着是冗余的，
    # 而且前端 ChangyouRoomPublicPage 那个监听器目前只读 payload.notification。
    # 照样留着 —— 形状是对客户端的承诺（APK 里还有一份老代码没法逐个确认），
    # "反正没人读"不是删键的理由。
    publish_sync(
        REALTIME_APP,
        str(room_id),
        "changyou_room_notification",
        {
            "room_id": room_id,
            "notification": notification,
        },
    )
