"""法会数据读取的访问控制：
- 管理端：fahui_read / account_read / account_edit 任一权限
- 公开端：手机号经 OTP 验证后（session["verified_phones"]），只能读自己手机号名下的记录

原 backend/app/fahui/common/access.py。逻辑一个字没动，只换了三样东西的来源：
``flask_login.current_user`` → ``core.auth`` 的 ContextVar 代理、
``flask.session`` → ``common/session_state.py`` 的只读取值、
``jsonify(x), 403`` → ``json_response(x, 403)``。
"""

from backend.core.auth import current_user
from backend.core.responses import json_response

from .phone import canonical_phone as _canonical_phone
from .session_state import session_data

FAHUI_READ_PERMISSION_NAMES = ("fahui_read", "account_read", "account_edit")


def has_fahui_read():
    if not getattr(current_user, "is_authenticated", False):
        return False
    names = set()
    for dept in getattr(current_user, "departments", []) or []:
        for perm in getattr(dept, "permissions", []) or []:
            names.add(perm.name)
    return any(name in names for name in FAHUI_READ_PERMISSION_NAMES)


def verified_phones():
    # 照搬 ``session.get("verified_phones") or []``：键不存在、值是 None、值是 []
    # 三种都落到空列表；顺手滤掉列表里的空串（OTP 那边偶尔写进去过）。
    return [p for p in (session_data().get("verified_phones") or []) if p]


def phone_is_verified(phone):
    target = _canonical_phone(phone)
    if not target:
        return False
    return any(_canonical_phone(p) == target for p in verified_phones())


def phones_match(a, b):
    ca, cb = _canonical_phone(a), _canonical_phone(b)
    return bool(ca) and ca == cb


def can_access_phone_records(phone):
    """是否可读取该手机号名下的法会记录：
    管理权限 / OTP 已验证该号 / 已登录且账号绑定的就是该号。"""
    if has_fahui_read():
        return True
    if phone_is_verified(phone):
        return True
    if getattr(current_user, "is_authenticated", False) and phones_match(
        getattr(current_user, "phone", None), phone
    ):
        return True
    return False


def owner_or_reader_denied():
    # 文案含「手机验证」：公开页前端以此识别并清除本地缓存、重新弹验证。
    return json_response({"status": "error", "message": "请先完成手机验证，或使用有权限的账号登录"}, 403)
