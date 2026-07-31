from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from app.form.permissions import permission_required_any

from ..common import open_window as open_window_services
from .services import (
    create_order_shell,
    get_order_detail,
    get_orders_by_phone,
    list_available_versions,
    list_orders_for_export,
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


@fahui_bp.route("/orders/export", methods=["GET"])
@login_required
def export_orders_route():
    version = request.args.get("version", type=str)
    value = request.args.get("value", default="", type=str)
    if version is None:
        return jsonify({"status": "error", "message": "version is required"}), 400
    try:
        result = list_orders_for_export(version=version, value=value)
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
    # 开放时间之外拒绝公开报名；已登录用户（CRM 后台）不受限制。
    if not current_user.is_authenticated and not open_window_services.is_open("ylp"):
        return jsonify({"status": "error", "message": "盂兰盆法会牌位登记目前未开放"}), 403
    payload, status_code = create_order_shell(_json_payload())
    return jsonify(payload), status_code


@fahui_bp.route("/open_windows", methods=["GET"])
def list_open_windows_route():
    key = request.args.get("key", default="", type=str)
    try:
        # 不带 key 时返回全部法会的开放状态（公开页用来找「当前开放的法会」）。
        result = open_window_services.list_windows(key) if key else open_window_services.list_all_status()
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400
    return jsonify({"status": "success", "data": result})


@fahui_bp.route("/open_windows", methods=["POST"])
@permission_required_any("account_edit")
def create_open_window_route():
    try:
        result = open_window_services.create_window(_json_payload())
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400
    return jsonify({"status": "success", "data": result})


@fahui_bp.route("/open_windows/<int:window_id>", methods=["DELETE"])
@permission_required_any("account_edit")
def delete_open_window_route(window_id: int):
    try:
        open_window_services.delete_window(window_id)
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400
    return jsonify({"status": "success"})


@fahui_bp.route("/versions", methods=["GET"])
@fahui_bp.route("/get_versions", methods=["GET"])
def list_versions_route():
    return jsonify({"status": "success", "data": list_available_versions()})
