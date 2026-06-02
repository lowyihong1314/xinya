from flask import Blueprint, jsonify, request, send_file

from app.account.exceptions import AccountError
from app.account.pdf import build_claim_report_pdf, build_payment_voucher_pdf
from app.account.permissions import (
    require_authenticated_user,
    require_claim_edit_permission,
    require_claim_list_permission,
    require_claim_submit_permission,
)
from app.account.serializers import serialize_request_data
from app.account.services import (
    add_claim_attachments,
    build_claim_report_context,
    build_payment_voucher_context,
    build_public_payment_voucher_context,
    create_claim_from_form,
    delete_claim,
    delete_claim_attachment,
    get_payment_voucher_share_data,
    get_public_payment_voucher_data,
    list_claims_for_user,
    read_bill_from_file,
    record_claim_decision,
    submit_public_payment_voucher_signature,
    update_claim,
    update_claim_event,
)

account_bp = Blueprint("account", __name__)
payment_voucher_bp = Blueprint("print_payment_voucher_bp", __name__)


def _error_response(exc):
    return jsonify({"status": "error", "message": exc.message}), exc.status_code


@account_bp.post("/submit_new_claim")
def submit_new_claim():
    try:
        user = require_claim_submit_permission()
        request_obj = create_claim_from_form(request.form, request.files, user)
        return (
            jsonify(
                {
                    "status": "success",
                    "message": "申请提交成功",
                    "data": serialize_request_data(request_obj),
                }
            ),
            201,
        )
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"error": str(exc)}), 500


@account_bp.get("/get_all_claim")
def get_all_claim():
    try:
        user = require_claim_list_permission()
        result = list_claims_for_user(user)
        return (
            jsonify(
                {
                    "status": "success",
                    "can_view_all": result["can_view_all"],
                    "count": len(result["data"]),
                    "data": result["data"],
                }
            ),
            200,
        )
    except AccountError as exc:
        return _error_response(exc)


@account_bp.post("/claim/read_bill")
def read_claim_bill():
    try:
        require_claim_submit_permission()
        payload = read_bill_from_file(
            request.files.get("file"),
            request.form.get("model"),
            request.form.get("debug"),
            request.form.get("bypass"),
        )
        return jsonify({"status": "success", **payload}), 200
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


@account_bp.post("/claim/report")
def download_claim_report():
    try:
        user = require_claim_list_permission()
        payload = request.get_json(silent=True) or {}
        claims = build_claim_report_context(payload.get("claim_ids") or [], user)
        pdf_buffer = build_claim_report_pdf(claims)
        return send_file(
            pdf_buffer,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=f"ClaimReport_{len(claims)}.pdf",
        )
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


@account_bp.post("/claim_decision/<int:request_id>")
def claim_decision(request_id):
    try:
        user = require_claim_edit_permission()
        payload = request.get_json(silent=True) or {}
        request_obj = record_claim_decision(request_id, payload, user)
        return (
            jsonify(
                {
                    "status": "success",
                    "message": "操作成功",
                    "data": serialize_request_data(request_obj, with_children=True),
                }
            ),
            200,
        )
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@account_bp.delete("/delete_claim/<int:request_id>")
def delete_claim_route(request_id):
    try:
        user = require_claim_edit_permission()
        delete_claim(request_id, user)
        return jsonify({"status": "success", "message": "申请已删除"}), 200
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@account_bp.put("/claim/<int:request_id>")
def update_claim_route(request_id):
    try:
        user = require_claim_edit_permission()
        payload = request.get_json(silent=True) or {}
        request_obj = update_claim(request_id, payload, user)
        return (
            jsonify(
                {
                    "status": "success",
                    "message": "申请已更新",
                    "data": serialize_request_data(request_obj, with_children=True),
                }
            ),
            200,
        )
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@account_bp.post("/claim/<int:request_id>/attachments")
def add_claim_attachments_route(request_id):
    try:
        user = require_claim_list_permission()
        request_obj = add_claim_attachments(request_id, request.files, user)
        return (
            jsonify(
                {
                    "status": "success",
                    "message": "附件已上传",
                    "data": serialize_request_data(request_obj, with_children=True),
                }
            ),
            200,
        )
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@account_bp.delete("/claim/attachments/<int:attachment_id>")
def delete_claim_attachment_route(attachment_id):
    try:
        user = require_claim_list_permission()
        request_obj = delete_claim_attachment(attachment_id, user)
        return (
            jsonify(
                {
                    "status": "success",
                    "message": "附件已删除",
                    "data": serialize_request_data(request_obj, with_children=True),
                }
            ),
            200,
        )
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@account_bp.put("/claim/<int:request_id>/event")
def update_claim_event_route(request_id):
    try:
        user = require_authenticated_user()
        payload = request.get_json(silent=True) or {}
        request_obj = update_claim_event(request_id, payload, user)
        return (
            jsonify(
                {
                    "status": "success",
                    "message": "活动已更新",
                    "data": serialize_request_data(request_obj, with_children=True),
                }
            ),
            200,
        )
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@payment_voucher_bp.get("/download_payment_voucher/<int:request_id>")
def download_payment_voucher(request_id):
    try:
        user = require_authenticated_user()
        data, approver_list = build_payment_voucher_context(request_id, user)
        pdf_buffer = build_payment_voucher_pdf(data, approver_list)
        return send_file(
            pdf_buffer,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=f"PaymentVoucher_{data['id']}.pdf",
        )
    except AccountError as exc:
        return _error_response(exc)


@payment_voucher_bp.get("/share_payment_voucher/<int:request_id>")
def share_payment_voucher(request_id):
    try:
        user = require_authenticated_user()
        return jsonify(
            {
                "status": "success",
                "data": get_payment_voucher_share_data(request_id, user),
            }
        )
    except AccountError as exc:
        return _error_response(exc)


@payment_voucher_bp.get("/public/<string:token>")
def get_public_payment_voucher(token):
    try:
        return jsonify(
            {
                "status": "success",
                "data": get_public_payment_voucher_data(token),
            }
        )
    except AccountError as exc:
        return _error_response(exc)


@payment_voucher_bp.post("/public/<string:token>/sign")
def sign_public_payment_voucher(token):
    try:
        payload = request.get_json(silent=True) or {}
        return jsonify(
            {
                "status": "success",
                "data": submit_public_payment_voucher_signature(token, payload),
            }
        )
    except AccountError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@payment_voucher_bp.get("/public/<string:token>/download")
def download_public_payment_voucher(token):
    try:
        data, approver_list = build_public_payment_voucher_context(token)
        pdf_buffer = build_payment_voucher_pdf(data, approver_list)
        return send_file(
            pdf_buffer,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=f"PaymentVoucher_{data['id']}.pdf",
        )
    except AccountError as exc:
        return _error_response(exc)
