import json
import secrets
import time
from urllib.parse import quote

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from app.auth import CHANGYOU_ROOM_CONTROL_PERMISSION, get_current_user_permissions
from app.extensions import socket_broker
from app.redis_client import redis_client
from models.songbook import SongbookEntry
from models.songbook_user_edit import SongbookUserEdit
from models.user_data import User

changyou_room_bp = Blueprint("changyou_room_bp", __name__)
ROOM_PREFIX = "changyou:room:"
ROOM_LIST_KEY = "changyou:rooms:index"
ROOM_TTL_SECONDS = 24 * 60 * 60


def _room_key(room_id: str):
    return f"{ROOM_PREFIX}{room_id}"


def _socket_room(room_id: str):
    return f"changyou:{room_id}"


def _now_ts():
    return int(time.time())


def _normalize_user_id(value):
    try:
        normalized = int(value or 0)
    except (TypeError, ValueError):
        return None
    return normalized or None


def _current_user_has_room_control_permission():
    if not current_user.is_authenticated:
        return False
    try:
        return CHANGYOU_ROOM_CONTROL_PERMISSION in get_current_user_permissions(current_user)
    except Exception as exc:
        print(f"[唱游房间权限] 读取用户权限失败: {exc}")
        return False


def _current_user_owns_room(room: dict | None):
    if not room:
        return False
    current_user_id = _normalize_user_id(getattr(current_user, "id", None))
    return bool(current_user_id and room.get("creator_id") == current_user_id)


def _current_user_can_control_room(room: dict | None = None):
    if not current_user.is_authenticated:
        return False
    if _current_user_owns_room(room):
        return True
    return _current_user_has_room_control_permission()


def _room_control_permission_denied():
    return (
        jsonify({"error": f"只有房间创建者或拥有 {CHANGYOU_ROOM_CONTROL_PERMISSION} 权限的用户才可以控制房间"}),
        403,
    )


def _serialize_room(room_id: str, data: dict):
    creator_id = _normalize_user_id(data.get("creator_id"))
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
            projection_blocks = []
    projection_page_index = int(data.get("projection_page_index") or 0) or 0
    projection_page_count = int(data.get("projection_page_count") or 0) or 0
    marker_index_raw = data.get("marker_index")
    marker_index = int(marker_index_raw) if marker_index_raw not in (None, "") else None

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
        "playback_url": f"/changyou-room/{quote(room_id)}",
        "projection": projection,
    }


def _fetch_room(room_id: str):
    raw = redis_client.hgetall(_room_key(room_id))
    if not raw:
        return None
    ttl = redis_client.ttl(_room_key(room_id))
    if ttl <= 0:
        redis_client.zrem(ROOM_LIST_KEY, room_id)
        return None
    return _serialize_room(room_id, raw)


def _cleanup_rooms():
    room_ids = redis_client.zrevrange(ROOM_LIST_KEY, 0, -1)
    for room_id in room_ids:
        if not redis_client.exists(_room_key(room_id)):
            redis_client.zrem(ROOM_LIST_KEY, room_id)


def _build_room_current_payload(room: dict):
    song_entry_id = room.get("song_entry_id")
    if not song_entry_id:
        return {
            "room": room,
            "entry": None,
            "projection": room.get("projection"),
        }

    entry = SongbookEntry.query.get(song_entry_id)
    if not entry:
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


def _emit_room_update(payload: dict):
    room = payload.get("room") or {}
    room_id = room.get("room_id")
    if not room_id:
        return
    socket_broker.emit("changyou_room_update", payload, room=_socket_room(room_id))


def _build_notification_payload(kind: str, content: str):
    normalized_kind = "qr" if kind == "qr" else "text"
    return {
        "kind": normalized_kind,
        "content": content,
        "updated_at": _now_ts(),
    }


def _emit_room_notification(room_id: str, notification: dict):
    socket_broker.emit(
        "changyou_room_notification",
        {
            "room_id": room_id,
            "notification": notification,
        },
        room=_socket_room(room_id),
    )


@changyou_room_bp.get("/list")
@login_required
def list_rooms():
    _cleanup_rooms()
    room_ids = redis_client.zrevrange(ROOM_LIST_KEY, 0, 99)
    rooms = []
    for room_id in room_ids:
        room = _fetch_room(room_id)
        if room:
            rooms.append(room)
    return jsonify({"rooms": rooms})


