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


def user_can_submit_claims(user):
    return "account_submit" in resolve_user_permissions(user)


def user_can_read_all_claims(user):
    permissions = resolve_user_permissions(user)
    return "account_read" in permissions or "account_edit" in permissions


def user_can_list_claims(user):
    permissions = resolve_user_permissions(user)
    return any(permission in permissions for permission in {"account_submit", "account_read", "account_edit"})


def user_can_manage_claims(user):
    return "account_edit" in resolve_user_permissions(user)


def require_claim_submit_permission():
    user = require_authenticated_user()
    if not user_can_submit_claims(user):
        raise PermissionDenied("没有 account_submit 权限")
    return user


def require_claim_list_permission():
    user = require_authenticated_user()
    if not user_can_list_claims(user):
        raise PermissionDenied("没有查看报销单权限")
    return user


def require_claim_edit_permission():
    user = require_authenticated_user()
    if not user_can_manage_claims(user):
        raise PermissionDenied("没有 account_edit 权限")
    return user
