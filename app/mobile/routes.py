from datetime import timedelta

from flask import Blueprint, jsonify, request, session as flask_session
from flask_login import current_user, login_required, login_user

from app.mobile.session_service import (
    create_mobile_session,
    refresh_mobile_session,
    revoke_all_mobile_sessions_for_user,
    revoke_mobile_access_token,
    revoke_mobile_refresh_token,
)
from models.user_data import User

mobile_bp = Blueprint("mobile", __name__)


def _json_payload():
    return request.get_json(silent=True) or {}


def _client_metadata(data=None):
    payload = data or {}
    return {
        "device_id": payload.get("device_id") or payload.get("deviceId"),
        "platform": payload.get("platform"),
        "user_agent": payload.get("user_agent") or payload.get("userAgent") or request.user_agent.string,
    }


def _authorization_token():
    header = (request.headers.get("Authorization") or "").strip()
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    return token or None


def _login_user_cookie(user):
    flask_session.permanent = True
    login_user(user, remember=True, duration=timedelta(days=7))
    flask_session["login_version"] = user.login_version


@mobile_bp.post("/session/login")
def mobile_login():
    data = _json_payload()
    username = str(data.get("username") or "").strip()
    password = data.get("password")
    if not username or not password:
        return jsonify({"error": "用户名和密码不能为空"}), 400

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_password(password):
        return jsonify({"error": "用户名或密码错误"}), 401

    _login_user_cookie(user)
    payload = create_mobile_session(user, **_client_metadata(data))
    return jsonify({"success": True, **payload})


@mobile_bp.post("/session/exchange")
@login_required
def exchange_mobile_session():
    data = _json_payload()
    payload = create_mobile_session(current_user, **_client_metadata(data))
    return jsonify({"success": True, **payload})


@mobile_bp.post("/session/refresh")
def refresh_session():
    data = _json_payload()
    refresh_token = data.get("refresh_token") or data.get("refreshToken")
    if not refresh_token:
        return jsonify({"error": "refresh_token is required"}), 400

    try:
        payload = refresh_mobile_session(refresh_token, **_client_metadata(data))
        return jsonify({"success": True, **payload})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 401


@mobile_bp.get("/session/me")
@login_required
def current_mobile_user():
    return jsonify({"success": True, "user": current_user.to_dict()})


@mobile_bp.route("/session/logout", methods=["DELETE", "POST"])
def logout_mobile_session():
    data = _json_payload()
    revoked = False
    refresh_token = data.get("refresh_token") or data.get("refreshToken")
    if refresh_token:
        revoked = revoke_mobile_refresh_token(refresh_token) or revoked

    access_token = _authorization_token()
    if access_token:
        revoked = revoke_mobile_access_token(access_token) or revoked

    return jsonify({"status": "success", "revoked": revoked})


@mobile_bp.route("/session/logout_all", methods=["DELETE", "POST"])
@login_required
def logout_all_mobile_sessions():
    revoke_all_mobile_sessions_for_user(current_user)
    return jsonify({"status": "success"})
