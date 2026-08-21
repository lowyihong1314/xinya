from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from pathlib import Path

from flask import jsonify
from flask_login import current_user
from sqlalchemy.orm import selectinload

from app.paths import DATA_ROOT, PROJECT_ROOT
from models import db
from models.fahui import FahuiOrder, FahuiPayment
from models.lampRegistration import Lamp, LampRegistration

from .payment import (
    PAYMENT_STATUS_ALIASES,
    PAYMENT_TYPE_LAMP,
    PAYMENT_TYPE_YLP,
    build_payment_review_state,
    normalize_fahui_payment_status,
    remove_payment_file,
    send_payment_file,
)


LEGACY_FAHUI_ROOT = Path("/srv/flaskapp/fahui")
LAMP_PAYMENT_DIR = DATA_ROOT / "lamp_payment_images"
LEGACY_LAMP_PAYMENT_DIR = DATA_ROOT / "lamp_paymet_images"
PAYMENT_FILE_ROOTS = [
    PROJECT_ROOT,
    DATA_ROOT,
    LEGACY_FAHUI_ROOT,
    LAMP_PAYMENT_DIR,
    LEGACY_LAMP_PAYMENT_DIR,
]
REVIEWABLE_PAYMENT_TYPES = {PAYMENT_TYPE_LAMP, PAYMENT_TYPE_YLP}


def _payment_amount(payment: FahuiPayment) -> Decimal:
    return Decimal(str(payment.total_price or "0"))


def _review_state(payment: FahuiPayment) -> dict:
    return build_payment_review_state(
        raw_status=payment.status,
        reviewer=payment.submitter_id or payment.valid_by,
        aliases=PAYMENT_STATUS_ALIASES,
        approved_status="approved",
        pending_status="pending",
    )


def is_payment_approved(payment: FahuiPayment) -> bool:
    return _review_state(payment)["is_approved"]


def serialize_lamp_registration(registration: LampRegistration, *, include_payments: bool = False) -> dict:
    lamps = db.session.query(Lamp).filter(Lamp.registration_id == registration.id).all()
    data = {
        "id": registration.id,
        "devotee_name": registration.devotee_name,
        "address": registration.address,
        "phone": registration.phone,
        "total_amount": str(registration.total_amount),
        "status": registration.status,
        "created_at": registration.created_at.strftime("%Y-%m-%d %H:%M:%S")
        if registration.created_at
        else None,
        "lamps": [
            {"lamp_type": lamp.lamp_type, "amount": str(lamp.amount), "note": lamp.note}
            for lamp in lamps
        ],
    }
    if include_payments:
        data["payments"] = [serialize_payment(payment) for payment in registration.payments.all()]
    return data


def serialize_order_summary(order: FahuiOrder | None) -> dict | None:
    if not order:
        return None
    return {
        "id": order.id,
        "customer_name": order.customer_name,
        "name": order.name,
        "phone": order.phone,
        "status": normalize_fahui_payment_status(order.status, default=order.status or "pending"),
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "version": order.version,
    }


def serialize_payment(
    payment: FahuiPayment,
    *,
    include_order: bool = False,
    include_registrations: bool = False,
) -> dict:
    review_state = _review_state(payment)
    order = payment.order
    payer_name = payment.payer_name or (order.customer_name if order else None) or (order.name if order else None)
    phone = payment.phone or (order.phone if order else None)

    data = {
        "id": payment.id,
        "payment_id": payment.id,
        "type": payment.payment_type or PAYMENT_TYPE_YLP,
        "order_id": payment.order_id,
        "amount": float(_payment_amount(payment)),
        "total_price": float(_payment_amount(payment)),
        "method": payment.payment_mode,
        "payment_mode": payment.payment_mode,
        "payer_name": payer_name,
        "phone": phone,
        "paid_at": payment.paid_at.isoformat() if payment.paid_at else None,
        "created_at": payment.created_at.isoformat() if payment.created_at else None,
        "submitter_id": payment.submitter_id,
        "valid_by": payment.valid_by,
        "valid_at": payment.valid_at.isoformat() if payment.valid_at else None,
        "note": payment.note,
        "document": payment.document,
        "doc_path": payment.document,
        "status": review_state["status"],
        "is_approved": review_state["is_approved"],
    }

    if include_order and order:
        data["order"] = serialize_order_summary(order)

    if include_registrations and (payment.payment_type or PAYMENT_TYPE_YLP) == PAYMENT_TYPE_LAMP:
        data["registrations"] = [
            serialize_lamp_registration(registration, include_payments=False)
            for registration in (payment.lamp_registrations or [])
        ]

    return data


def _payment_query(payment_type: str | None = None):
    query = db.session.query(FahuiPayment).options(
        selectinload(FahuiPayment.lamp_registrations),
        selectinload(FahuiPayment.order),
    )
    if payment_type:
        query = query.filter(FahuiPayment.payment_type == payment_type)
    return query


def get_payment_or_404(payment_id: int, *, payment_type: str | None = None) -> FahuiPayment | None:
    payment = _payment_query(payment_type).filter(FahuiPayment.id == payment_id).first()
    return payment


