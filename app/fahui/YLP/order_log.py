"""订单改动日志：谁、什么时候、把哪个字段从什么改成了什么。

公开登记页的访客没有账号，只有 OTP 验证过的手机号，所以「谁」有两种来源：
登录用户记 user_id + 显示名，访客记 session 里的已验证手机号。

写日志一律不 commit —— 由调用方（服务层）在自己那次 commit 里一起落库，
避免把一次编辑拆成两个事务、中途失败留下半截日志。
"""
from __future__ import annotations

from flask import has_request_context
from flask_login import current_user

from models import db
from models.fahui import FahuiOrderLog

from ..common.session_state import current_session_phone, current_verified_phones

# 牌位表单字段 → 中文名，日志里直接给人看
FIELD_LABELS = {
    "owner": "阳上",
    "deceased": "对象",
    "relation": "关系",
    "surname": "姓氏",
    "suffix": "后缀",
    "father": "父",
    "mother": "母",
    "quantity": "数量",
    "price": "金额",
    "code": "牌位类型",
    "item_name": "项目名称",
    "customer_name": "功德主",
    "name": "联络人",
    "phone": "电话",
    "email": "Email",
    "status": "订单状态",
    "version": "版本",
}


def field_label(name) -> str:
    key = str(name or "").strip()
    return FIELD_LABELS.get(key, key or "字段")


def _actor():
    """返回 (user_id, user_name, phone)。后台操作有 user_id，公开页访客只有手机号。"""
    if not has_request_context():
        return None, None, None

    if getattr(current_user, "is_authenticated", False):
        name = (
            getattr(current_user, "display_name", None)
            or getattr(current_user, "username", None)
            or getattr(current_user, "name_NRIC", None)
        )
        return current_user.id, (str(name).strip() if name else None), None

    phone = current_session_phone()
    if not phone:
        verified = current_verified_phones()
        phone = sorted(verified)[0] if verified else None
    return None, None, phone


def _text(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        joined = "、".join(str(item).strip() for item in value if str(item or "").strip())
        return joined or None
    text = str(value).strip()
    return text or None


def log_order_change(
    order_id,
    *,
    target="order",
    action="update",
    field=None,
    old=None,
    new=None,
    summary=None,
    item_id=None,
):
    """记一条改动。不 commit，交给调用方那次 commit 一起落库。"""
    if not order_id:
        return None

    user_id, user_name, phone = _actor()
    entry = FahuiOrderLog(
        order_id=order_id,
        item_id=item_id,
        target=target,
        action=action,
        field=str(field)[:64] if field else None,
        old_value=_text(old),
        new_value=_text(new),
        summary=summary,
        user_id=user_id,
        user_name=user_name,
        phone=phone,
    )
    db.session.add(entry)
    return entry


def log_field_changes(order_id, changes, *, target="order", item_id=None, prefix=""):
    """changes: [(field, old, new)]，只记真的变了的。返回记了几条。"""
    written = 0
    for field, old, new in changes or []:
        old_text = _text(old)
        new_text = _text(new)
        if old_text == new_text:
            continue
        label = field_label(field)
        summary = f"{prefix}{label}：{old_text or '（空）'} → {new_text or '（空）'}"
        log_order_change(
            order_id,
            target=target,
            action="update",
            field=field,
            old=old_text,
            new=new_text,
            summary=summary,
            item_id=item_id,
        )
        written += 1
    return written


def item_snapshot(item) -> dict:
    """把一个牌位项目拍平成 {字段: 值}，用来做前后对比。"""
    if item is None:
        return {}
    snapshot = {"code": item.code, "price": str(item.price) if item.price is not None else None}
    if item.item_name:
        snapshot["item_name"] = item.item_name
    grouped: dict[str, list[str]] = {}
    for field in item.form_data or []:
        key = str(field.field_name or "").strip()
        if not key:
            continue
        grouped.setdefault(key, []).append(str(field.field_value or "").strip())
    for key, values in grouped.items():
        snapshot[key] = "、".join(value for value in values if value)
    return snapshot


def describe_item(snapshot: dict) -> str:
    """牌位的一句话描述，用在新增 / 删除的日志里。"""
    code = str(snapshot.get("code") or "").strip()
    parts = []
    for key in ("owner", "deceased", "surname", "father", "mother"):
        value = str(snapshot.get(key) or "").strip()
        if value:
            parts.append(f"{field_label(key)} {value}")
    price = str(snapshot.get("price") or "").strip()
    tail = f"（RM {price}）" if price else ""
    return f"{code or '牌位'} {' / '.join(parts)}{tail}".strip()


def diff_item_snapshots(before: dict, after: dict):
    """返回 [(field, old, new)]，含新增 / 删除的字段。"""
    changes = []
    for key in sorted(set(before) | set(after)):
        old = before.get(key)
        new = after.get(key)
        if (old or None) != (new or None):
            changes.append((key, old, new))
    return changes


def list_order_logs(order_id, limit=200):
    rows = (
        FahuiOrderLog.query.filter_by(order_id=order_id)
        .order_by(FahuiOrderLog.created_at.desc(), FahuiOrderLog.id.desc())
        .limit(limit)
        .all()
    )
    return [row.to_dict() for row in rows]
