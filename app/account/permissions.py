from flask_login import current_user

from app.auth import get_current_user_permissions
from app.account.exceptions import AuthenticationRequired, PermissionDenied


def require_authenticated_user():
    if not current_user.is_authenticated:
        raise AuthenticationRequired()
    return current_user


def resolve_user_permissions(user):
    try:
        return get_current_user_permissions(user)
    except Exception as exc:
        raise PermissionDenied("无法读取权限") from exc


def user_can_manage_claims(user):
    return "account" in resolve_user_permissions(user)


def require_account_permission():
    user = require_authenticated_user()
    if not user_can_manage_claims(user):
        raise PermissionDenied("没有 account 权限")
    return user
