"""一人一设备播放 + 远程遥控（Spotify Connect 式）。

Redis：
- music:devices:<user_id>     hash  device_id -> JSON{name, last_seen, is_playing, music_id, position_ms, duration_ms}
                                    所有在线播放器（含没在播的）都定时上报，做设备列表
- music:active:<user_id>      hash  当前出声的设备及其播放状态
- music:channel:<key>         str   socket 订阅钥匙 -> user_id

事件（广播到房间 music:user:<id>）：
- playback:state        活动设备状态 + 在线设备列表（心跳 / 切换 / 释放时）
- playback:transferred  活动设备换了（目标设备接着播，其他设备转为遥控）
- playback:command      遥控指令 {target_device_id, action, payload}，只有目标设备执行
"""
import json
import secrets
import time

from app.extensions import socket_broker
from app.redis_client import redis_client

DEVICES_KEY = "music:devices:{user_id}"
ACTIVE_KEY = "music:active:{user_id}"
CHANNEL_KEY = "music:channel:{key}"
DEVICES_TTL_SECONDS = 6 * 60 * 60
ACTIVE_TTL_SECONDS = 6 * 60 * 60
CHANNEL_TTL_SECONDS = 24 * 60 * 60
DEVICE_ONLINE_SECONDS = 45   # 超过这个时间没心跳的设备不在列表里
STALE_SECONDS = 30           # 活动设备超过这个时间没心跳，视为离线，任何设备可直接接管
COMMANDS = {"play", "pause", "toggle", "next", "previous", "seek", "play_music", "set_queue"}


def socket_room(user_id):
    return f"music:user:{int(user_id)}"


def _now():
    return time.time()


def _to_int(value, default=0):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


# ---------- 设备列表 ----------

def _devices_raw(user_id):
    return redis_client.hgetall(DEVICES_KEY.format(user_id=int(user_id)))


def list_devices(user_id, active=None):
    """在线设备列表（按最近心跳排序），并标出哪台是活动设备。"""
    if active is None:
        active = get_active(user_id)
    now = _now()
    devices = []
    expired = []
    for device_id, raw in _devices_raw(user_id).items():
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            expired.append(device_id)
            continue
        last_seen = float(data.get("last_seen") or 0)
        if now - last_seen > DEVICE_ONLINE_SECONDS:
            expired.append(device_id)
            continue
        devices.append({
            "device_id": device_id,
            "device_name": data.get("name") or "未命名设备",
            "kind": data.get("kind") or "web",
            "last_seen": last_seen,
            "is_playing": bool(data.get("is_playing")),
            "is_active": bool(active and active["device_id"] == device_id),
        })
    if expired:
        redis_client.hdel(DEVICES_KEY.format(user_id=int(user_id)), *expired)
    devices.sort(key=lambda item: (not item["is_active"], -item["last_seen"]))
    return devices


def _touch_device(user_id, device_id, device_name, kind, is_playing, music_id, position_ms, duration_ms):
    key = DEVICES_KEY.format(user_id=int(user_id))
    redis_client.hset(
        key,
        device_id,
        json.dumps(
            {
                "name": device_name or "",
                "kind": kind or "web",
                "last_seen": _now(),
                "is_playing": bool(is_playing),
                "music_id": music_id,
                "position_ms": _to_int(position_ms),
                "duration_ms": _to_int(duration_ms),
            },
            ensure_ascii=False,
        ),
    )
    redis_client.expire(key, DEVICES_TTL_SECONDS)


def remove_device(user_id, device_id):
    redis_client.hdel(DEVICES_KEY.format(user_id=int(user_id)), str(device_id or ""))


# ---------- 活动设备 ----------

def get_active(user_id):
    data = redis_client.hgetall(ACTIVE_KEY.format(user_id=int(user_id)))
    if not data:
        return None
    updated_at = float(data.get("updated_at") or 0) if str(data.get("updated_at") or "").replace(".", "", 1).isdigit() else 0.0
    music_raw = str(data.get("music_id") or "")
    return {
        "device_id": data.get("device_id") or "",
        "device_name": data.get("device_name") or "",
        "music_id": int(music_raw) if music_raw.isdigit() else None,
        "position_ms": _to_int(data.get("position_ms")),
        "duration_ms": _to_int(data.get("duration_ms")),
        "is_playing": data.get("is_playing") == "1",
        "updated_at": updated_at,
        "stale": _now() - updated_at > STALE_SECONDS,
    }


def _write_active(user_id, device_id, device_name, music_id, position_ms, duration_ms, is_playing):
    key = ACTIVE_KEY.format(user_id=int(user_id))
    redis_client.hset(
        key,
        mapping={
            "device_id": device_id,
            "device_name": device_name or "",
            "music_id": str(int(music_id)) if music_id not in (None, "") else "",
            "position_ms": str(_to_int(position_ms)),
            "duration_ms": str(_to_int(duration_ms)),
            "is_playing": "1" if is_playing else "0",
            "updated_at": str(_now()),
        },
    )
    redis_client.expire(key, ACTIVE_TTL_SECONDS)


def _broadcast(user_id, event, payload):
    try:
        socket_broker.emit(event, payload, to=socket_room(user_id))
    except Exception as exc:  # noqa: BLE001 - 推送失败不能影响播放
        print("⚠️ playback broadcast failed:", exc)