@changyou_room_bp.post("/create")
@login_required
def create_room():
    data = request.get_json() or {}
    topic = str(data.get("topic") or "").strip()
    if not topic:
        return jsonify({"error": "主题不能为空"}), 400
    room_id = secrets.token_urlsafe(5).replace("-", "").replace("_", "")[:8]
    now = _now_ts()
    creator_id = _normalize_user_id(getattr(current_user, "id", None))
    payload = {
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
    redis_client.hset(_room_key(room_id), mapping=payload)
    redis_client.expire(_room_key(room_id), ROOM_TTL_SECONDS)
    redis_client.zadd(ROOM_LIST_KEY, {room_id: now})
    return jsonify({"success": True, "room": _serialize_room(room_id, payload)})


@changyou_room_bp.get("/room/<room_id>")
@login_required
def get_room(room_id):
    room = _fetch_room(room_id)
    if not room:
        return jsonify({"error": "房间不存在或已过期"}), 404
    role = "controller" if _current_user_can_control_room(room) else "player"
    room["role"] = role
    return jsonify({"room": room})


@changyou_room_bp.post("/room/<room_id>/push")
@login_required
def push_room_song(room_id):
    room = _fetch_room(room_id)
    if not room:
        return jsonify({"error": "房间不存在或已过期"}), 404
    if not _current_user_can_control_room(room):
        return _room_control_permission_denied()

    data = request.get_json() or {}
    song_entry_id = int(data.get("song_entry_id") or 0)
    version_kind = str(data.get("version_kind") or "base").strip()
    editor_user_id_raw = data.get("editor_user_id")
    editor_user_id = int(editor_user_id_raw) if editor_user_id_raw not in (None, "") else None
    entry = SongbookEntry.query.get(song_entry_id)
    if not entry:
        return jsonify({"error": "歌曲不存在"}), 404

    redis_client.hset(_room_key(room_id), mapping={
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
    redis_client.expire(_room_key(room_id), ROOM_TTL_SECONDS)
    room = _fetch_room(room_id)
    payload = _build_room_current_payload(room)
    _emit_room_update(payload)
    return jsonify({"success": True, **payload})


@changyou_room_bp.post("/room/<room_id>/project")
@login_required
def project_room_page(room_id):
    room = _fetch_room(room_id)
    if not room:
        return jsonify({"error": "房间不存在或已过期"}), 404
    if not _current_user_can_control_room(room):
        return _room_control_permission_denied()

    data = request.get_json() or {}
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
        return jsonify({"error": "歌曲不存在"}), 404

    if not isinstance(blocks, list):
        return jsonify({"error": "投放块格式不正确"}), 400

    redis_client.hset(_room_key(room_id), mapping={
        "song_entry_id": str(song_entry_id),
        "version_kind": version_kind,
        "editor_user_id": str(editor_user_id or ""),
        "projection_page_index": str(page_index),
        "projection_page_count": str(page_count),
        "projection_page_label": page_label,
        "projection_content": content,
        "projection_blocks": json.dumps(blocks, ensure_ascii=False),
        "marker_index": str(marker_index) if marker_index is not None else "",
    })
    redis_client.expire(_room_key(room_id), ROOM_TTL_SECONDS)
    room = _fetch_room(room_id)
    payload = _build_room_current_payload(room)
    _emit_room_update(payload)
    return jsonify({"success": True, **payload})


@changyou_room_bp.post("/room/<room_id>/marker")
@login_required
def update_room_marker(room_id):
    room = _fetch_room(room_id)
    if not room:
        return jsonify({"error": "房间不存在或已过期"}), 404
    if not _current_user_can_control_room(room):
        return _room_control_permission_denied()

    data = request.get_json() or {}
    marker_index_raw = data.get("marker_index")
    marker_index = int(marker_index_raw) if marker_index_raw not in (None, "") else None
    redis_client.hset(_room_key(room_id), mapping={
        "marker_index": str(marker_index) if marker_index is not None else "",
    })
    redis_client.expire(_room_key(room_id), ROOM_TTL_SECONDS)
    room = _fetch_room(room_id)
    payload = _build_room_current_payload(room)
    _emit_room_update(payload)
    return jsonify({"success": True, **payload})


@changyou_room_bp.post("/room/<room_id>/notify")
@login_required
def notify_room(room_id):
    room = _fetch_room(room_id)
    if not room:
        return jsonify({"error": "房间不存在或已过期"}), 404
    if not _current_user_can_control_room(room):
        return _room_control_permission_denied()

    data = request.get_json() or {}
    kind = str(data.get("kind") or "text").strip().lower()
    content = str(data.get("content") or data.get("message") or "").strip()
    if kind not in {"text", "qr"}:
        return jsonify({"error": "通知类型不支持"}), 400
    if not content:
        return jsonify({"error": "通知内容不能为空"}), 400
    if kind == "text" and len(content) > 140:
        content = content[:140].rstrip()
    if kind == "qr" and len(content) > 1200:
        content = content[:1200].rstrip()

    redis_client.hdel(_room_key(room_id), "notification_message", "notification_updated_at")
    redis_client.expire(_room_key(room_id), ROOM_TTL_SECONDS)
    notification = _build_notification_payload(kind, content)
    _emit_room_notification(room_id, notification)
    return jsonify({"success": True, "notification": notification})


@changyou_room_bp.get("/room/<room_id>/current")
def get_room_current(room_id):
    room = _fetch_room(room_id)
    if not room:
        return jsonify({"error": "房间不存在或已过期"}), 404
    return jsonify(_build_room_current_payload(room))
