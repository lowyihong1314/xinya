from flask import Blueprint, Response, jsonify, request
from flask_login import current_user, login_required

from . import services

mirror_bp = Blueprint("mirror_bp", __name__)


def _handle_exception(exc):
    if isinstance(exc, services.MirrorError):
        return jsonify({"status": "error", "message": str(exc), "reason": exc.reason}), exc.status_code
    print("⚠️ Mirror route error:", exc)
    return jsonify({"status": "error", "message": "活动服务错误", "reason": "server_error"}), 500


@mirror_bp.route("/session", methods=["POST"])
@login_required
def create_mirror_session():
    try:
        payload = request.get_json(silent=True) or {}
        session = services.create_session(
            getattr(current_user, "id", None),
            title=payload.get("title"),
            min_reveal_count=payload.get("min_reveal_count"),
        )
        return jsonify(
            {
                "status": "success",
                "token": session["room_token"],
                "session": services.host_snapshot(session),
            }
        )
    except Exception as exc:
        return _handle_exception(exc)


@mirror_bp.route("/session/<token>", methods=["GET"])
def get_mirror_session(token):
    """Public: lets a phone check the room is alive before joining."""
    try:
        session = services.require_session(token)
        snap = services.base_meta(session)
        snap["member_count"] = len(services.member_list(session["room_token"]))
        return jsonify({"status": "success", "session": snap})
    except Exception as exc:
        return _handle_exception(exc)


@mirror_bp.route("/session/<token>/photo", methods=["POST"])
def upload_mirror_photo(token):
    """Public: a phone posts its own selfie right after joining the room."""
    try:
        payload = request.get_json(silent=True) or {}
        _, member = services.save_photo(token, payload.get("guest_id"), payload.get("photo"))
        return jsonify({"status": "success", "photo_at_ms": member.get("photo_at_ms")})
    except Exception as exc:
        return _handle_exception(exc)


@mirror_bp.route("/session/<token>/photo/<member_id>", methods=["GET"])
def get_mirror_photo(token, member_id):
    """Public: served next to a member's name inside the room."""
    try:
        found = services.get_photo(token, member_id)
        if not found:
            return jsonify({"status": "error", "message": "没有照片", "reason": "photo_not_found"}), 404
        blob, mime = found
        response = Response(blob, mimetype=mime)
        # Private: a face photo should never sit in a shared proxy cache.
        response.headers["Cache-Control"] = "private, max-age=3600"
        return response
    except Exception as exc:
        return _handle_exception(exc)


@mirror_bp.route("/session/<token>/config", methods=["POST"])
@login_required
def save_mirror_config(token):
    try:
        payload = request.get_json(silent=True) or {}
        session = services.save_config(token, payload.get("config") or payload)
        return jsonify({"status": "success", "session": services.host_snapshot(session)})
    except Exception as exc:
        return _handle_exception(exc)
