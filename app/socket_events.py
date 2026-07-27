from flask import request
from flask_login import current_user
from flask_socketio import emit, join_room

from app.extensions import socketio
from app.quiz import services as quiz_services
from app.quiz_game import services as quiz_game_services
from app.redis_client import redis_client

REDIS_ONLINE_KEY = "online_users"


@socketio.on("connect")
def handle_connect():
    print(f"🟢 Client connected: {request.sid}, IP={request.remote_addr}")


@socketio.on("disconnect")
def handle_disconnect(reason=None):
    print(f"🔴 Client disconnected: {request.sid}, reason={reason}")
    try:
        token = quiz_services.remove_guest_by_sid(request.sid)
        if token:
            snapshot = quiz_services.build_snapshot(token)
            emit("quiz:snapshot", snapshot, to=quiz_services.socket_room(token))
    except Exception as exc:  # noqa: BLE001 - presence cleanup must never break disconnect
        print("⚠️ Quiz presence cleanup error:", exc)
    try:
        game_token = quiz_game_services.mark_offline_by_sid(request.sid)
        if game_token:
            emit(
                "game:players",
                {
                    "players": quiz_game_services.player_list(game_token),
                    "player_count": len(quiz_game_services._load_players(game_token)),
                },
                to=quiz_game_services.socket_room(game_token),
            )
    except Exception as exc:  # noqa: BLE001 - presence cleanup must never break disconnect
        print("⚠️ Quiz game presence cleanup error:", exc)


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
    parent = (data or {}).get("parent")
    sign_json_data = (data or {}).get("sign_json_data")
    if not room:
        return
    if not isinstance(parent, dict):
        parent = None
    if parent is not None and sign_json_data is not None:
        parent["sign_json_data"] = sign_json_data
    emit(
        "parental_sign_data",
        {"room": room, "parent": parent, "sign_json_data": sign_json_data},
        to=room,
        skip_sid=request.sid,
    )


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


def _emit_quiz_error(message, reason="invalid_request", status_code=400):
    emit(
        "quiz:error",
        {"status": "error", "message": message, "reason": reason, "status_code": status_code},
        to=request.sid,
    )


def _handle_quiz_error(error):
    if isinstance(error, quiz_services.QuizError):
        _emit_quiz_error(str(error), error.reason, error.status_code)
        return
    print("⚠️ Quiz socket error:", error)
    _emit_quiz_error("抢答服务错误", "server_error", 500)


def _emit_quiz_snapshot(token, sid=None):
    snapshot = quiz_services.build_snapshot(token)
    emit("quiz:snapshot", snapshot, to=sid or request.sid)
    return snapshot


def _require_socket_user():
    if not getattr(current_user, "is_authenticated", False):
        raise quiz_services.QuizError("请先登录", 401, "unauthorized")


@socketio.on("quiz:time:ping")
def handle_quiz_time_ping(data):
    emit(
        "quiz:time:pong",
        {
            "client_sent_at_ms": (data or {}).get("client_sent_at_ms"),
            "server_now_ms": quiz_services.now_ms(),
        },
        to=request.sid,
    )


@socketio.on("quiz:host:join")
def handle_quiz_host_join(data):
    try:
        token = (data or {}).get("room_token") or (data or {}).get("token")
        token = quiz_services.normalize_token(token)
        join_room(quiz_services.socket_room(token))
        _emit_quiz_snapshot(token)
    except Exception as exc:
        _handle_quiz_error(exc)


@socketio.on("quiz:guest:join")
def handle_quiz_guest_join(data):
    try:
        data = data or {}
        token = quiz_services.normalize_token(data.get("room_token") or data.get("token"))
        guest_name = str(data.get("guest_name") or "").strip()
        guest_id = str(data.get("guest_id") or "").strip()
        if not guest_name:
            raise quiz_services.QuizError("请先输入名称", 400, "missing_guest_name")
        join_room(quiz_services.socket_room(token))
        quiz_services.add_guest(token, guest_id, sid=request.sid)
        # Broadcast so the host's player count updates live.
        snapshot = quiz_services.build_snapshot(token)
        emit("quiz:snapshot", snapshot, to=quiz_services.socket_room(token))
    except Exception as exc:
        _handle_quiz_error(exc)


@socketio.on("quiz:host:save_config")
def handle_quiz_host_save_config(data):
    try:
        _require_socket_user()
        data = data or {}
        token = data.get("room_token") or data.get("token")
        session = quiz_services.save_config(token, data.get("config") or {})
        snapshot = quiz_services.build_snapshot(session)
        emit("quiz:config_updated", snapshot, to=quiz_services.socket_room(session["room_token"]))
    except Exception as exc:
        _handle_quiz_error(exc)


@socketio.on("quiz:host:publish")
def handle_quiz_host_publish(data):
    try:
        _require_socket_user()
        token = (data or {}).get("room_token") or (data or {}).get("token")
        session = quiz_services.publish_session(token)
        snapshot = quiz_services.build_snapshot(session)
        emit("quiz:config_updated", snapshot, to=quiz_services.socket_room(session["room_token"]))
    except Exception as exc:
        _handle_quiz_error(exc)


@socketio.on("quiz:host:reset")
def handle_quiz_host_reset(data):
    try:
        _require_socket_user()
        token = (data or {}).get("room_token") or (data or {}).get("token")
        session = quiz_services.reset_session(token)
        snapshot = quiz_services.build_snapshot(session)
        emit("quiz:config_updated", snapshot, to=quiz_services.socket_room(session["room_token"]))
    except Exception as exc:
        _handle_quiz_error(exc)


@socketio.on("quiz:host:close")
def handle_quiz_host_close(data):
    try:
        _require_socket_user()
        token = (data or {}).get("room_token") or (data or {}).get("token")
        session = quiz_services.close_session(token)
        snapshot = quiz_services.build_snapshot(session)
        emit("quiz:config_updated", snapshot, to=quiz_services.socket_room(session["room_token"]))
    except Exception as exc:
        _handle_quiz_error(exc)


@socketio.on("quiz:guest:tap")
def handle_quiz_guest_tap(data):
    try:
        data = data or {}
        token = data.get("room_token") or data.get("token")
        snapshot = quiz_services.record_tap(
            token,
            data.get("guest_id"),
            data.get("guest_name"),
            data.get("client_clicked_at_ms"),
        )
        emit("quiz:leaderboard", snapshot, to=quiz_services.socket_room(snapshot["room_token"]))
    except Exception as exc:
        if isinstance(exc, quiz_services.QuizError):
            emit(
                "quiz:tap_rejected",
                {"reason": exc.reason, "message": str(exc)},
                to=request.sid,
            )
            return
        _handle_quiz_error(exc)


# Register the 问答游戏 (Kahoot-style quiz) socket handlers on the same server.
from app.quiz_game import socket_events as _quiz_game_socket_events  # noqa: E402,F401
