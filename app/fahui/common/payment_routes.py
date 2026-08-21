from flask import Blueprint, request

from app.form.permissions import permission_required_any

from .payment_review import (
    delete_payment_record,
    get_payment_detail,
    get_payment_document,
    list_review_payments,
    update_payment_review,
)


fahui_payment_bp = Blueprint("fahui_payment", __name__)


@fahui_payment_bp.route("/payments", methods=["GET"])
@fahui_payment_bp.route("/review", methods=["GET"])
@fahui_payment_bp.route("/get_all_payment_data", methods=["GET"])
@permission_required_any("account_read", "account_edit")
def list_payment_reviews():
    return list_review_payments()


@fahui_payment_bp.route("/payments/<int:payment_id>/status", methods=["POST"])
@fahui_payment_bp.route("/update_payment_status/<int:payment_id>", methods=["POST"])
@permission_required_any("account_edit")
def update_payment_status(payment_id):
    payload = request.get_json(silent=True) or {}
    return update_payment_review(payment_id, status=payload.get("status"))


@fahui_payment_bp.route("/review/<int:payment_id>/approve", methods=["POST"])
@permission_required_any("account_edit")
def approve_payment(payment_id):
    return update_payment_review(payment_id, status="approved")


@fahui_payment_bp.route("/review/<int:payment_id>/revoke", methods=["POST"])
@permission_required_any("account_edit")
def revoke_payment(payment_id):
    return update_payment_review(payment_id, status="pending")


@fahui_payment_bp.route("/review/<int:payment_id>/withdraw", methods=["POST"])
@fahui_payment_bp.route("/payments/<int:payment_id>/withdraw", methods=["POST"])
@permission_required_any("account_edit")
def withdraw_payment(payment_id):
    """撤回一条付款：只把这条记录标成「已拒绝」，订单状态保持原样。"""
    return update_payment_review(payment_id, status="rejected", sync_owner_status=False)


@fahui_payment_bp.route("/review/<int:payment_id>", methods=["DELETE"])
@permission_required_any("account_edit")
def delete_payment(payment_id):
    return delete_payment_record(payment_id)


@fahui_payment_bp.route("/payments/<int:payment_id>", methods=["GET"])
@fahui_payment_bp.route("/get_payment_detail/<int:payment_id>", methods=["GET"])
@permission_required_any("account_read", "account_edit")
def payment_detail(payment_id):
    return get_payment_detail(payment_id)


@fahui_payment_bp.route("/payments/<int:payment_id>/document", methods=["GET"])
@fahui_payment_bp.route("/get_payment_image/<int:payment_id>", methods=["GET"])
@permission_required_any("account_read", "account_edit")
def payment_document(payment_id):
    return get_payment_document(payment_id)
