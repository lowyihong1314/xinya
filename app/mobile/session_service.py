import hashlib
import os
import secrets
from datetime import datetime, timedelta

from flask import current_app
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from models import db
from models.user_data import MobileSession, User

ACCESS_TOKEN_SECONDS = int(os.environ.get("MOBILE_ACCESS_TOKEN_SECONDS", 30 * 60))
REFRESH_TOKEN_DAYS = int(os.environ.get("MOBILE_REFRESH_TOKEN_DAYS", 90))
TOKEN_SALT = os.environ.get("MOBILE_ACCESS_TOKEN_SALT", "xinya-mobile-session")


def _now():
    return datetime.utcnow()


def _refresh_token_hash(refresh_token):
    return hashlib.sha256(str(refresh_token).encode("utf-8")).hexdigest()


def _serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=TOKEN_SALT)


def _public_user(user):
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
    }


def _trim(value, max_length):
    text = str(value or "").strip()
    return text[:max_length] or None


def _login_version(user):
    return getattr(user, "login_version", 0) or 0


def _access_token_for_session(session_obj):
    return _serializer().dumps(
        {
            "sid": session_obj.id,
            "uid": session_obj.user_id,
            "ver": session_obj.login_version,
        }
    )


def _payload(session_obj, refresh_token=None):
    user = session_obj.user
    result = {
        "access_token": _access_token_for_session(session_obj),
        "expires_at": (_now() + timedelta(seconds=ACCESS_TOKEN_SECONDS)).isoformat() + "Z",
        "session_id": session_obj.id,
        "user": _public_user(user),
    }
    if refresh_token:
        result["refresh_token"] = refresh_token
    return result


def create_mobile_session(user, *, device_id=None, platform=None, user_agent=None):
    refresh_token = secrets.token_urlsafe(48)
    now = _now()
    session_obj = MobileSession(
        user_id=user.id,
        device_id=_trim(device_id, 120),
        refresh_token_hash=_refresh_token_hash(refresh_token),
        user_agent=_trim(user_agent, 255),
        platform=_trim(platform, 50),
        login_version=_login_version(user),
        created_at=now,
        refreshed_at=now,
        expires_at=now + timedelta(days=REFRESH_TOKEN_DAYS),
    )
    db.session.add(session_obj)
    db.session.commit()
    return _payload(session_obj, refresh_token)


def _validate_refresh_session(session_obj):
    now = _now()
    if not session_obj:
        raise ValueError("refresh token is invalid")
    if session_obj.revoked_at is not None:
        raise ValueError("mobile session is revoked")
    if session_obj.expires_at <= now:
        session_obj.revoked_at = now
        db.session.commit()
        raise ValueError("mobile session is expired")
    if not session_obj.user:
        session_obj.revoked_at = now
        db.session.commit()
        raise ValueError("mobile session user is missing")
    if session_obj.login_version != _login_version(session_obj.user):
        session_obj.revoked_at = now
        db.session.commit()
        raise ValueError("mobile session version is expired")


def refresh_mobile_session(refresh_token, *, device_id=None, platform=None, user_agent=None):
    token_hash = _refresh_token_hash(refresh_token or "")
    session_obj = MobileSession.query.filter_by(refresh_token_hash=token_hash).first()
    _validate_refresh_session(session_obj)

    next_refresh_token = secrets.token_urlsafe(48)
    now = _now()
    session_obj.refresh_token_hash = _refresh_token_hash(next_refresh_token)
    session_obj.refreshed_at = now
    session_obj.expires_at = now + timedelta(days=REFRESH_TOKEN_DAYS)
    if device_id is not None:
        session_obj.device_id = _trim(device_id, 120)
    if platform is not None:
        session_obj.platform = _trim(platform, 50)
    if user_agent is not None:
        session_obj.user_agent = _trim(user_agent, 255)
    db.session.commit()
    return _payload(session_obj, next_refresh_token)


def revoke_mobile_session(session_obj):
    if session_obj and session_obj.revoked_at is None:
        session_obj.revoked_at = _now()
        db.session.commit()
        return True
    return False


def revoke_mobile_refresh_token(refresh_token):
    token_hash = _refresh_token_hash(refresh_token or "")
    session_obj = MobileSession.query.filter_by(refresh_token_hash=token_hash).first()
    return revoke_mobile_session(session_obj)


def revoke_all_mobile_sessions_for_user(user):
    now = _now()
    MobileSession.query.filter(
        MobileSession.user_id == user.id,
        MobileSession.revoked_at.is_(None),
    ).update({"revoked_at": now}, synchronize_session=False)
    db.session.commit()


def load_user_from_access_token(access_token):
    try:
        payload = _serializer().loads(access_token, max_age=ACCESS_TOKEN_SECONDS)
    except (BadSignature, SignatureExpired):
        return None

    session_id = payload.get("sid")
    user_id = payload.get("uid")
    token_version = payload.get("ver")
    if not session_id or not user_id:
        return None

    session_obj = MobileSession.query.get(session_id)
    if not session_obj:
        return None
    if session_obj.revoked_at is not None or session_obj.expires_at <= _now():
        return None
    if session_obj.user_id != user_id:
        return None

    user = session_obj.user or User.query.get(user_id)
    if not user:
        return None
    if session_obj.login_version != token_version:
        return None
    if _login_version(user) != token_version:
        return None
    return user


def mobile_session_from_access_token(access_token, *, enforce_age=True):
    try:
        if enforce_age:
            payload = _serializer().loads(access_token, max_age=ACCESS_TOKEN_SECONDS)
        else:
            payload = _serializer().loads(access_token)
    except (BadSignature, SignatureExpired):
        return None
    session_id = payload.get("sid")
    if not session_id:
        return None
    return MobileSession.query.get(session_id)


def revoke_mobile_access_token(access_token):
    session_obj = mobile_session_from_access_token(access_token, enforce_age=False)
    return revoke_mobile_session(session_obj)
