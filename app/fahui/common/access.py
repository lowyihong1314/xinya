"""法会数据读取的访问控制：
- 管理端：fahui_read / account_read / account_edit 任一权限
- 公开端：手机号经 OTP 验证后（session["verified_phones"]），只能读自己手机号名下的记录
"""

import re

from flask import jsonify, session
from flask_login import current_user

FAHUI_READ_PERMISSION_NAMES = ("fahui_read", "account_read", "account_edit")


def _canonical_phone(value):
    digits = re.sub(r"\D", "", str(value or ""))
    if digits.startswith("60"):
        digits = digits[2:]
    if digits.startswith("0"):
        digits = digits[1:]
    return digits


def has_fahui_read():
    if not getattr(current_user, "is_authenticated", False):
        return False
    names = set()
    for dept in getattr(current_user, "departments", []) or []:
        for perm in getattr(dept, "permissions", []) or []:
            names.add(perm.name)
    return any(name in names for name in FAHUI_READ_PERMISSION_NAMES)


def verified_phones():
    return [p for p in (session.get("verified_phones") or []) if p]


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
    return jsonify({"status": "error", "message": "请先完成手机验证，或使用有权限的账号登录"}), 403
