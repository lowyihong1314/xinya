"""Socket.IO handlers for the 问答游戏 live game.

Host (big screen) and players share one Socket.IO room. State transitions are
broadcast to the whole room; each client renders its own view. Per-player reveal
results are derived on the client from the broadcast (correct answer + the
player's own remembered choice + their leaderboard row), so no per-sid fan-out
is required. The per-question timer is driven by the host client; the server
also auto-reveals once every online player has answered.
"""

from flask import request
from flask_login import current_user
from flask_socketio import emit, join_room

from app.extensions import socketio

from . import services


def _room(token):
    return services.socket_room(token)


def _emit_error(exc):
    if isinstance(exc, services.QuizGameError):
        emit(
            "game:error",
            {"status": "error", "message": str(exc), "reason": exc.reason, "status_code": exc.status_code},
            to=request.sid,
        )
        return
    print("⚠️ Quiz game socket error:", exc)
    emit("game:error", {"status": "error", "message": "问答游戏服务错误", "reason": "server_error"}, to=request.sid)


def _require_user():
    if not getattr(current_user, "is_authenticated", False):
        raise services.QuizGameError("请先登录", 401, "unauthorized")


def _broadcast_state(session):
    """Emit the right transition event for a session's current status to the room."""
    token = session["room_token"]
    status = session.get("status", "lobby")
    room = _room(token)
    if status == "question":
        emit(
            "game:question",
            {"question": services._public_question(session), "player_count": len(services._load_players(token))},
            to=room,
        )
    elif status == "reveal":
        answers = services._answers(token)
        emit(
            "game:reveal",
            {"reveal": services._reveal_data(session, answers), "leaderboard": services.leaderboard(token)},
            to=room,
        )
    elif status == "podium":
        emit("game:podium", {"leaderboard": services.leaderboard(token)}, to=room)
    else:
        emit("game:lobby", {"players": services.player_list(token)}, to=room)


@socketio.on("game:time:ping")
def handle_game_time_ping(data):
    emit(
        "game:time:pong",
        {"client_sent_at_ms": (data or {}).get("client_sent_at_ms"), "server_now_ms": services.now_ms()},
        to=request.sid,
    )


@socketio.on("game:host:join")
def handle_game_host_join(data):
    try:
        token = services.normalize_token((data or {}).get("room_token") or (data or {}).get("token"))
        join_room(_room(token))
        session = services.require_session(token)
        emit("game:host", services.host_snapshot(session), to=request.sid)
    except Exception as exc:
        _emit_error(exc)


@socketio.on("game:guest:join")
def handle_game_guest_join(data):
    try:
        data = data or {}
        token = services.normalize_token(data.get("room_token") or data.get("token"))
        session, player = services.add_player(
            token, data.get("guest_id"), data.get("guest_name"), sid=request.sid
        )
        join_room(_room(token))
        emit("game:joined", {"id": player["id"], "name": player["name"]}, to=request.sid)
        emit("game:player", services.player_snapshot(session, player), to=request.sid)
        # Live-update the host's lobby / player list.
        emit("game:players", {"players": services.player_list(token), "player_count": len(services._load_players(token))}, to=_room(token))
    except Exception as exc:
        _emit_error(exc)


@socketio.on("game:host:start")
def handle_game_host_start(data):
    try:
        _require_user()
        token = services.normalize_token((data or {}).get("room_token") or (data or {}).get("token"))
        session = services.start_question(token, 0)
        _broadcast_state(session)
    except Exception as exc:
        _emit_error(exc)


@socketio.on("game:host:next")
def handle_game_host_next(data):
    try:
        _require_user()
        token = services.normalize_token((data or {}).get("room_token") or (data or {}).get("token"))
        session = services.next_question(token)
        _broadcast_state(session)
    except Exception as exc:
        _emit_error(exc)


@socketio.on("game:host:reveal")
def handle_game_host_reveal(data):
    try:
        _require_user()
        token = services.normalize_token((data or {}).get("room_token") or (data or {}).get("token"))
        session, changed = services.reveal(token)
        if changed:
            _broadcast_state(session)
    except Exception as exc:
        _emit_error(exc)


@socketio.on("game:host:podium")
def handle_game_host_podium(data):
    try:
        _require_user()
        token = services.normalize_token((data or {}).get("room_token") or (data or {}).get("token"))
        session = services.show_podium(token)
        _broadcast_state(session)
    except Exception as exc:
        _emit_error(exc)


@socketio.on("game:host:reset")
def handle_game_host_reset(data):
    try:
        _require_user()
        token = services.normalize_token((data or {}).get("room_token") or (data or {}).get("token"))
        session = services.reset_game(token)
        _broadcast_state(session)
    except Exception as exc:
        _emit_error(exc)


@socketio.on("game:host:kick")
def handle_game_host_kick(data):
    try:
        _require_user()
        data = data or {}
        token = services.normalize_token(data.get("room_token") or data.get("token"))
        guest_id = str(data.get("guest_id") or "").strip()
        if guest_id:
            services.kick_player(token, guest_id)
        emit(
            "game:players",
            {"players": services.player_list(token), "player_count": len(services._load_players(token))},
            to=_room(token),
        )
    except Exception as exc:
        _emit_error(exc)


@socketio.on("game:guest:answer")
def handle_game_guest_answer(data):
    try:
        data = data or {}
        token = services.normalize_token(data.get("room_token") or data.get("token"))
        session, choice, all_answered = services.record_answer(token, data.get("guest_id"), data.get("choice"))
        emit("game:answered", {"choice": choice}, to=request.sid)
        emit(
            "game:progress",
            {"answered_count": len(services._answers(token)), "online_count": services.online_count(token)},
            to=_room(token),
        )
        if all_answered:
            revealed, changed = services.reveal(token)
            if changed:
                _broadcast_state(revealed)
    except Exception as exc:
        if isinstance(exc, services.QuizGameError) and exc.reason in ("already_answered", "time_up", "not_open"):
            emit("game:answer_rejected", {"reason": exc.reason, "message": str(exc)}, to=request.sid)
            return
        _emit_error(exc)
