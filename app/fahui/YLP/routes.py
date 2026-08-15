from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from app.form.permissions import permission_required_any

from ..common import open_window as open_window_services
from ..common.access import (
    FAHUI_READ_PERMISSION_NAMES,
    can_access_phone_records,
    has_fahui_read,
    owner_or_reader_denied,
)
from .services import (
    create_order_shell,
    get_order_detail,
    get_orders_by_phone,
    get_version_event_binding,
    list_available_versions,
    list_version_event_bindings,
    set_version_event_binding,
    list_orders_for_export,
    search_orders,
)
from .share_link import get_or_create_share_token, grant_session_phone, resolve_share_token

fahui_bp = Blueprint("fahui_router", __name__)


def _json_payload():
    return request.get_json(silent=True) or {}


@fahui_bp.route("/orders/search", methods=["GET"])
@fahui_bp.route("/search", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def search_orders_route():
    version = request.args.get("version", type=str)
    value = request.args.get("value", default="", type=str)
    page = request.args.get("page", default=1, type=int)
    per_page = request.args.get("per_page", default=20, type=int)
    sort = request.args.get("sort", default=None, type=str)
    direction = request.args.get("dir", default=None, type=str)

    if version is None:
        return jsonify({"status": "error", "message": "version is required"}), 400

    try:
        result = search_orders(
            version=version,
            value=value,
            page_num=page,
            per_page=per_page,
            sort=sort,
            direction=direction,
        )
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400

    return jsonify({"status": "success", "data": result})


@fahui_bp.route("/orders/export", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
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


@fahui_bp.route("/orders/<int:order_id>/share-link", methods=["POST"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def create_share_link_route(order_id: int):
    from models.fahui import FahuiOrder

    if FahuiOrder.query.get(order_id) is None:
        return jsonify({"status": "error", "message": "order not found"}), 404

    token, expires_in = get_or_create_share_token(order_id)
    return jsonify({"status": "success", "token": token, "expires_in": expires_in})


@fahui_bp.route("/orders/shared", methods=["GET"])
def shared_order_route():
    # 公开只读入口：token 有效即放行（同时给 session 授已验证手机号，
    # 让后续的牌位预览等接口也能按订单主人访问）。
    token = request.args.get("token", default="", type=str)
    order_id = resolve_share_token(token)
    if not order_id:
        return jsonify({"status": "error", "message": "链接不存在或已过期，请联系工作人员重新获取"}), 404

    from models.fahui import FahuiOrder

    order = FahuiOrder.query.get(order_id)
    if order is None:
        return jsonify({"status": "error", "message": "订单不存在"}), 404

    grant_session_phone(order.phone)
    payload, status_code = get_order_detail(order_id)
    return jsonify(payload), status_code


@fahui_bp.route("/orders/<int:order_id>", methods=["GET"])
@fahui_bp.route("/get_order_by_id", methods=["GET"])
def get_order_detail_route(order_id: int | None = None):
    order_id = order_id or request.args.get("order_id", type=int) or request.args.get("id", type=int)
    if not order_id:
        return jsonify({"status": "error", "message": "order_id is required"}), 400

    # 管理权限放行；公开访客只能读「已验证手机号」名下的订单。
    if not has_fahui_read():
        from models.fahui import FahuiOrder

        order = FahuiOrder.query.get(order_id)
        if order is None:
            return jsonify({"status": "error", "message": "order not found"}), 404
        if not can_access_phone_records(order.phone):
            return owner_or_reader_denied()

    payload, status_code = get_order_detail(order_id)
    return jsonify(payload), status_code


@fahui_bp.route("/orders/by-phone", methods=["GET"])
@fahui_bp.route("/get_orders_by_phone", methods=["GET"])
def list_orders_by_phone_route():
    phone = request.args.get("phone", default="", type=str)
    if not can_access_phone_records(phone):
        return owner_or_reader_denied()
    payload, status_code = get_orders_by_phone(phone)
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


@fahui_bp.route("/versions/bindings", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_version_bindings_route():
    workspace = request.args.get("workspace", default="ylp", type=str)
    return jsonify({"status": "success", "data": list_version_event_bindings(workspace)})


@fahui_bp.route("/versions/<path:version>/event", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def get_version_event_route(version):
    workspace = request.args.get("workspace", default="ylp", type=str)
    return jsonify({"status": "success", "data": get_version_event_binding(version, workspace)})


@fahui_bp.route("/versions/<path:version>/event", methods=["PUT", "POST"])
@login_required
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def set_version_event_route(version):
    payload = _json_payload()
    workspace = payload.get("workspace") or "ylp"
    try:
        data = set_version_event_binding(version, payload.get("event_id"), workspace)
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400
    return jsonify({"status": "success", "data": data})
