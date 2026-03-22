from functools import wraps

from flask import jsonify
from flask_login import current_user

from app.extensions import login_manager
from models.user_data import User

permission_names = [
    "department",
    "department_edit",
    "account",
    "account_edit",
    "member",
    "member_edit",
    "event",
    "event_edit",
    "permission",
    "permission_edit",
    "music_edit",
    "edit_info",
]


@login_manager.unauthorized_handler
def unauthorized():
    return jsonify({"status": "error", "message": "unauthorized"}), 401


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


def get_current_user_permissions(user):
    permissions = set()
    for dept in getattr(user, "departments", []):
        for perm in getattr(dept, "permissions", []):
            permissions.add(perm.name)
    return permissions


def permission_required(permission_name):
    def decorator(func):
        @wraps(func)
        def decorated_function(*args, **kwargs):
            if not current_user.is_authenticated:
                return (
                    jsonify(
                        {
                            "status": "error",
                            "message": "无法验证用户权限，请联系管理员。",
                        }
                    ),
                    500,
                )

            try:
                user_permissions = get_current_user_permissions(current_user)
            except Exception as exc:
                print(f"[权限错误] 读取权限失败: {exc}")
                return (
                    jsonify(
                        {
                            "status": "error",
                            "message": "无法验证用户权限，请联系管理员。",
                        }
                    ),
                    500,
                )

            if permission_name not in user_permissions:
                username = current_user.username or "未知用户"
                message = f"用户 {username} 没有权限: {permission_name}"
                print("[权限拒绝]", message)
                return jsonify({"status": "error", "message": message}), 403

            return func(*args, **kwargs)

        return decorated_function

    return decorator
