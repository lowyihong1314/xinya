from flask import request
from flask_login import current_user
from flask_socketio import emit, join_room

from app.extensions import socketio
from app.redis_client import redis_client

REDIS_ONLINE_KEY = "online_users"


@socketio.on("connect")
def handle_connect():
    print(f"🟢 Client connected: {request.sid}, IP={request.remote_addr}")


@socketio.on("disconnect")
def handle_disconnect():
    print(f"🔴 Client disconnected: {request.sid}")


@socketio.on_error_default
def default_error_handler(error):
    print("⚠️ SocketIO event error:", error)


@socketio.on("ping_test")
def handle_ping_test(data):
    print("✅ 收到前端 ping_test:", data)
    emit("pong_test", {"msg": "pong"}, to=request.sid)


@socketio.on("join_room")
def handle_join_room(data):
    print("🛰 join_room received:", data)
    room = data.get("room")
    user_id = getattr(current_user, "id", None) or data.get("user_id") or "guest"
    if not room:
        return
    join_room(room)
    redis_client.hset(REDIS_ONLINE_KEY, user_id, request.sid)


@socketio.on("parental_sign_sync")
def handle_parental_sign_sync(data):
    room = (data or {}).get("room")
    sign_json_data = (data or {}).get("sign_json_data")
    if not room:
        return
    emit("parental_sign_data", {"room": room, "sign_json_data": sign_json_data}, to=room, skip_sid=request.sid)


@socketio.on("changyou_join_room")
def handle_changyou_join_room(data):
    room_id = (data or {}).get("room_id")
    if not room_id:
        return
    join_room(f"changyou:{room_id}")
    emit("changyou_room_joined", {"room_id": room_id}, to=request.sid)


@socketio.on("changyou_push_song")
def handle_changyou_push_song(data):
    room_id = (data or {}).get("room_id")
    payload = (data or {}).get("payload") or {}
    if not room_id:
        return
    emit("changyou_room_update", payload, to=f"changyou:{room_id}", skip_sid=request.sid)
