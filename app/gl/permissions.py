from flask_login import current_user

from app.auth import get_current_user_permissions
from app.gl.exceptions import AuthenticationRequired, PermissionDenied


def require_authenticated_user():
    if not current_user.is_authenticated:
        raise AuthenticationRequired()
    return current_user


def resolve_user_permissions(user):
    try:
        return get_current_user_permissions(user)
    except Exception as exc:
        raise PermissionDenied("无法读取总账模块权限") from exc


def user_can_read_gl(user):
    permissions = resolve_user_permissions(user)
    return any(permission in permissions for permission in {"account_read", "account_edit"})


def user_can_edit_gl(user):
    return "account_edit" in resolve_user_permissions(user)


def require_gl_read_permission():
    user = require_authenticated_user()
    if not user_can_read_gl(user):
        raise PermissionDenied("没有总账读取权限")
    return user


def require_gl_edit_permission():
    user = require_authenticated_user()
    if not user_can_edit_gl(user):
        raise PermissionDenied("没有 account_edit 权限")
    return user
