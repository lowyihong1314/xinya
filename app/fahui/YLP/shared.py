from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation

from ..common.payment import normalize_fahui_payment_status
from models.fahui import FahuiOrder, FahuiOrderItem, FahuiPayment


def active_order_version(reference: datetime | None = None) -> str:
    target = reference or datetime.utcnow()
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


def latest_payment(order: FahuiOrder) -> FahuiPayment | None:
    payments = list(order.payments or [])
    if not payments:
        return None
    return max(payments, key=lambda item: (item.created_at or datetime.min, item.id or 0))


def order_payment_status(order: FahuiOrder) -> str:
    payment = latest_payment(order)
    return normalize_fahui_payment_status(payment.status) if payment else "not-ready"
