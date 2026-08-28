from flask import Blueprint, jsonify, request
from flask_login import current_user

from app.form.permissions import permission_required_any

from ..common.access import FAHUI_READ_PERMISSION_NAMES
from .board_terminal import (
    get_or_create_terminal_token,
    grant_terminal_session,
    resolve_terminal_token,
    terminal_room,
)

from .payment_channel_services import (
    create_payment_channel,
    delete_payment_channel,
    list_payment_channels,
    update_payment_channel,
)
from .relation_option_services import (
    create_relation_option,
    delete_relation_option,
    import_relation_options_from_history,
    list_relation_options,
)
from .board_services import (
    attach_pdf_to_board,
    check_duplicate_owner_fields,
    clear_print_pdf_records,
    clear_unattached_print_pdfs,
    clone_order_to_version,
    copy_orders_to_current,
    create_board,
    create_order_item,
    delete_board_entry,
    delete_board_header,
    delete_order_batch,
    delete_order_item,
    reset_year_barcodes,
    update_board,
    get_board_order_detail,
    get_print_pdf_data,
    list_all_boards,
    list_orders_by_version,
    list_print_pdf_history,
    list_print_pdf_records,
    list_unattached_print_pdfs,
    list_versions,
    quick_search_orders,
    reorder_board_entry,
    update_order_customer,
    update_order_item_fields,
    update_order_item_form_value,
    update_order_status,
)


board_router_bp = Blueprint("board_router", __name__)


