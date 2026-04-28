from flask_login import current_user

from app.asset.exceptions import AuthenticationRequired, PermissionDenied
from app.auth import get_current_user_permissions


def require_authenticated_user():
    if not current_user.is_authenticated:
        raise AuthenticationRequired()
    return current_user


def resolve_user_permissions(user):
    try:
        return get_current_user_permissions(user)
    except Exception as exc:
        raise PermissionDenied("无法读取资产模块权限") from exc


def user_can_read_assets(user):
    permissions = resolve_user_permissions(user)
    return any(
        permission in permissions
        for permission in {
            "asset_read",
            "asset_edit",
            "account_read",
            "account_edit",
        }
    )


def user_can_edit_assets(user):
    permissions = resolve_user_permissions(user)
    return any(permission in permissions for permission in {"asset_edit", "account_edit"})


def require_asset_read_permission():
    user = require_authenticated_user()
    if not user_can_read_assets(user):
        raise PermissionDenied("没有资产读取权限")
    return user


def require_asset_edit_permission():
    user = require_authenticated_user()
    if not user_can_edit_assets(user):
        raise PermissionDenied("没有资产编辑权限")
    return user
