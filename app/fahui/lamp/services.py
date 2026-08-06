from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from flask import jsonify
from flask_login import current_user

from app.paths import DATA_ROOT
from models import db
from models.fahui import FahuiPayment
from models.lampRegistration import (
    Lamp,
    LampRegistration,
    lamp_payment_registration,
)

from ..common.payment import (
    PAYMENT_TYPE_LAMP,
    save_payment_upload as save_common_payment_upload,
)
from ..common.open_window import is_open as open_window_is_open
from ..common.payment_review import (
    delete_payment_record,
    get_payment_document as get_review_payment_document,
    list_review_payments,
    update_payment_review,
)
from .serializers import serialize_registration


LAMP_PAYMENT_DIR = DATA_ROOT / "lamp_payment_images"


def ping():
    return "pong"


def _parse_registration_ids(raw_value):
    if not raw_value:
        raise ValueError("缺少 registration_ids")
    try:
        registration_ids = [int(item) for item in str(raw_value).split(",") if item]
    except Exception as exc:
        raise ValueError("registration_ids 格式错误") from exc
    if not registration_ids:
        raise ValueError("registration_ids 格式错误")
    return registration_ids


def _parse_payment_amount(raw_amount):
    if raw_amount in ("", None):
        raise ValueError("缺少 amount")
    try:
        amount = Decimal(str(raw_amount))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("amount 格式错误") from exc
    if amount <= 0:
        raise ValueError("amount 必须大于 0")
    return amount.quantize(Decimal("0.01"))


def create_registration(data):
    # 开放时间之外拒绝公开报名；已登录用户（CRM 后台）不受限制。
    if not current_user.is_authenticated and not open_window_is_open("lamp"):
        return jsonify({"status": "error", "message": "点灯法会登记目前未开放"}), 403
    try:
        devotee_name = (data.get("devotee_name") or "").strip()
        if not devotee_name:
            return jsonify({"status": "error", "message": "请填写祈福者姓名"}), 400

        lamps = data.get("lamps") or []
        if not lamps or not isinstance(lamps, list):
            return jsonify({"status": "error", "message": "请至少选择一盏供灯"}), 400

        registration = LampRegistration(
            devotee_name=devotee_name,
            address=data.get("address"),
            phone=data.get("phone"),
            total_amount=Decimal("0.00"),
            status="draft",
        )
        db.session.add(registration)
        db.session.flush()

        total_amount = Decimal("0.00")
        for item in lamps:
            amount = _resolve_lamp_amount(item)
            lamp = Lamp(
                registration_id=registration.id,
                lamp_type=item.get("lamp_type"),
                amount=amount,
                note=item.get("note"),
            )
            db.session.add(lamp)
            total_amount += amount

        registration.total_amount = total_amount
        db.session.commit()
        return jsonify(
            {
                "status": "success",
                "message": "报名成功",
                "data": {
                    "id": registration.id,
                    "devotee_name": registration.devotee_name,
                    "total_amount": str(registration.total_amount),
                },
            }
        )
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": "服务器错误", "error": str(exc)}), 500


def update_registration(data):
    try:
        reg_id = data.get("id")
        if not reg_id:
            return jsonify({"status": "error", "message": "缺少 id"}), 400

        registration = LampRegistration.query.get(reg_id)
        if not registration:
            return jsonify({"status": "error", "message": "记录不存在"}), 404

        if "devotee_name" in data:
            name = (data.get("devotee_name") or "").strip()
            if not name:
                return jsonify({"status": "error", "message": "祈福者姓名不能为空"}), 400
            registration.devotee_name = name

        if "address" in data:
            registration.address = data.get("address")
        if "phone" in data:
            registration.phone = data.get("phone")
        if "status" in data:
            if data["status"] not in ("draft", "confirm", "cancel"):
                return jsonify({"status": "error", "message": "不合法的状态"}), 400
            registration.status = data["status"]

        db.session.commit()
        return jsonify({"status": "success", "message": "修改成功", "data": {"id": registration.id}})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": "服务器错误", "error": str(exc)}), 500