def public_state(user_id, active=None, is_active_for=None, include_devices=True):
    if active is None:
        active = get_active(user_id)
    state = {
        "active_device_id": active["device_id"] if active else None,
        "active_device_name": active["device_name"] if active else None,
        "music_id": active["music_id"] if active else None,
        "position_ms": active["position_ms"] if active else 0,
        "duration_ms": active["duration_ms"] if active else 0,
        "is_playing": bool(active and active["is_playing"]),
        "updated_at": active["updated_at"] if active else None,
        "server_time": _now(),
        "stale": bool(active and active["stale"]),
    }
    if is_active_for is not None:
        state["is_active"] = bool(active and active["device_id"] == is_active_for and not active["stale"])
    if include_devices:
        state["devices"] = list_devices(user_id, active)
    return state


def heartbeat(user_id, device_id, device_name, kind, music_id, position_ms, duration_ms, is_playing, claim=False):
    """所有设备都用它上报：在线 + （活动设备的）播放状态。claim=True 表示本设备要成为出声的那台。"""
    device_id = str(device_id or "").strip()
    if not device_id:
        raise ValueError("device_id 不能为空")

    active = get_active(user_id)
    owned = active is not None and active["device_id"] == device_id
    can_take = active is None or active["stale"]

    # 一个没在播的设备不要把自己变成活动设备（只是登记在线）。
    take = claim or (can_take and is_playing)
    if owned or take:
        became_active = not owned
        if not owned and active and not active["stale"] and not claim:
            became_active = False  # 理论上到不了这里，保险
        _write_active(user_id, device_id, device_name, music_id, position_ms, duration_ms, is_playing)
        _touch_device(user_id, device_id, device_name, kind, is_playing, music_id, position_ms, duration_ms)
        state = public_state(user_id, is_active_for=device_id)
        _broadcast(user_id, "playback:transferred" if became_active else "playback:state", state)
        return state

    # 普通在线登记；若本设备声称在播但别人是活动设备，返回 is_active=False 让它自己停。
    is_new_device = not redis_client.hexists(DEVICES_KEY.format(user_id=int(user_id)), device_id)
    _touch_device(user_id, device_id, device_name, kind, is_playing, music_id, position_ms, duration_ms)
    state = public_state(user_id, active, is_active_for=device_id)
    if is_playing or is_new_device:
        # 新设备上线 / 设备状态变了：让别的设备的选择器马上刷新
        _broadcast(user_id, "playback:state", public_state(user_id, active))
    return state


def transfer(user_id, target_device_id, requested_by=None):
    """把播放切到 target 设备：沿用当前的歌和进度。目标设备收到 transferred 后接着播。"""
    target_device_id = str(target_device_id or "").strip()
    devices = {item["device_id"]: item for item in list_devices(user_id)}
    if target_device_id not in devices:
        raise LookupError("目标设备不在线")
    active = get_active(user_id)
    if active and active["device_id"] == target_device_id and not active["stale"]:
        return public_state(user_id, active, is_active_for=requested_by)
    music_id = active["music_id"] if active else None
    position_ms = active["position_ms"] if active else 0
    duration_ms = active["duration_ms"] if active else 0
    was_playing = bool(active and active["is_playing"]) if active else False
    _write_active(user_id, target_device_id, devices[target_device_id]["device_name"], music_id, position_ms, duration_ms, was_playing)
    state = public_state(user_id, is_active_for=requested_by)
    state["from_device_id"] = active["device_id"] if active else None
    state["resume"] = was_playing or bool(music_id)
    _broadcast(user_id, "playback:transferred", state)
    return state


def command(user_id, target_device_id, action, payload=None, requested_by=None):
    """遥控指令：只广播，目标设备自己执行并在下一次心跳/状态变化时回报。"""
    action = str(action or "").strip()
    if action not in COMMANDS:
        raise ValueError(f"不支持的指令: {action}")
    target_device_id = str(target_device_id or "").strip()
    if not target_device_id:
        active = get_active(user_id)
        if not active or active["stale"]:
            raise LookupError("现在没有正在播放的设备")
        target_device_id = active["device_id"]
    message = {
        "target_device_id": target_device_id,
        "action": action,
        "payload": payload or {},
        "requested_by": requested_by,
        "server_time": _now(),
    }
    _broadcast(user_id, "playback:command", message)
    return message


def release(user_id, device_id):
    """设备停止播放 / 退出：活动设备本人才能清掉活动状态；设备列表里也移除。"""
    device_id = str(device_id or "")
    remove_device(user_id, device_id)
    active = get_active(user_id)
    if active and active["device_id"] == device_id:
        redis_client.delete(ACTIVE_KEY.format(user_id=int(user_id)))
        state = public_state(user_id, None)
        _broadcast(user_id, "playback:state", state)
        return state
    state = public_state(user_id, active, is_active_for=device_id)
    _broadcast(user_id, "playback:state", public_state(user_id, active))
    return state


# ---------- socket 订阅钥匙 ----------

def issue_channel_key(user_id):
    key = secrets.token_urlsafe(24)
    redis_client.set(CHANNEL_KEY.format(key=key), str(int(user_id)), ex=CHANNEL_TTL_SECONDS)
    return key


def resolve_channel_key(key):
    if not key:
        return None
    value = redis_client.get(CHANNEL_KEY.format(key=str(key)))
    return int(value) if value and str(value).isdigit() else None


# 兼容旧调用
_public_state = public_state