def list_review_payments(*, payment_type: str | None = None):
    payments = (
        _payment_query(payment_type)
        .order_by(FahuiPayment.created_at.desc(), FahuiPayment.id.desc())
        .all()
    )
    return jsonify(
        {
            "success": True,
            "status": "success",
            "data": [
                serialize_payment(
                    payment,
                    include_order=True,
                    include_registrations=(payment.payment_type == PAYMENT_TYPE_LAMP),
                )
                for payment in payments
                if (payment.payment_type or PAYMENT_TYPE_YLP) in REVIEWABLE_PAYMENT_TYPES
            ],
        }
    )


def get_payment_detail(payment_id: int, *, payment_type: str | None = None):
    payment = get_payment_or_404(payment_id, payment_type=payment_type)
    if not payment:
        return jsonify({"success": False, "status": "error", "message": "支付记录不存在"}), 404
    return jsonify(
        {
            "success": True,
            "status": "success",
            "data": serialize_payment(
                payment,
                include_order=True,
                include_registrations=(payment.payment_type == PAYMENT_TYPE_LAMP),
            ),
        }
    )


def _refresh_registration_status(registration: LampRegistration) -> None:
    # 点灯登记的工作流状态（draft / confirm / cancel）已与付款解绑，
    # 不再由付款审核联动修改；付款审核只影响 FahuiPayment 本身的状态。
    return


def _refresh_order_status(order: FahuiOrder | None) -> None:
    if not order:
        return

    payments = (
        db.session.query(FahuiPayment)
        .filter(
            FahuiPayment.order_id == order.id,
            FahuiPayment.payment_type == PAYMENT_TYPE_YLP,
        )
        .order_by(FahuiPayment.created_at.desc(), FahuiPayment.id.desc())
        .all()
    )
    if not payments:
        order.status = None
        return

    approved_exists = any(is_payment_approved(payment) for payment in payments)
    if approved_exists:
        order.status = "paid"
        return

    latest = payments[0]
    order.status = normalize_fahui_payment_status(latest.status)


def set_payment_review_status(
    payment: FahuiPayment,
    *,
    status: str,
    reviewer_user=None,
    sync_owner_status: bool = True,
) -> None:
    normalized_status = normalize_fahui_payment_status(status)
    if normalized_status not in {"approved", "pending", "rejected"}:
        raise ValueError("无效的状态")

    now = datetime.utcnow()
    payment.status = normalized_status
    if normalized_status == "approved":
        payment.submitter_id = reviewer_user.id if reviewer_user and reviewer_user.is_authenticated else None
        payment.valid_by = (
            (reviewer_user.display_name or reviewer_user.username)
            if reviewer_user and reviewer_user.is_authenticated
            else None
        )
        payment.valid_at = now
        if payment.payment_type == PAYMENT_TYPE_LAMP and payment.paid_at is None:
            payment.paid_at = now
    else:
        payment.submitter_id = None
        payment.valid_by = None
        payment.valid_at = None

    # 撤回付款时不要动订单状态：订单该是 Draft/confirm 就还是那样，
    # 只有这条付款记录变成「已拒绝」。
    if not sync_owner_status:
        return

    if payment.payment_type == PAYMENT_TYPE_LAMP:
        for registration in payment.lamp_registrations:
            _refresh_registration_status(registration)
    elif payment.payment_type == PAYMENT_TYPE_YLP:
        _refresh_order_status(payment.order)


def update_payment_review(
    payment_id: int,
    *,
    status: str,
    payment_type: str | None = None,
    sync_owner_status: bool = True,
):
    payment = get_payment_or_404(payment_id, payment_type=payment_type)
    if not payment:
        return jsonify({"success": False, "status": "error", "message": "支付记录不存在"}), 404

    try:
        set_payment_review_status(
            payment, status=status, reviewer_user=current_user, sync_owner_status=sync_owner_status
        )
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"success": False, "status": "error", "message": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"success": False, "status": "error", "message": str(exc)}), 500

    return jsonify(
        {
            "success": True,
            "status": "success",
            "payment": serialize_payment(
                payment,
                include_order=True,
                include_registrations=(payment.payment_type == PAYMENT_TYPE_LAMP),
            ),
        }
    )


def delete_payment_record(payment_id: int, *, payment_type: str | None = None):
    payment = get_payment_or_404(payment_id, payment_type=payment_type)
    if not payment:
        return jsonify({"success": False, "status": "error", "message": "支付记录不存在"}), 404

    linked_registrations = list(payment.lamp_registrations or [])
    order = payment.order

    try:
        remove_payment_file(payment.document, search_roots=PAYMENT_FILE_ROOTS)
        db.session.delete(payment)
        db.session.flush()

        for registration in linked_registrations:
            _refresh_registration_status(registration)
        _refresh_order_status(order)

        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"success": False, "status": "error", "message": str(exc)}), 500

    return jsonify({"success": True, "status": "success"})


def get_payment_document(payment_id: int, *, payment_type: str | None = None):
    return send_payment_file(
        get_payment_or_404(payment_id, payment_type=payment_type),
        file_attr="document",
        search_roots=PAYMENT_FILE_ROOTS,
        missing_payment_message="支付记录不存在",
        missing_document_message="该付款没有上传凭证",
    )
