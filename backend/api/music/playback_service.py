"""播放设备与播放权（Spotify Connect 那一套）。

一个用户可以同时开着好几个前端：电脑浏览器、手机浏览器、APK。
规则是 **同一时刻只有一个在放**，另外几个只能看状态或把播放接管过来。

── 为什么是 Redis 而不是 DB ────────────────────────────────────────
设备是**连接级**的东西：标签页一关就没了，值不值得持久化？不值得。
而且 on_disconnect 在客户端崩溃/锁屏时不一定及时触发（见 core/realtime.py
Connection 的警告），所以每个设备键都带 TTL 自己过期 —— on_disconnect 只是兜底。

── 键 ──────────────────────────────────────────────────────────
  music:dev:{user_id}       HASH  connection_id → JSON {name, kind, since_ms}
  music:active:{user_id}    STR   当前持有播放权的 connection_id
  music:now:{user_id}       STR   JSON，当前在放什么（让新连上的设备能显示）

── 房间 ────────────────────────────────────────────────────────
realtime 的 app 名是 ``music``，房间就是 **用户自己的 id**。
所以这是一条「私人频道」：只有本人订得到，别人订会被 authorize 拒掉。
"""

import json
import time

from backend.core.realtime import publish_sync
from backend.core.redis import redis_client
from backend.core.responses import json_response

APP = "music"

# 设备表的存活时间。比 SSE 心跳间隔长得多 —— 心跳还在就说明连接还在，
# 每次心跳/状态上报都会续期。取 5 分钟是为了容忍一次短暂的网络抖动重连。
DEVICE_TTL_SECONDS = 300
NOW_PLAYING_TTL_SECONDS = 3600

MAX_NAME_LEN = 60


def _dev_key(user_id):
    return f"music:dev:{user_id}"


def _active_key(user_id):
    return f"music:active:{user_id}"


def _now_key(user_id):
    return f"music:now:{user_id}"


def _now_ms():
    return int(time.time() * 1000)


def _clean(value, limit):
    text = str(value or "").strip()
    return text[:limit]


# ─────────────────────────── 设备注册 ───────────────────────────


def register_device(user_id, connection_id, name, kind):
    """SSE 连上时登记一台设备。由 RealtimeApp.on_connect 调用。

    名字是**客户端报上来的**（浏览器/系统信息），服务端认不出来，
    所以只做长度截断，不做校验 —— 它只用来显示，不参与任何判断。
    """
    if not user_id or not connection_id:
        return
    key = _dev_key(user_id)
    redis_client.hset(
        key,
        connection_id,
        json.dumps(
            {
                "name": _clean(name, MAX_NAME_LEN) or "未命名设备",
                "kind": _clean(kind, 16) or "web",
                "since_ms": _now_ms(),
            },
            ensure_ascii=False,
        ),
    )
    redis_client.expire(key, DEVICE_TTL_SECONDS)

    # 第一台连上的设备自动拿到播放权 —— 否则用户打开页面点播放会发现放不了，
    # 还得先在下拉里选一次自己，很别扭。
    if not redis_client.get(_active_key(user_id)):
        _set_active(user_id, connection_id)

    _broadcast_devices(user_id)


def unregister_device(user_id, connection_id):
    """SSE 断开时摘掉设备。由 RealtimeApp.on_disconnect 调用。"""
    if not user_id or not connection_id:
        return
    redis_client.hdel(_dev_key(user_id), connection_id)

    # 播放权在这台设备上 → 转给还活着的任意一台；一台都没有就清空。
    # 不清的话下次连上的设备会看到一个指向幽灵连接的 active_id，永远放不了。
    if redis_client.get(_active_key(user_id)) == connection_id:
        remaining = list(redis_client.hkeys(_dev_key(user_id)) or [])
        if remaining:
            _set_active(user_id, remaining[0])
        else:
            redis_client.delete(_active_key(user_id))
            redis_client.delete(_now_key(user_id))

    _broadcast_devices(user_id)


def touch_device(user_id, connection_id):
    """续期。状态上报时顺手调一次，避免长时间只听不操作的设备被 TTL 清掉。"""
    if user_id and connection_id:
        redis_client.expire(_dev_key(user_id), DEVICE_TTL_SECONDS)