def delete_registration(data):
    try:
        reg_id = data.get("id")
        if not reg_id:
            return jsonify({"status": "error", "message": "缺少 id"}), 400

        registration = LampRegistration.query.get(reg_id)
        if not registration:
            return jsonify({"status": "error", "message": "记录不存在"}), 404

        has_payment = (
            db.session.query(lamp_payment_registration)
            .filter(lamp_payment_registration.c.registration_id == registration.id)
            .first()
        )
        if has_payment:
            return jsonify({"status": "error", "message": "该订单已有付款记录，无法删除"}), 400

        Lamp.query.filter(Lamp.registration_id == registration.id).delete(synchronize_session=False)
        db.session.delete(registration)
        db.session.commit()
        return jsonify({"status": "success", "message": "删除成功"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": "服务器错误", "error": str(exc)}), 500


def list_payments_with_registrations():
    return list_review_payments(payment_type=PAYMENT_TYPE_LAMP)


def list_registrations():
    try:
        registrations = (
            db.session.query(LampRegistration).order_by(LampRegistration.created_at.desc()).all()
        )
        return jsonify(
            {"status": "success", "data": [serialize_registration(reg) for reg in registrations]}
        )
    except Exception as exc:
        return jsonify({"status": "error", "message": "服务器错误", "error": str(exc)}), 500


def get_registrations_by_ids(data, restrict_to_verified_phone=False):
    try:
        ids = data.get("ids")
        if not ids or not isinstance(ids, list):
            return jsonify({"status": "error", "message": "ids 参数无效"}), 400

        registrations = (
            db.session.query(LampRegistration).filter(LampRegistration.id.in_(ids)).all()
        )
        if restrict_to_verified_phone:
            from ..common.access import can_access_phone_records

            registrations = [r for r in registrations if can_access_phone_records(r.phone)]
        if not registrations:
            return jsonify({"status": "error", "message": "找不到报名记录"}), 404

        return jsonify(
            {
                "status": "success",
                "data": [serialize_registration(registration) for registration in registrations],
            }
        )
    except Exception as exc:
        return jsonify({"status": "error", "message": "服务器错误", "error": str(exc)}), 500


def create_payment(form, files):
    try:
        try:
            reg_ids = _parse_registration_ids(form.get("registration_ids"))
            amount = _parse_payment_amount(form.get("amount"))
        except ValueError as exc:
            return jsonify({"status": "error", "message": str(exc)}), 400

        registrations = (
            db.session.query(LampRegistration).filter(LampRegistration.id.in_(reg_ids)).all()
        )
        if not registrations:
            return jsonify({"status": "error", "message": "找不到报名记录"}), 404

        payment = FahuiPayment(
            payment_type=PAYMENT_TYPE_LAMP,
            payer_name=form.get("payer_name"),
            phone=form.get("phone"),
            total_price=amount,
            payment_mode=form.get("method"),
            note=form.get("note"),
            paid_at=datetime.utcnow(),
            status="pending",
        )
        payment.lamp_registrations.extend(registrations)
        db.session.add(payment)
        db.session.flush()

        upload = files.get("file")
        if upload and upload.filename:
            filename = upload.filename or "proof"
            extension = Path(filename).suffix or ""
            payment.document = save_common_payment_upload(
                upload,
                save_dir=LAMP_PAYMENT_DIR,
                save_name=f"{payment.id}{extension}",
            )

        db.session.commit()
        return jsonify({"status": "success", "data": {"payment_id": payment.id}})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": "服务器错误", "error": str(exc)}), 500


def delete_payment(data):
    payment_id = data.get("id")
    if not payment_id:
        return jsonify({"status": "error", "message": "缺少 id"}), 400
    return delete_payment_record(int(payment_id), payment_type=PAYMENT_TYPE_LAMP)


def get_payment_file(payment_id):
    return get_review_payment_document(payment_id, payment_type=PAYMENT_TYPE_LAMP)


def review_payment_record(data, approved=True):
    payment_id = data.get("id")
    if not payment_id:
        return jsonify({"status": "error", "message": "缺少 id"}), 400
    status = "approved" if approved else "pending"
    return update_payment_review(int(payment_id), status=status, payment_type=PAYMENT_TYPE_LAMP)


def approve_payment_record(data):
    return review_payment_record(data, approved=True)


def revoke_payment_record(data):
    return review_payment_record(data, approved=False)


def _resolve_lamp_amount(item):
    lamp_type = item.get("lamp_type")
    if lamp_type == "lamp_88":
        return Decimal("88.00")
    if lamp_type == "lamp_168":
        return Decimal("168.00")
    if lamp_type == "gong_zai":
        raw_amount = item.get("gong_zai_amount")
        if raw_amount is None:
            raise ValueError("随缘供斋金额不能为空")
        try:
            amount = Decimal(str(raw_amount))
        except (InvalidOperation, ValueError):
            raise ValueError("随缘供斋金额格式错误")
        if amount <= 0:
            raise ValueError("随缘供斋金额必须大于 0")
        return amount
    raise ValueError(f"不合法的供灯类型：{lamp_type}")
