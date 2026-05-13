from flask import Blueprint, jsonify, request

from app.asset.exceptions import AssetError
from app.asset.permissions import require_asset_edit_permission, require_asset_read_permission
from app.asset.serializers import (
    serialize_inventory_row,
    serialize_item,
    serialize_partner,
    serialize_stock_document,
    serialize_sub_item,
    serialize_warehouse,
)
from app.asset.services import (
    cancel_stock_document,
    confirm_stock_document,
    create_item,
    create_partner,
    create_stock_document,
    create_sub_item,
    create_warehouse,
    delete_item,
    delete_partner,
    delete_stock_document,
    delete_sub_item,
    delete_warehouse,
    load_asset_dashboard,
    load_asset_documents_data,
    load_asset_inventory_data,
    load_asset_master_data,
    load_asset_movements_data,
    list_asset_partners,
    update_item,
    update_inventory_threshold,
    update_partner,
    update_stock_document,
    update_sub_item,
    update_warehouse,
    upload_document_invoice,
)

asset_bp = Blueprint("asset", __name__)


def _error_response(exc):
    return jsonify({"status": "error", "message": exc.message}), exc.status_code


@asset_bp.get("/dashboard")
def get_asset_dashboard():
    try:
        require_asset_read_permission()
        return jsonify({"status": "success", "data": load_asset_dashboard()})
    except AssetError as exc:
        return _error_response(exc)


@asset_bp.get("/master-data")
def get_asset_master_data():
    try:
        require_asset_read_permission()
        return jsonify({"status": "success", "data": load_asset_master_data()})
    except AssetError as exc:
        return _error_response(exc)


@asset_bp.get("/inventory")
def get_asset_inventory():
    try:
        require_asset_read_permission()
        return jsonify({"status": "success", "data": load_asset_inventory_data()})
    except AssetError as exc:
        return _error_response(exc)


@asset_bp.get("/movements")
def get_asset_movements():
    try:
        require_asset_read_permission()
        return jsonify({"status": "success", "data": load_asset_movements_data()})
    except AssetError as exc:
        return _error_response(exc)


@asset_bp.get("/partners")
def get_asset_partners():
    try:
        require_asset_read_permission()
        return jsonify({"status": "success", "data": list_asset_partners()})
    except AssetError as exc:
        return _error_response(exc)


