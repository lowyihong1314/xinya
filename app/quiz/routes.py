from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from app.extensions import socket_broker

from . import services

quiz_bp = Blueprint("quiz_bp", __name__)


def _json_error(error):
    if isinstance(error, services.QuizError):
        return jsonify({"status": "error", "message": str(error), "reason": error.reason}), error.status_code
    return jsonify({"status": "error", "message": "抢答服务错误", "reason": "server_error"}), 500


def _broadcast_snapshot(event_name, session_or_token):
    snapshot = services.build_snapshot(session_or_token)
    socket_broker.emit(event_name, snapshot, to=services.socket_room(snapshot["room_token"]))
    return snapshot


@quiz_bp.route("/session", methods=["POST"])
@login_required
def create_quiz_session():
    try:
        session = services.create_session(getattr(current_user, "id", None))
        snapshot = services.build_snapshot(session)
        return jsonify({"status": "success", "session": snapshot, "token": session["room_token"]})
    except Exception as exc:
        return _json_error(exc)


@quiz_bp.route("/session", methods=["GET"])
@quiz_bp.route("/session/<token>", methods=["GET"])
def get_quiz_session(token=None):
    try:
        token = token or request.args.get("token")
        snapshot = services.build_snapshot(token)
        return jsonify({"status": "success", "session": snapshot})
    except Exception as exc:
        return _json_error(exc)


@quiz_bp.route("/session/<token>", methods=["POST"])
@login_required
def save_quiz_session(token):
    try:
        payload = request.get_json(silent=True) or {}
        session = services.save_config(token, payload.get("config") or payload)
        snapshot = _broadcast_snapshot("quiz:config_updated", session)
        return jsonify({"status": "success", "session": snapshot})
    except Exception as exc:
        return _json_error(exc)


@quiz_bp.route("/session/<token>/publish", methods=["POST"])
@login_required
def publish_quiz_session(token):
    try:
        session = services.publish_session(token)
        snapshot = _broadcast_snapshot("quiz:config_updated", session)
        return jsonify({"status": "success", "session": snapshot})
    except Exception as exc:
        return _json_error(exc)


@quiz_bp.route("/session/<token>/reset", methods=["POST"])
@login_required
def reset_quiz_session(token):
    try:
        session = services.reset_session(token)
        snapshot = _broadcast_snapshot("quiz:config_updated", session)
        return jsonify({"status": "success", "session": snapshot})
    except Exception as exc:
        return _json_error(exc)


@quiz_bp.route("/session/<token>/close", methods=["POST"])
@login_required
def close_quiz_session(token):
    try:
        session = services.close_session(token)
        snapshot = _broadcast_snapshot("quiz:config_updated", session)
        return jsonify({"status": "success", "session": snapshot})
    except Exception as exc:
        return _json_error(exc)
