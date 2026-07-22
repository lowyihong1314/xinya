from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from flask import jsonify, make_response, request
from flask_login import current_user
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

from ..common.payment import (
    PAYMENT_TYPE_YLP,
    is_allowed_payment_upload,
    normalize_fahui_payment_status,
    save_payment_upload as save_common_payment_upload,
)
from ..common.payment_review import (
    serialize_payment as serialize_fahui_payment,
)
from app.paths import DATA_ROOT
from models import db
from models.fahui import FahuiOrder, FahuiPayment

from .receipt import build_receipt_bytes, send_raw_to_printer
from .services import user_can_view_order
from .shared import (
    active_order_version,
    item_price_decimal,
    latest_payment,
    order_payment_state,
    order_total_amount,
)

ALLOWED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg"}
FAHUI_PAYMENT_DIR = DATA_ROOT / "fahui_payment"

FIELD_LABEL = {
    "father": "父",
    "mother": "母",
    "owner": "阳上",
    "relation": "关系",
    "suffix": "字段",
    "surname": "姓氏",
    "deceased": "亡者姓名",
    "price": "金额",
    "quantity": "数量",
}

def allowed_file(filename: str | None) -> bool:
    return is_allowed_payment_upload(filename, allowed_extensions=ALLOWED_EXTENSIONS)


def is_allowed_upload(filename: str | None) -> bool:
    return allowed_file(filename)


def translate_field_label(value: str | None) -> str | None:
    if not value:
        return value
    for key, label in FIELD_LABEL.items():
        if value.startswith(key):
            return label
    return value


def calculate_total_price(order: FahuiOrder) -> Decimal:
    return order_total_amount(order)


def save_payment_upload(order_id: int, upload) -> str:
    filename = upload.filename or "proof"
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    extension = Path(filename).suffix or ""
    save_name = f"{order_id}_{timestamp}{extension}"
    return save_common_payment_upload(
        upload,
        save_dir=FAHUI_PAYMENT_DIR,
        save_name=save_name,
        return_relative_dir=Path("fahui_payment"),
    )


def serialize_payment(payment: FahuiPayment, include_order: bool = False) -> dict:
    return serialize_fahui_payment(payment, include_order=include_order)


def create_payment_record(order_id: int):
    payload = request.form if request.form else (request.get_json(silent=True) or {})
    payment_mode = (payload.get("payment_mode") or payload.get("method") or "").strip()
    upload = request.files.get("file")

    if not payment_mode:
        return jsonify({"success": False, "message": "缺少 payment_mode"}), 400

    order = FahuiOrder.query.get(order_id)
    if not order:
        return jsonify({"success": False, "message": "订单不存在"}), 404
    if order.version != active_order_version():
        return jsonify({"success": False, "message": "订单版本已过期"}), 400

    if not current_user.is_authenticated and payment_mode.lower() in {"bank", "qr"}:
        if not upload:
            return jsonify({"success": False, "message": "未登录用户必须上传文件"}), 400
        if not is_allowed_upload(upload.filename):
            return jsonify({"success": False, "message": "文件类型不允许"}), 400

    if upload and not is_allowed_upload(upload.filename):
        return jsonify({"success": False, "message": "文件类型不允许"}), 400

    try:
        payment = FahuiPayment(
            payment_type=PAYMENT_TYPE_YLP,
            order_id=order_id,
            total_price=calculate_total_price(order),
            payment_mode=payment_mode,
            document=None,
            status="pending",
            created_at=datetime.utcnow(),
        )
        db.session.add(payment)
        db.session.flush()

        if upload:
            payment.document = save_payment_upload(order_id, upload)

        db.session.commit()
        return jsonify(
            {
                "success": True,
                "message": "支付记录已保存",
                "payment_id": payment.id,
                "payment": serialize_payment(payment, include_order=True),
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"success": False, "message": str(exc)}), 500