# ─────────────────────────── 播放权 ───────────────────────────


def _set_active(user_id, connection_id):
    redis_client.set(_active_key(user_id), connection_id, ex=DEVICE_TTL_SECONDS)


def _device_list(user_id):
    raw = redis_client.hgetall(_dev_key(user_id)) or {}
    active = redis_client.get(_active_key(user_id))
    devices = []
    for conn_id, blob in raw.items():
        try:
            info = json.loads(blob)
        except (TypeError, ValueError):
            info = {}
        devices.append(
            {
                "connection_id": conn_id,
                "name": info.get("name") or "未命名设备",
                "kind": info.get("kind") or "web",
                "since_ms": info.get("since_ms"),
                "is_active": conn_id == active,
            }
        )
    # 先连上的排前面，顺序稳定 —— 否则下拉里的设备每次刷新都在跳
    devices.sort(key=lambda d: (d.get("since_ms") or 0, d["connection_id"]))
    return devices, active


def _broadcast_devices(user_id):
    """把设备表推给这个用户的所有连接。

    ★ **不带 sender**：发起操作的那台设备也要收到。
      它需要知道自己是不是还持有播放权（接管给别人之后自己就该停）。
    """
    devices, active = _device_list(user_id)
    publish_sync(
        APP,
        str(user_id),
        "music:devices",
        {"devices": devices, "active_connection_id": active},
    )


def get_devices(user_id):
    devices, active = _device_list(user_id)
    now = redis_client.get(_now_key(user_id))
    try:
        now_playing = json.loads(now) if now else None
    except (TypeError, ValueError):
        now_playing = None
    return json_response(
        {
            "status": "success",
            "devices": devices,
            "active_connection_id": active,
            "now_playing": now_playing,
        }
    )


def claim_playback(user_id, data):
    """把播放权拿到某台设备上。

    两个场景共用这一条：
      · 本机点播放 → 传自己的 connection_id
      · 在下拉里选了另一台 → 传那一台的 connection_id（Spotify 的「转移播放」）
    """
    target = _clean(data.get("connection_id"), 64)
    if not target:
        return json_response({"status": "error", "message": "缺少 connection_id"}, 400)

    # 只能转给**确实连着**的设备。转给一个幽灵连接的话，用户会看到
    # 「已转移」但哪里都没声音，而且本机也停了。
    if not redis_client.hexists(_dev_key(user_id), target):
        return json_response(
            {"status": "error", "message": "这台设备已经离线", "reason": "device_gone"}, 409
        )

    _set_active(user_id, target)
    _broadcast_devices(user_id)

    devices, active = _device_list(user_id)
    return json_response({"status": "success", "devices": devices, "active_connection_id": active})


def report_state(user_id, data):
    """上报当前在放什么，让别的设备能显示（Spotify 那种「在 xx 上播放」）。

    ★ 只有**持有播放权**的设备说了算。不校验的话，一台刚被接管走的设备
      还没停下来时上报的状态会覆盖掉新设备的，两边来回打架。
    """
    conn_id = _clean(data.get("connection_id"), 64)
    active = redis_client.get(_active_key(user_id))
    if not conn_id or conn_id != active:
        return json_response(
            {"status": "error", "message": "这台设备当前没有播放权", "reason": "not_active"}, 409
        )

    touch_device(user_id, conn_id)
    state = {
        "music_id": data.get("music_id"),
        "title": _clean(data.get("title"), 120) or None,
        "playing": bool(data.get("playing")),
        "position": data.get("position"),
        "accompaniment": bool(data.get("accompaniment")),
        "connection_id": conn_id,
        "at_ms": _now_ms(),
    }
    redis_client.set(_now_key(user_id), json.dumps(state, ensure_ascii=False), ex=NOW_PLAYING_TTL_SECONDS)

    # sender 带上自己：上报的那台不需要再收到自己的回声
    publish_sync(APP, str(user_id), "music:now_playing", state, sender=conn_id)
    return json_response({"status": "success"})
