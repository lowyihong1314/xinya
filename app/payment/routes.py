from flask import Blueprint

from .services import make_payment


payment_bp = Blueprint("payment", __name__)


@payment_bp.route("/make_payment/<int:order_id>", methods=["POST"])
def make_payment_route(order_id):
    return make_payment(order_id)