def _parse_order_ids(payload) -> list[int]:
    raw = payload.get("order_ids")
    ids: list[int] = []
    if raw:
        parsed = raw
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
            except (ValueError, TypeError):
                parsed = [chunk for chunk in raw.replace(",", " ").split() if chunk]
        if isinstance(parsed, (list, tuple)):
            for value in parsed:
                try:
                    ids.append(int(value))
                except (TypeError, ValueError):
                    continue
    if not ids and hasattr(payload, "getlist"):
        for value in payload.getlist("order_ids"):
            if str(value).strip().isdigit():
                ids.append(int(value))
    # 去重保序
    seen: set[int] = set()
    unique: list[int] = []
    for oid in ids:
        if oid not in seen:
            seen.add(oid)
            unique.append(oid)
    return unique


def create_group_payment():
    """一次付款覆盖多张订单（多条订单 → 单条付款记录）。"""
    payload = request.form if request.form else (request.get_json(silent=True) or {})
    payment_mode = (payload.get("payment_mode") or payload.get("method") or "").strip()
    upload = request.files.get("file")
    order_ids = _parse_order_ids(payload)

    if not order_ids:
        return jsonify({"success": False, "message": "请选择要付款的订单"}), 400
    if not payment_mode:
        return jsonify({"success": False, "message": "缺少付款方式"}), 400

    active_version = active_order_version()
    orders = []
    for oid in order_ids:
        order = FahuiOrder.query.get(oid)
        if not order:
            return jsonify({"success": False, "message": f"订单 #{oid} 不存在"}), 404
        if order.version != active_version:
            return jsonify({"success": False, "message": f"订单 #{oid} 版本已过期"}), 400
        if not user_can_view_order(order):
            return jsonify({"success": False, "message": f"没有权限为订单 #{oid} 付款"}), 403
        if order_payment_state(order) not in ("none", "rejected"):
            return jsonify({"success": False, "message": f"订单 #{oid} 已付款或审核中，无法重复付款"}), 400
        orders.append(order)

    if not current_user.is_authenticated and payment_mode.lower() in {"bank", "qr"}:
        if not upload:
            return jsonify({"success": False, "message": "请上传付款凭证"}), 400
        if not is_allowed_upload(upload.filename):
            return jsonify({"success": False, "message": "文件类型不允许"}), 400
    if upload and not is_allowed_upload(upload.filename):
        return jsonify({"success": False, "message": "文件类型不允许"}), 400

    try:
        total = sum((order_total_amount(order) for order in orders), Decimal("0"))
        first = orders[0]
        payment = FahuiPayment(
            payment_type=PAYMENT_TYPE_YLP,
            order_id=None,
            total_price=total,
            payment_mode=payment_mode,
            status="pending",
            payer_name=first.customer_name or first.name,
            phone=first.phone,
            note="合并付款：订单 " + "、".join(f"#{order.id}" for order in orders),
            created_at=datetime.utcnow(),
        )
        if current_user.is_authenticated:
            payment.submitter_id = current_user.id
        payment.grouped_orders = orders
        db.session.add(payment)
        db.session.flush()

        if upload:
            payment.document = save_payment_upload(payment.id, upload)

        db.session.commit()
        return jsonify(
            {
                "success": True,
                "message": "付款资料已提交，等待核对",
                "payment_id": payment.id,
                "total_price": float(total),
                "order_ids": [order.id for order in orders],
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"success": False, "message": str(exc)}), 500


def list_order_payment_data(order_id: int):
    order = FahuiOrder.query.get(order_id)
    if not order:
        return jsonify({"success": False, "message": "订单不存在"}), 404
    if not user_can_view_order(order):
        return jsonify({"success": False, "message": "未登录或没有权限查看此订单"}), 403

    payments = (
        FahuiPayment.query.filter_by(order_id=order_id, payment_type=PAYMENT_TYPE_YLP)
        .order_by(FahuiPayment.created_at.desc(), FahuiPayment.id.desc())
        .all()
    )
    if not payments:
        return jsonify({"success": False, "message": "该订单没有支付记录"}), 404

    data = []
    for payment in payments:
        data.append(
            {
                "id": payment.id,
                "order_id": payment.order_id,
                "total_price": float(payment.total_price) if payment.total_price is not None else None,
                "payment_mode": payment.payment_mode,
                "document": payment.document,
                "status": normalize_fahui_payment_status(payment.status),
                "is_approved": normalize_fahui_payment_status(payment.status) == "approved",
                "created_at": payment.created_at.isoformat() if payment.created_at else None,
                "submitter_id": payment.submitter_id,
                "valid_by": payment.valid_by,
                "valid_at": payment.valid_at.isoformat() if payment.valid_at else None,
                "login": bool(current_user and current_user.is_authenticated),
                "is_logged_in": bool(current_user and current_user.is_authenticated),
            }
        )
    return jsonify({"success": True, "data": data})