@asset_bp.post("/warehouses")
def create_warehouse_route():
    try:
        user = require_asset_edit_permission()
        payload = request.get_json(silent=True) or {}
        warehouse = create_warehouse(payload, user)
        return (
            jsonify(
                {
                    "status": "success",
                    "message": "仓库已创建",
                    "data": serialize_warehouse(warehouse),
                }
            ),
            201,
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.patch("/warehouses/<int:warehouse_id>")
def update_warehouse_route(warehouse_id):
    try:
        user = require_asset_edit_permission()
        payload = request.get_json(silent=True) or {}
        warehouse = update_warehouse(warehouse_id, payload, user)
        return jsonify(
            {
                "status": "success",
                "message": "仓库已更新",
                "data": serialize_warehouse(warehouse),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.delete("/warehouses/<int:warehouse_id>")
def delete_warehouse_route(warehouse_id):
    try:
        user = require_asset_edit_permission()
        delete_warehouse(warehouse_id, user)
        return jsonify({"status": "success", "message": "仓库已删除"})
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.post("/items")
def create_item_route():
    try:
        user = require_asset_edit_permission()
        payload = request.get_json(silent=True) or {}
        item = create_item(payload, user)
        return (
            jsonify(
                {
                    "status": "success",
                    "message": "资产 item 已创建",
                    "data": serialize_item(item),
                }
            ),
            201,
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.post("/partners")
def create_partner_route():
    try:
        user = require_asset_edit_permission()
        payload = request.get_json(silent=True) or {}
        partner = create_partner(payload, user)
        return (
            jsonify(
                {
                    "status": "success",
                    "message": "往来对象已创建",
                    "data": serialize_partner(partner),
                }
            ),
            201,
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.patch("/partners/<int:partner_id>")
def update_partner_route(partner_id):
    try:
        user = require_asset_edit_permission()
        payload = request.get_json(silent=True) or {}
        partner = update_partner(partner_id, payload, user)
        return jsonify(
            {
                "status": "success",
                "message": "往来对象已更新",
                "data": serialize_partner(partner),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.delete("/partners/<int:partner_id>")
def delete_partner_route(partner_id):
    try:
        user = require_asset_edit_permission()
        delete_partner(partner_id, user)
        return jsonify({"status": "success", "message": "往来对象已删除"})
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.patch("/items/<int:item_id>")
def update_item_route(item_id):
    try:
        user = require_asset_edit_permission()
        payload = request.get_json(silent=True) or {}
        item = update_item(item_id, payload, user)
        return jsonify(
            {
                "status": "success",
                "message": "资产 item 已更新",
                "data": serialize_item(item),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.delete("/items/<int:item_id>")
def delete_item_route(item_id):
    try:
        user = require_asset_edit_permission()
        delete_item(item_id, user)
        return jsonify({"status": "success", "message": "资产 item 已删除"})
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.post("/items/<int:item_id>/sub-items")
def create_sub_item_route(item_id):
    try:
        user = require_asset_edit_permission()
        payload = request.get_json(silent=True) or {}
        sub_item = create_sub_item(item_id, payload, user)
        return (
            jsonify(
                {
                    "status": "success",
                    "message": "子 item 已创建",
                    "data": serialize_sub_item(sub_item),
                }
            ),
            201,
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.patch("/sub-items/<int:sub_item_id>")
def update_sub_item_route(sub_item_id):
    try:
        user = require_asset_edit_permission()
        payload = request.get_json(silent=True) or {}
        sub_item = update_sub_item(sub_item_id, payload, user)
        return jsonify(
            {
                "status": "success",
                "message": "子 item 已更新",
                "data": serialize_sub_item(sub_item),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.delete("/sub-items/<int:sub_item_id>")
def delete_sub_item_route(sub_item_id):
    try:
        user = require_asset_edit_permission()
        delete_sub_item(sub_item_id, user)
        return jsonify({"status": "success", "message": "子 item 已删除"})
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.get("/stock-documents")
def get_stock_documents():
    try:
        require_asset_read_permission()
        return jsonify({"status": "success", "data": load_asset_documents_data()})
    except AssetError as exc:
        return _error_response(exc)


@asset_bp.post("/stock-documents")
def create_stock_document_route():
    try:
        user = require_asset_edit_permission()
        payload = request.get_json(silent=True) or {}
        document = create_stock_document(payload, user)
        return (
            jsonify(
                {
                    "status": "success",
                    "message": "库存单据已创建",
                    "data": serialize_stock_document(document, include_children=True),
                }
            ),
            201,
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.patch("/stock-documents/<int:document_id>")
def update_stock_document_route(document_id):
    try:
        user = require_asset_edit_permission()
        payload = request.get_json(silent=True) or {}
        document = update_stock_document(document_id, payload, user)
        return jsonify(
            {
                "status": "success",
                "message": "库存单据已更新",
                "data": serialize_stock_document(document, include_children=True),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.post("/stock-documents/<int:document_id>/confirm")
def confirm_stock_document_route(document_id):
    try:
        user = require_asset_edit_permission()
        document = confirm_stock_document(document_id, user)
        return jsonify(
            {
                "status": "success",
                "message": "库存单据已确认",
                "data": serialize_stock_document(document, include_children=True),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.post("/stock-documents/<int:document_id>/cancel")
def cancel_stock_document_route(document_id):
    try:
        user = require_asset_edit_permission()
        document = cancel_stock_document(document_id, user)
        return jsonify(
            {
                "status": "success",
                "message": "库存单据已作废",
                "data": serialize_stock_document(document, include_children=True),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.delete("/stock-documents/<int:document_id>")
def delete_stock_document_route(document_id):
    try:
        user = require_asset_edit_permission()
        delete_stock_document(document_id, user)
        return jsonify({"status": "success", "message": "库存单据已删除"})
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.patch("/inventory/<int:inventory_id>/threshold")
def update_inventory_threshold_route(inventory_id):
    try:
        user = require_asset_edit_permission()
        payload = request.get_json(silent=True) or {}
        inventory = update_inventory_threshold(inventory_id, payload, user)
        return jsonify(
            {
                "status": "success",
                "message": "最低库存已更新",
                "data": serialize_inventory_row(inventory),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


@asset_bp.post("/stock-documents/<int:document_id>/invoice")
def upload_document_invoice_route(document_id):
    try:
        user = require_asset_edit_permission()
        uploaded_file = request.files.get("file")
        document = upload_document_invoice(document_id, uploaded_file, user)
        return jsonify(
            {
                "status": "success",
                "message": "invoice 文件已上传",
                "data": serialize_stock_document(document, include_children=True),
            }
        )
    except AssetError as exc:
        return _error_response(exc)
    except Exception as exc:
        from models import db

        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500
