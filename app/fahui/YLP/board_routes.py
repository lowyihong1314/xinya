from flask import Blueprint, jsonify, request
from flask_login import login_required

from app.form.permissions import permission_required_any

from .board_services import (
    attach_pdf_to_board,
    check_duplicate_owner_fields,
    clear_print_pdf_records,
    clone_order_to_version,
    create_order_item,
    delete_board_entry,
    delete_order_batch,
    delete_order_item,
    get_board_order_detail,
    get_print_pdf_data,
    list_all_boards,
    list_orders_by_version,
    list_print_pdf_records,
    list_versions,
    quick_search_orders,
    reorder_board_entry,
    update_order_customer,
    update_order_item_form_value,
)


board_router_bp = Blueprint("board_router", __name__)


@board_router_bp.route("/print-pdfs/<int:pdf_id>", methods=["GET"])
@board_router_bp.route("/get_pdf_data/<int:pdf_id>", methods=["GET"])
@login_required
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
@login_required
def list_boards_route():
    return jsonify(list_all_boards())


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
@login_required
def list_print_pdfs_route():
    return jsonify(list_print_pdf_records()), 200


@board_router_bp.route("/versions", methods=["GET"])
@board_router_bp.route("/get_version_list", methods=["GET"])
@login_required
def list_versions_route():
    return jsonify(list_versions())


@board_router_bp.route("/orders", methods=["GET"])
@board_router_bp.route("/get_orders_data", methods=["GET"])
@login_required
def list_orders_route():
    return jsonify(list_orders_by_version(request.args.get("version", "2024_YLP")))


@board_router_bp.route("/orders/<int:order_id>/customer", methods=["POST"])
@board_router_bp.route("/update_customer/<int:order_id>", methods=["POST"])
def update_order_customer_route(order_id):
    payload, status_code = update_order_customer(order_id, request.get_json(silent=True) or {})
    return jsonify(payload), status_code


@board_router_bp.route("/orders/detail", methods=["GET"])
@board_router_bp.route("/get_order_detail", methods=["GET"])
def get_order_detail_route():
    payload, status_code = get_board_order_detail(request.args.get("id", type=int))
    return jsonify(payload), status_code


@board_router_bp.route("/orders/check-duplicate-owner-fields", methods=["GET"])
@board_router_bp.route("/check_duplicate_owner_fields", methods=["GET"])
@login_required
def check_duplicate_order_owner_fields_route():
    return jsonify(check_duplicate_owner_fields())


@board_router_bp.route("/orders/quick-search", methods=["POST"])
@board_router_bp.route("/fahui_search_emgine", methods=["POST"])
def quick_search_orders_route():
    return jsonify(quick_search_orders((request.get_json(silent=True) or {}).get("keyword")))


@board_router_bp.route("/orders/<int:order_id>/items", methods=["POST"])
@board_router_bp.route("/add_paiwei/<int:order_id>", methods=["POST"])
def create_order_item_route(order_id):
    payload, status_code = create_order_item(order_id, request.get_json(silent=True) or {})
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


@board_router_bp.route("/item-form-values", methods=["POST"])
@board_router_bp.route("/update_item_form_value", methods=["POST"])
def update_order_item_form_value_route():
    payload, status_code = update_order_item_form_value(request.get_json(silent=True) or {})
    return jsonify(payload), status_code
