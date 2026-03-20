from datetime import datetime
from decimal import Decimal, InvalidOperation

from flask import jsonify
from flask_login import current_user

from models import db
from models.lampRegistration import (
    Lamp,
    LampPayment,
    LampRegistration,
    lamp_payment_registration,
)

from .serializers import serialize_registration
from .storage import remove_payment_file, save_payment_upload, send_payment_file


def ping():
    return "pong"


def register_lamp(data):
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
            status="submitted",
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


def edit_register(data):
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
            if data["status"] not in ("submitted", "paid", "canceled"):
                return jsonify({"status": "error", "message": "不合法的状态"}), 400
            registration.status = data["status"]

        db.session.commit()
        return jsonify({"status": "success", "message": "修改成功", "data": {"id": registration.id}})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": "服务器错误", "error": str(exc)}), 500


def delete_register(data):
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


def get_all_register_by_payment():
    try:
        payments = db.session.query(LampPayment).order_by(LampPayment.created_at.desc()).all()
        result = []
        for payment in payments:
            result.append(
                {
                    "payment_id": payment.id,
                    "phone": payment.phone,
                    "payer_name": payment.payer_name,
                    "amount": str(payment.amount),
                    "method": payment.method,
                    "paid_at": payment.paid_at.strftime("%Y-%m-%d %H:%M:%S")
                    if payment.paid_at
                    else None,
                    "created_at": payment.created_at.strftime("%Y-%m-%d %H:%M:%S"),
                    "submitter_id": payment.submitter_id,
                    "registrations": [
                        serialize_registration(registration, include_payments=False)
                        for registration in (payment.registrations or [])
                    ],
                }
            )
        return jsonify({"status": "success", "data": result})
    except Exception as exc:
        return jsonify({"status": "error", "message": "服务器错误", "error": str(exc)}), 500


def get_all_register():
    try:
        registrations = (
            db.session.query(LampRegistration).order_by(LampRegistration.created_at.desc()).all()
        )
        return jsonify(
            {"status": "success", "data": [serialize_registration(reg) for reg in registrations]}
        )
    except Exception as exc:
        return jsonify({"status": "error", "message": "服务器错误", "error": str(exc)}), 500


def get_registers_by_ids(data):
    try:
        ids = data.get("ids")
        if not ids or not isinstance(ids, list):
            return jsonify({"status": "error", "message": "ids 参数无效"}), 400

        registrations = (
            db.session.query(LampRegistration).filter(LampRegistration.id.in_(ids)).all()
        )
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


def make_payment(form, files):
    try:
        reg_ids_raw = form.get("registration_ids")
        if not reg_ids_raw:
            return jsonify({"status": "error", "message": "缺少 registration_ids"}), 400

        try:
            reg_ids = [int(item) for item in reg_ids_raw.split(",") if item]
        except Exception:
            return jsonify({"status": "error", "message": "registration_ids 格式错误"}), 400

        registrations = (
            db.session.query(LampRegistration).filter(LampRegistration.id.in_(reg_ids)).all()
        )
        if not registrations:
            return jsonify({"status": "error", "message": "找不到报名记录"}), 404

        amount = form.get("amount")
        if not amount:
            return jsonify({"status": "error", "message": "缺少 amount"}), 400

        payment = LampPayment(
            payer_name=form.get("payer_name"),
            phone=form.get("phone"),
            amount=amount,
            method=form.get("method"),
            note=form.get("note"),
            paid_at=datetime.utcnow(),
        )
        payment.registrations.extend(registrations)
        db.session.add(payment)
        db.session.flush()

        upload = files.get("file")
        if upload and upload.filename:
            payment.doc_path = save_payment_upload(payment.id, upload)

        db.session.commit()
        return jsonify({"status": "success", "data": {"payment_id": payment.id}})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": "服务器错误", "error": str(exc)}), 500


def remove_payment(data):
    try:
        payment_id = data.get("id")
        if not payment_id:
            return jsonify({"status": "error", "message": "缺少 id"}), 400

        payment = LampPayment.query.get(payment_id)
        if not payment:
            return jsonify({"status": "error", "message": "找不到 payment"}), 404

        remove_payment_file(payment.doc_path)
        db.session.delete(payment)
        db.session.commit()
        return jsonify({"status": "success"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": "服务器错误", "error": str(exc)}), 500


def get_payment_file(payment_id):
    return send_payment_file(LampPayment.query.get(payment_id))


def approve_payment(data):
    try:
        payment_id = data.get("id")
        if not payment_id:
            return jsonify({"status": "error", "message": "缺少 id"}), 400

        payment = LampPayment.query.get(payment_id)
        if not payment:
            return jsonify({"status": "error", "message": "找不到 payment"}), 404

        payment.paid_at = datetime.utcnow()
        payment.submitter_id = current_user.id
        for registration in payment.registrations:
            registration.status = "paid"

        db.session.commit()
        return jsonify(
            {
                "status": "success",
                "submitter_id": current_user.id,
                "paid_at": payment.paid_at.strftime("%Y-%m-%d %H:%M:%S"),
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": "服务器错误", "error": str(exc)}), 500


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
