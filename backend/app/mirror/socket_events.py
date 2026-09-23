"""Socket.IO handlers for 「别人眼中的我」.

Host screen and phones share one room. State changes are broadcast as a thin
``mirror:state`` ping and each client then pulls **its own** snapshot — unlike
the 问答游戏, the payload differs per person here (everyone rates a different
list and later sees only their own result), so nothing per-person is ever
broadcast to the room.
"""

from flask import request
from flask_login import current_user
from flask_socketio import emit, join_room

from backend.app.extensions import socketio

from . import services


def _room(token):
    return services.socket_room(token)


def _emit_error(exc):
    if isinstance(exc, services.MirrorError):
        emit(
            "mirror:error",
            {"status": "error", "message": str(exc), "reason": exc.reason, "status_code": exc.status_code},
            to=request.sid,
        )
        return
    print("⚠️ Mirror socket error:", exc)
    emit("mirror:error", {"status": "error", "message": "活动服务错误", "reason": "server_error"}, to=request.sid)


def _require_user():
    if not getattr(current_user, "is_authenticated", False):
        raise services.MirrorError("请先登录", 401, "unauthorized")


def _broadcast_state(session):
    """Tell the room the phase changed; every client re-syncs its own view."""
    emit(
        "mirror:state",
        {"status": session.get("status", "lobby"), "room_token": session["room_token"]},
        to=_room(session["room_token"]),
    )


def _broadcast_progress(session):
    token = session["room_token"]
    members = services.member_list(token)
    emit(
        "mirror:progress",
        {
            "members": members,
            "member_count": len(members),
            "finished_count": len(services.finished_ids(session, token)),
            "roster_count": len(session.get("roster") or []),
        },
        to=_room(token),
    )


def _member_from(token, guest_id):
    guest_id = str(guest_id or "").strip()
    members = services._load_members(token)
    member = members.get(guest_id)
    if not member:
        raise services.MirrorError("请先加入活动", 409, "not_joined")
    return member


@socketio.on("mirror:host:join")
def handle_mirror_host_join(data):
    try:
        token = services.normalize_token((data or {}).get("room_token") or (data or {}).get("token"))
        join_room(_room(token))
        emit("mirror:host", services.host_snapshot(services.require_session(token)), to=request.sid)
    except Exception as exc:
        _emit_error(exc)


@socketio.on("mirror:host:sync")
def handle_mirror_host_sync(data):
    try:
        token = services.normalize_token((data or {}).get("room_token") or (data or {}).get("token"))
        emit("mirror:host", services.host_snapshot(services.require_session(token)), to=request.sid)
    except Exception as exc:
        _emit_error(exc)


@socketio.on("mirror:guest:join")
def handle_mirror_guest_join(data):
    try:
        data = data or {}
        token = services.normalize_token(data.get("room_token") or data.get("token"))
        session, member = services.add_member(
            token, data.get("guest_id"), data.get("guest_name"), sid=request.sid
        )
        join_room(_room(session["room_token"]))
        emit("mirror:joined", {"id": member["id"], "name": member["name"]}, to=request.sid)
        emit("mirror:player", services.player_snapshot(session, member), to=request.sid)
        _broadcast_progress(session)
    except Exception as exc:
        _emit_error(exc)


@socketio.on("mirror:guest:sync")
def handle_mirror_guest_sync(data):
    try:
        data = data or {}
        token = services.normalize_token(data.get("room_token") or data.get("token"))
        session = services.require_session(token)
        member = _member_from(session["room_token"], data.get("guest_id"))
        emit("mirror:player", services.player_snapshot(session, member), to=request.sid)
    except Exception as exc:
        _emit_error(exc)


@socketio.on("mirror:host:start")
def handle_mirror_host_start(data):
    try:
        _require_user()
        token = services.normalize_token((data or {}).get("room_token") or (data or {}).get("token"))
        session = services.start_round(token)
        _broadcast_state(session)
        _broadcast_progress(session)
    except Exception as exc:
        _emit_error(exc)


@socketio.on("mirror:host:reveal")
def handle_mirror_host_reveal(data):
    try:
        _require_user()
        token = services.normalize_token((data or {}).get("room_token") or (data or {}).get("token"))
        session, changed = services.reveal_results(token)
        if changed:
            _broadcast_state(session)
    except Exception as exc:
        _emit_error(exc)


@socketio.on("mirror:host:reset")
def handle_mirror_host_reset(data):
    try:
        _require_user()
        token = services.normalize_token((data or {}).get("room_token") or (data or {}).get("token"))
        session = services.reset_round(token)
        _broadcast_state(session)
        _broadcast_progress(session)
    except Exception as exc:
        _emit_error(exc)


@socketio.on("mirror:host:kick")
def handle_mirror_host_kick(data):
    try:
        _require_user()
        data = data or {}
        token = services.normalize_token(data.get("room_token") or data.get("token"))
        session = services.remove_member(token, data.get("guest_id"))
        _broadcast_progress(session)
    except Exception as exc:
        _emit_error(exc)


@socketio.on("mirror:guest:rate")
def handle_mirror_guest_rate(data):
    try:
        data = data or {}
        token = services.normalize_token(data.get("room_token") or data.get("token"))
        session, all_done = services.record_rating(
            token, data.get("guest_id"), data.get("target_id"), data.get("score")
        )
        member = _member_from(session["room_token"], data.get("guest_id"))
        emit("mirror:player", services.player_snapshot(session, member), to=request.sid)
        _broadcast_progress(session)
        if all_done:
            # Everyone is done: results open by themselves, no host tap needed.
            revealed, changed = services.reveal_results(session["room_token"])
            if changed:
                _broadcast_state(revealed)
    except Exception as exc:
        if isinstance(exc, services.MirrorError) and exc.reason in ("not_open", "not_in_roster"):
            emit("mirror:rate_rejected", {"reason": exc.reason, "message": str(exc)}, to=request.sid)
            return
        _emit_error(exc)