def calculate_order_amount(order_id: int):
    order = FahuiOrder.query.get(order_id)
    if not order:
        return jsonify({"amount": 0}), 404
    return jsonify({"amount": float(calculate_total_price(order))})


def _build_quotation_pdf(order: FahuiOrder) -> bytes:
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    font_name = "STSong-Light"

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter

    y = height - 50
    c.setFont(font_name, 20)
    c.drawString(50, y, "地南佛学会 盂兰盆法会")

    y -= 32
    c.setFont(font_name, 11)
    c.drawString(50, y, f"订单编号: {order.id}")
    y -= 18
    c.drawString(50, y, f"功德主: {order.customer_name or order.name or '-'}")
    y -= 18
    c.drawString(50, y, f"联系电话: {order.phone or '-'}")
    y -= 18
    c.drawString(50, y, f"创建时间: {order.created_at.strftime('%Y-%m-%d %H:%M:%S') if order.created_at else '-'}")
    y -= 28

    c.setFont(font_name, 13)
    c.drawString(50, y, "订单项目")
    y -= 20
    c.setFont(font_name, 10)

    for item in order.items or []:
        if y < 90:
            c.showPage()
            y = height - 50
            c.setFont(font_name, 10)

        price = item_price_for_pdf(item)
        c.drawString(50, y, f"{item.item_name or item.code or '-'}")
        c.drawRightString(width - 50, y, f"RM {price:.2f}")
        y -= 16

        grouped: dict[str, list[str]] = {}
        for field in item.form_data or []:
            if field.field_name == "price":
                continue
            grouped.setdefault(field.field_name or "", []).append(str(field.field_value or ""))
        for key, values in grouped.items():
            if y < 90:
                c.showPage()
                y = height - 50
                c.setFont(font_name, 10)
            label = translate_field_label(key) or key
            c.drawString(70, y, f"{label}: {', '.join(value for value in values if value)}")
            y -= 14
        y -= 6

    if y < 90:
        c.showPage()
        y = height - 50
        c.setFont(font_name, 10)

    c.setFont(font_name, 13)
    c.drawString(50, y, f"总德金: RM {calculate_total_price(order):.2f}")
    c.save()
    buffer.seek(0)
    return buffer.read()


def item_price_for_pdf(item) -> Decimal:
    return item_price_decimal(item)


def download_order_quotation(order_id: int):
    order = FahuiOrder.query.get(order_id)
    if not order:
        return jsonify({"error": "Order not found"}), 404
    if not user_can_view_order(order):
        return jsonify({"error": "未登录或没有权限查看此订单"}), 403

    response = make_response(_build_quotation_pdf(order))
    response.headers["Content-Type"] = "application/pdf"
    response.headers["Content-Disposition"] = f"attachment; filename=order_{order_id}_quotation.pdf"
    return response


def print_receipt(order_id: int):
    order = FahuiOrder.query.get(order_id)
    if not order:
        return jsonify({"success": False, "message": "订单不存在"}), 404

    payment = latest_payment(order)

    try:
        payload = build_receipt_bytes(order, payment)
        send_raw_to_printer(payload)
        return jsonify({"success": True, "message": f"订单 {order_id} 收据已发送到打印机"})
    except Exception as exc:
        return jsonify({"success": False, "message": str(exc)}), 500
