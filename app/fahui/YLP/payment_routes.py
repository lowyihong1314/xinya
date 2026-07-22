from flask import Blueprint

from app.form.permissions import permission_required_any

from .payment_services import (
    calculate_order_amount,
    create_group_payment,
    create_payment_record,
    download_order_quotation,
    list_order_payment_data,
    print_receipt,
)


payment_bp = Blueprint("payment", __name__)


@payment_bp.route("/orders/<int:order_id>/payments", methods=["POST"])
@payment_bp.route("/make_payment/<int:order_id>", methods=["POST"])
def create_order_payment_route(order_id):
    return create_payment_record(order_id)


@payment_bp.route("/orders/group-payment", methods=["POST"])
def create_group_payment_route():
    return create_group_payment()


@payment_bp.route("/orders/<int:order_id>/payments", methods=["GET"])
@payment_bp.route("/get_payment_data/<int:order_id>", methods=["GET"])
def list_order_payments_route(order_id):
    return list_order_payment_data(order_id)


@payment_bp.route("/orders/<int:order_id>/amount", methods=["GET"])
@payment_bp.route("/calculate_amount/<int:order_id>", methods=["GET"])
def get_order_amount_route(order_id):
    return calculate_order_amount(order_id)


@payment_bp.route("/orders/<int:order_id>/quotation", methods=["GET"])
@payment_bp.route("/download_quotation/<int:order_id>", methods=["GET"])
@payment_bp.route("/download_quotiton/<int:order_id>", methods=["GET"])
def download_order_quotation_route(order_id):
    return download_order_quotation(order_id)


@payment_bp.route("/orders/<int:order_id>/receipt", methods=["POST"])
@payment_bp.route("/print_receipt/<int:order_id>", methods=["POST"])
@permission_required_any("account_read", "account_edit")
def print_order_receipt_route(order_id):
    return print_receipt(order_id)
