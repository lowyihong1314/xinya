from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation

from app.timezone import malaysia_now_naive
from ..common.payment import normalize_fahui_payment_status
from models.fahui import FahuiOrder, FahuiOrderItem, FahuiPayment


def active_order_version(reference: datetime | None = None) -> str:
    # 用马来西亚时间取年份：utcnow 在元旦 00:00-08:00（MYT）还停留在去年，会把新单写去去年的版本。
    target = reference or malaysia_now_naive()
    return f"{target.year}_YLP"


ACTIVE_ORDER_VERSION = active_order_version()


def normalize_version(version: object) -> str | None:
    if version is None:
        return None

    text = str(version).strip()
    if not text:
        return None

    if text.isdigit():
        return f"{text}_YLP"

    return text


def format_created_at(value: datetime | None) -> str | None:
    if not value:
        return None
    return value.strftime("%y-%m-%d_%H:%M")


def format_datetime(value: datetime | None) -> str | None:
    if not value:
        return None
    return value.strftime("%Y-%m-%d %H:%M:%S")


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return phone
    if len(phone) <= 4:
        return phone
    return "X" * (len(phone) - 4) + phone[-4:]


def get_item_form_value(item: FahuiOrderItem, field_name: str) -> str | None:
    for field in item.form_data or []:
        if field.field_name == field_name:
            return field.field_value
    return None


def item_price_decimal(item: FahuiOrderItem) -> Decimal:
    price_value = item.price
    if item.code == "D":
        override_price = get_item_form_value(item, "price")
        if override_price is not None:
            price_value = override_price

    try:
        return Decimal(str(price_value or "0")).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.00")


def item_price_int(item: FahuiOrderItem) -> int:
    return int(item_price_decimal(item))


def order_total_amount(order: FahuiOrder) -> Decimal:
    total = Decimal("0.00")
    for item in order.items or []:
        total += item_price_decimal(item)
    return total.quantize(Decimal("0.01"))


def order_all_payments(order: FahuiOrder) -> list[FahuiPayment]:
    # 直接付款（order_id）+ 合并付款（join 表）去重。
    seen: dict[int, FahuiPayment] = {}
    for payment in list(order.payments or []):
        if payment.id is not None:
            seen[payment.id] = payment
    for payment in list(getattr(order, "grouped_payments", None) or []):
        if payment.id is not None:
            seen[payment.id] = payment
    return list(seen.values())


def latest_payment(order: FahuiOrder) -> FahuiPayment | None:
    payments = order_all_payments(order)
    if not payments:
        return None
    return max(payments, key=lambda item: (item.created_at or datetime.min, item.id or 0))


def order_payment_status(order: FahuiOrder) -> str:
    payments = order_all_payments(order)
    if not payments:
        return "none"
    if any(normalize_fahui_payment_status(payment.status) == "approved" for payment in payments):
        return "paid"
    return "pending"


def order_payment_state(order: FahuiOrder) -> str:
    # 精确状态（含合并付款），用于「我要付款」时判断订单能否被选：
    # none/rejected → 可选；pending/paid → 不可选（除非失败=rejected）。
    statuses = [normalize_fahui_payment_status(p.status) for p in order_all_payments(order)]
    if not statuses:
        return "none"
    if "approved" in statuses:
        return "paid"
    if any(status != "rejected" for status in statuses):
        return "pending"
    return "rejected"
