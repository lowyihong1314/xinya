from functools import wraps

from flask import jsonify
from flask_login import current_user, login_required

from app.auth import get_current_user_permissions


FORM_READ_PERMISSION_NAMES = {"form_read", "form_edit", "member_detail"}
FORM_EDIT_PERMISSION_NAMES = {"form_edit"}
FORM_MEMBER_DETAIL_PERMISSION_NAMES = {"member_detail", "form_edit"}
FORM_LIST_PERMISSION_NAMES = FORM_READ_PERMISSION_NAMES | {"account_read", "account_edit"}
FORM_PAYMENT_READ_PERMISSION_NAMES = FORM_MEMBER_DETAIL_PERMISSION_NAMES | {"account_read", "account_edit"}
FORM_PAYMENT_EDIT_PERMISSION_NAMES = {"account_edit"}
YOUTH_CLASS_READ_PERMISSION_NAMES = {"youth_class_read", "youth_class_edit", "council_approve"}
YOUTH_CLASS_EDIT_PERMISSION_NAMES = {"youth_class_edit"}
YOUTH_CLASS_COUNCIL_PERMISSION_NAMES = {"council_approve"}


def current_user_permission_names():
    if not current_user.is_authenticated:
        return set()
    return set(get_current_user_permissions(current_user))


def current_user_has_any_permission(permission_names):
    return bool(current_user_permission_names() & set(permission_names))


def permission_denied_response(permission_names):
    joined = " / ".join(sorted(set(permission_names)))
    return jsonify({"status": "error", "message": f"缺少权限，需要以下任一权限：{joined}"}), 403


def permission_required_any(*permission_names):
    required_names = tuple(sorted(set(permission_names)))

    def decorator(func):
        @wraps(func)
        @login_required
        def wrapped(*args, **kwargs):
            if not current_user_has_any_permission(required_names):
                return permission_denied_response(required_names)
            return func(*args, **kwargs)

        return wrapped

    return decorator