@board_router_bp.route("/print-pdfs/<int:pdf_id>", methods=["GET"])
@board_router_bp.route("/get_pdf_data/<int:pdf_id>", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def get_print_pdf_detail_route(pdf_id):
    payload, status_code = get_print_pdf_data(pdf_id)
    return jsonify(payload), status_code


@board_router_bp.route("/boards/entries/<int:board_data_id>", methods=["DELETE"])
@board_router_bp.route("/delete_board/<int:board_data_id>", methods=["DELETE"])
@permission_required_any("account_edit")
def delete_board_entry_route(board_data_id):
    payload, status_code = delete_board_entry(board_data_id)
    return jsonify(payload), status_code


@board_router_bp.route("/boards", methods=["GET"])
@board_router_bp.route("/list_all", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_boards_route():
    return jsonify(list_all_boards(request.args.get("version", type=str) or None))


@board_router_bp.route("/print-pdfs/unattached", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_unattached_print_pdfs_route():
    return jsonify(
        list_unattached_print_pdfs(
            request.args.get("version", type=str),
            request.args.get("page", default=1, type=int),
            request.args.get("per_page", default=12, type=int),
        )
    )


@board_router_bp.route("/print-pdfs/history", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_print_pdf_history_route():
    return jsonify(
        list_print_pdf_history(
            request.args.get("version", type=str),
            request.args.get("page", default=1, type=int),
            request.args.get("per_page", default=20, type=int),
        )
    )


@board_router_bp.route("/print-pdfs/unattached/clear", methods=["POST"])
@permission_required_any("account_edit")
def clear_unattached_print_pdfs_route():
    payload = request.get_json(silent=True) or {}
    result, status_code = clear_unattached_print_pdfs(payload.get("version"))
    return jsonify(result), status_code


@board_router_bp.route("/terminal-link", methods=["POST"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def create_board_terminal_link_route():
    token, expires_in = get_or_create_terminal_token(current_user.id)
    return jsonify({"status": "success", "token": token, "expires_in": expires_in})


@board_router_bp.route("/terminal/boards", methods=["GET"])
def board_terminal_boards_route():
    # 终端页公开入口：token 有效即返回大板数据，并给 session 打标以放行牌位预览图。
    token = request.args.get("token", default="", type=str)
    user_id = resolve_terminal_token(token)
    if not user_id:
        return jsonify({"status": "error", "message": "链接不存在或已过期，请在看板页重新复制终端链接"}), 404

    grant_terminal_session()
    from .shared import active_order_version

    version = request.args.get("version", type=str) or active_order_version()
    payload = list_all_boards(version)
    payload.update({"status": "success", "room": terminal_room(user_id), "version": version})
    return jsonify(payload)


@board_router_bp.route("/terminal/highlight", methods=["POST"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def board_terminal_highlight_route():
    # CRM 查板点击订单后，把点亮指令广播到自己的终端房间。
    payload = request.get_json(silent=True) or {}
    try:
        from app.extensions import socket_broker

        socket_broker.emit("fahui:board_highlight", payload, room=terminal_room(current_user.id))
    except Exception:
        return jsonify({"success": False, "message": "广播失败"}), 500
    return jsonify({"success": True})


@board_router_bp.route("/boards", methods=["POST"])
@permission_required_any("account_edit")
def create_board_route():
    payload, status_code = create_board(request.get_json(silent=True) or {})
    return jsonify(payload), status_code


@board_router_bp.route("/boards/<int:board_id>", methods=["POST"])
@permission_required_any("account_edit")
def update_board_route(board_id):
    payload, status_code = update_board(board_id, request.get_json(silent=True) or {})
    return jsonify(payload), status_code


@board_router_bp.route("/boards/<int:board_id>", methods=["DELETE"])
@permission_required_any("account_edit")
def delete_board_header_route(board_id):
    payload, status_code = delete_board_header(board_id)
    return jsonify(payload), status_code


@board_router_bp.route("/print-pdfs/reset", methods=["POST"])
@permission_required_any("account_edit")
def reset_year_barcodes_route():
    payload, status_code = reset_year_barcodes((request.get_json(silent=True) or {}).get("version"))
    return jsonify(payload), status_code


@board_router_bp.route("/boards/entries/reorder", methods=["POST"])
@board_router_bp.route("/insert_pdf", methods=["POST"])
@permission_required_any("account_edit")
def reorder_board_entry_route():
    payload, status_code = reorder_board_entry(request.get_json(silent=True) or {})
    return jsonify(payload), status_code


@board_router_bp.route("/boards/entries", methods=["POST"])
@board_router_bp.route("/add_pdf", methods=["POST"])
@permission_required_any("account_edit")
def attach_pdf_to_board_route():
    payload, status_code = attach_pdf_to_board(request.get_json(silent=True) or {})
    return jsonify(payload), status_code


@board_router_bp.route("/print-pdfs/clear", methods=["POST"])
@board_router_bp.route("/clear_print_pdf", methods=["GET"])
@permission_required_any("account_edit")
def clear_print_pdfs_route():
    payload, status_code = clear_print_pdf_records()
    return jsonify(payload), status_code


@board_router_bp.route("/print-pdfs", methods=["GET"])
@board_router_bp.route("/get_all_print_data", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_print_pdfs_route():
    return jsonify(list_print_pdf_records()), 200


@board_router_bp.route("/versions", methods=["GET"])
@board_router_bp.route("/get_version_list", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_versions_route():
    return jsonify(list_versions())


@board_router_bp.route("/orders", methods=["GET"])
@board_router_bp.route("/get_orders_data", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_orders_route():
    return jsonify(list_orders_by_version(request.args.get("version", "2024_YLP")))


@board_router_bp.route("/orders/<int:order_id>/customer", methods=["POST"])
@board_router_bp.route("/update_customer/<int:order_id>", methods=["POST"])
def update_order_customer_route(order_id):
    # 公开访客只能改「已验证手机号」名下的订单；管理端需法会读权限。
    from ..common.access import can_access_phone_records, has_fahui_read, owner_or_reader_denied
    from models.fahui import FahuiOrder

    if not has_fahui_read():
        order = FahuiOrder.query.get(order_id)
        if order is None:
            return jsonify({"status": "error", "message": "order not found"}), 404
        if not can_access_phone_records(order.phone):
            return owner_or_reader_denied()
    payload, status_code = update_order_customer(order_id, request.get_json(silent=True) or {})
    return jsonify(payload), status_code


@board_router_bp.route("/orders/<int:order_id>/logs", methods=["GET"])
def list_order_logs_route(order_id):
    """订单改动记录。权限和看订单详情一致：后台有法会读权限，
    公开访客只能看自己已验证手机号名下的订单。"""
    from models.fahui import FahuiOrder
    from .order_log import list_order_logs
    from .services import user_can_view_order

    order = FahuiOrder.query.get(order_id)
    if order is None:
        return jsonify({"status": "error", "message": "订单不存在"}), 404
    if not user_can_view_order(order):
        return jsonify({"status": "error", "message": "未登录或没有权限查看此订单"}), 403

    return jsonify({"status": "success", "data": list_order_logs(order_id)}), 200


@board_router_bp.route("/orders/<int:order_id>/status", methods=["POST"])
@permission_required_any("account_edit")
def update_order_status_route(order_id):
    payload, status_code = update_order_status(order_id, request.get_json(silent=True) or {})
    return jsonify(payload), status_code


@board_router_bp.route("/payment-channels", methods=["GET"])
def list_payment_channels_route():
    # 公开可读：付款页需要向报名者展示收款方式（扫码/银行）。
    payload, status_code = list_payment_channels(request.args.get("version", type=str))
    return jsonify(payload), status_code


@board_router_bp.route("/payment-channels", methods=["POST"])
@permission_required_any("account_edit")
def create_payment_channel_route():
    payload, status_code = create_payment_channel(request.form, request.files)
    return jsonify(payload), status_code


@board_router_bp.route("/payment-channels/<int:channel_id>", methods=["POST"])
@permission_required_any("account_edit")
def update_payment_channel_route(channel_id):
    payload, status_code = update_payment_channel(channel_id, request.form, request.files)
    return jsonify(payload), status_code


@board_router_bp.route("/payment-channels/<int:channel_id>", methods=["DELETE"])
@permission_required_any("account_edit")
def delete_payment_channel_route(channel_id):
    payload, status_code = delete_payment_channel(channel_id)
    return jsonify(payload), status_code


@board_router_bp.route("/relation-options", methods=["GET"])
def list_relation_options_route():
    # 公开可读：填写牌位时需要下拉选择超度亡灵的关系。
    payload, status_code = list_relation_options()
    return jsonify(payload), status_code


@board_router_bp.route("/relation-options", methods=["POST"])
@permission_required_any("account_edit")
def create_relation_option_route():
    payload, status_code = create_relation_option(request.get_json(silent=True) or {})
    return jsonify(payload), status_code


@board_router_bp.route("/relation-options/import", methods=["POST"])
@permission_required_any("account_edit")
def import_relation_options_route():
    payload, status_code = import_relation_options_from_history()
    return jsonify(payload), status_code


@board_router_bp.route("/relation-options/<int:option_id>", methods=["DELETE"])
@permission_required_any("account_edit")
def delete_relation_option_route(option_id):
    payload, status_code = delete_relation_option(option_id)
    return jsonify(payload), status_code


@board_router_bp.route("/orders/detail", methods=["GET"])
@board_router_bp.route("/get_order_detail", methods=["GET"])
def get_order_detail_route():
    payload, status_code = get_board_order_detail(request.args.get("id", type=int))
    return jsonify(payload), status_code


@board_router_bp.route("/orders/check-duplicate-owner-fields", methods=["GET"])
@board_router_bp.route("/check_duplicate_owner_fields", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def check_duplicate_order_owner_fields_route():
    return jsonify(check_duplicate_owner_fields())


@board_router_bp.route("/orders/quick-search", methods=["POST"])
@board_router_bp.route("/fahui_search_emgine", methods=["POST"])
def quick_search_orders_route():
    payload = request.get_json(silent=True) or {}
    return jsonify(quick_search_orders(payload.get("keyword"), payload.get("version")))


@board_router_bp.route("/orders/<int:order_id>/items", methods=["POST"])
@board_router_bp.route("/add_paiwei/<int:order_id>", methods=["POST"])
def create_order_item_route(order_id):
    payload, status_code = create_order_item(order_id, request.get_json(silent=True) or {})
    return jsonify(payload), status_code


@board_router_bp.route("/orders/<int:order_id>/items/<int:item_id>", methods=["POST"])
def update_order_item_route(order_id, item_id):
    del order_id
    payload, status_code = update_order_item_fields(item_id, request.get_json(silent=True) or {})
    return jsonify(payload), status_code


@board_router_bp.route("/orders/<int:order_id>/items/<int:item_id>", methods=["DELETE"])
@board_router_bp.route("/delete_item/<int:item_id>/<int:order_id>", methods=["DELETE"])
def delete_order_item_route(item_id, order_id):
    payload, status_code = delete_order_item(item_id, order_id)
    return jsonify(payload), status_code


@board_router_bp.route("/orders/delete", methods=["POST"])
@board_router_bp.route("/delete_orders", methods=["POST"])
@permission_required_any("account_edit")
def delete_order_batch_route():
    payload, status_code = delete_order_batch(request.get_json(silent=True) or {})
    return jsonify(payload), status_code


@board_router_bp.route("/orders/clone", methods=["POST"])
@board_router_bp.route("/copy_old_data", methods=["POST"])
@permission_required_any("account_edit")
def clone_orders_route():
    payload, status_code = clone_order_to_version(request.get_json(silent=True) or {})
    return jsonify(payload), status_code


@board_router_bp.route("/orders/copy-to-current", methods=["POST"])
@permission_required_any("account_edit")
def copy_orders_to_current_route():
    payload, status_code = copy_orders_to_current(request.get_json(silent=True) or {})
    return jsonify(payload), status_code


@board_router_bp.route("/item-form-values", methods=["POST"])
@board_router_bp.route("/update_item_form_value", methods=["POST"])
def update_order_item_form_value_route():
    payload, status_code = update_order_item_form_value(request.get_json(silent=True) or {})
    return jsonify(payload), status_code
