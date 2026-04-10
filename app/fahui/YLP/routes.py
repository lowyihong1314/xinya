from flask import Blueprint, jsonify, request

from .services import (
    create_order_shell,
    get_order_detail,
    get_orders_by_phone,
    list_available_versions,
    search_orders,
)

fahui_bp = Blueprint("fahui_router", __name__)


def _json_payload():
    return request.get_json(silent=True) or {}


@fahui_bp.route("/orders/search", methods=["GET"])
@fahui_bp.route("/search", methods=["GET"])
def search_orders_route():
    version = request.args.get("version", type=str)
    value = request.args.get("value", default="", type=str)
    page = request.args.get("page", default=1, type=int)
    per_page = request.args.get("per_page", default=20, type=int)

    if version is None:
        return jsonify({"status": "error", "message": "version is required"}), 400

    try:
        result = search_orders(version=version, value=value, page_num=page, per_page=per_page)
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400

    return jsonify({"status": "success", "data": result})


@fahui_bp.route("/orders/<int:order_id>", methods=["GET"])
@fahui_bp.route("/get_order_by_id", methods=["GET"])
def get_order_detail_route(order_id: int | None = None):
    order_id = order_id or request.args.get("order_id", type=int) or request.args.get("id", type=int)
    if not order_id:
        return jsonify({"status": "error", "message": "order_id is required"}), 400

    payload, status_code = get_order_detail(order_id)
    return jsonify(payload), status_code


@fahui_bp.route("/orders/by-phone", methods=["GET"])
@fahui_bp.route("/get_orders_by_phone", methods=["GET"])
def list_orders_by_phone_route():
    payload, status_code = get_orders_by_phone(request.args.get("phone", default="", type=str))
    return jsonify(payload), status_code


@fahui_bp.route("/orders", methods=["POST"])
@fahui_bp.route("/new_customer", methods=["POST"])
def create_order_route():
    payload, status_code = create_order_shell(_json_payload())
    return jsonify(payload), status_code


@fahui_bp.route("/versions", methods=["GET"])
@fahui_bp.route("/get_versions", methods=["GET"])
def list_versions_route():
    return jsonify({"status": "success", "data": list_available_versions()})
