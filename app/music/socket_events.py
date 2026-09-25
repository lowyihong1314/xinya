"""播放设备同步的 socket 事件：socket 只负责收推送，命令都走 HTTP。

客户端先用 HTTP（已登录）拿 channel_key，再在 socket 上 emit playback:subscribe，
服务端据此把连接加入 music:user:<id> 房间。这样网页（cookie）和 APK（Bearer）都不用在 socket 上做登录。
"""
from flask import request
from flask_socketio import emit, join_room

from app.extensions import socketio
from app.music import playback_session


@socketio.on("playback:subscribe")
def handle_playback_subscribe(data):
    key = (data or {}).get("channel_key")
    user_id = playback_session.resolve_channel_key(key)
    if not user_id:
        emit("playback:error", {"error": "channel_key 无效或已过期"}, to=request.sid)
        return
    join_room(playback_session.socket_room(user_id))
    emit("playback:state", playback_session.public_state(user_id), to=request.sid)
