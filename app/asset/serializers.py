import os
from decimal import Decimal

from models.asset import (
    AssetInventory,
    AssetItem,
    AssetPartner,
    AssetStockDocument,
    AssetStockDocumentLine,
    AssetStockMovement,
    AssetSubItem,
    AssetWarehouse,
)


def _to_float(value):
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _user_label(user):
    if not user:
        return None
    return user.display_name or getattr(user, "name_nric", None) or user.username


def serialize_warehouse(warehouse: AssetWarehouse):
    return {
        "id": warehouse.id,
        "name": warehouse.name,
        "code": warehouse.code,
        "location": warehouse.location,
        "remark": warehouse.remark,
        "manager_user_id": warehouse.manager_user_id,
        "manager_name": _user_label(warehouse.manager),
        "created_at": warehouse.created_at.isoformat() if warehouse.created_at else None,
        "updated_at": warehouse.updated_at.isoformat() if warehouse.updated_at else None,
    }


def serialize_partner(partner: AssetPartner):
    return {
        "id": partner.id,
        "name": partner.name,
        "code": partner.code,
        "partner_type": partner.partner_type,
        "contact_person": partner.contact_person,
        "phone": partner.phone,
        "address": partner.address,
        "status": partner.status,
        "remark": partner.remark,
        "created_at": partner.created_at.isoformat() if partner.created_at else None,
        "updated_at": partner.updated_at.isoformat() if partner.updated_at else None,
    }


def serialize_sub_item(sub_item: AssetSubItem):
    return {
        "id": sub_item.id,
        "item_id": sub_item.item_id,
        "item_name": getattr(sub_item.item, "name", None),
        "name": sub_item.name,
        "sku": sub_item.sku,
        "size": sub_item.size,
        "color": sub_item.color,
        "barcode": sub_item.barcode,
        "status": sub_item.status,
        "remark": sub_item.remark,
        "created_at": sub_item.created_at.isoformat() if sub_item.created_at else None,
        "updated_at": sub_item.updated_at.isoformat() if sub_item.updated_at else None,
    }


def serialize_item(item: AssetItem):
    return {
        "id": item.id,
        "name": item.name,
        "code": item.code,
        "category": item.category,
        "unit": item.unit,
        "status": item.status,
        "remark": item.remark,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        "sub_items": [serialize_sub_item(sub_item) for sub_item in sorted(item.sub_items, key=lambda row: (row.size or "", row.name or "", row.id or 0))],
    }


def serialize_inventory_row(inventory: AssetInventory):
    sub_item = inventory.sub_item
    item = getattr(sub_item, "item", None)
    warehouse = inventory.warehouse
    return {
        "id": inventory.id,
        "warehouse_id": inventory.warehouse_id,
        "warehouse_name": getattr(warehouse, "name", None),
        "warehouse_code": getattr(warehouse, "code", None),
        "sub_item_id": inventory.sub_item_id,
        "sub_item_name": getattr(sub_item, "name", None),
        "size": getattr(sub_item, "size", None),
        "color": getattr(sub_item, "color", None),
        "item_id": getattr(item, "id", None),
        "item_name": getattr(item, "name", None),
        "item_code": getattr(item, "code", None),
        "quantity": inventory.quantity,
        "reserved_quantity": inventory.reserved_quantity,
        "available_quantity": max((inventory.quantity or 0) - (inventory.reserved_quantity or 0), 0),
        "min_quantity": inventory.min_quantity,
        "updated_at": inventory.updated_at.isoformat() if inventory.updated_at else None,
    }


def serialize_stock_document_line(line: AssetStockDocumentLine):
    return {
        "id": line.id,
        "document_id": line.document_id,
        "sub_item_id": line.sub_item_id,
        "sub_item_name": getattr(line.sub_item, "name", None),
        "item_name": getattr(getattr(line.sub_item, "item", None), "name", None),
        "size": getattr(line.sub_item, "size", None),
        "quantity": line.quantity,
        "unit_cost": _to_float(line.unit_cost),
        "unit_price": _to_float(line.unit_price),
        "line_amount": _to_float(line.line_amount),
        "remark": line.remark,
    }


def serialize_stock_movement(movement: AssetStockMovement):
    return {
        "id": movement.id,
        "document_id": movement.document_id,
        "document_line_id": movement.document_line_id,
        "warehouse_id": movement.warehouse_id,
        "warehouse_name": getattr(movement.warehouse, "name", None),
        "sub_item_id": movement.sub_item_id,
        "sub_item_name": getattr(movement.sub_item, "name", None),
        "item_name": getattr(getattr(movement.sub_item, "item", None), "name", None),
        "movement_type": movement.movement_type,
        "quantity_delta": movement.quantity_delta,
        "quantity_before": movement.quantity_before,
        "quantity_after": movement.quantity_after,
        "taken_by_user_id": movement.taken_by_user_id,
        "taken_by_name": _user_label(movement.taken_by_user),
        "destination_text": movement.destination_text,
        "invoice_no": movement.invoice_no,
        "created_by": movement.created_by,
        "created_by_name": _user_label(movement.creator),
        "created_at": movement.created_at.isoformat() if movement.created_at else None,
    }


def serialize_stock_document(document: AssetStockDocument, include_children=True, include_lines=True, include_movements=True):
    invoice_file_path = str(document.invoice_file_path or "").strip() or None
    data = {
        "id": document.id,
        "document_no": document.document_no,
        "document_type": document.document_type,
        "status": document.status,
        "source_warehouse_id": document.source_warehouse_id,
        "source_warehouse_name": getattr(document.source_warehouse, "name", None),
        "target_warehouse_id": document.target_warehouse_id,
        "target_warehouse_name": getattr(document.target_warehouse, "name", None),
        "requester_user_id": document.requester_user_id,
        "requester_name": _user_label(document.requester),
        "handler_user_id": document.handler_user_id,
        "handler_name": _user_label(document.handler),
        "taken_by_user_id": document.taken_by_user_id,
        "taken_by_name": document.taken_by_name or _user_label(document.taken_by_user),
        "destination_type": document.destination_type,
        "destination_text": document.destination_text,
        "counterparty_id": document.counterparty_id,
        "counterparty_code": getattr(document.counterparty, "code", None),
        "counterparty_type": getattr(document.counterparty, "partner_type", None),
        "counterparty_name": document.counterparty_name or getattr(document.counterparty, "name", None),
        "event_id": document.event_id,
        "event_name": getattr(document.event, "event_name", None),
        "invoice_no": document.invoice_no,
        "invoice_type": document.invoice_type,
        "invoice_file_path": invoice_file_path,
        "invoice_file_name": os.path.basename(invoice_file_path) if invoice_file_path else None,
        "reference_type": document.reference_type,
        "reference_id": document.reference_id,
        "note": document.note,
        "created_by": document.created_by,
        "created_by_name": _user_label(document.creator),
        "approved_by": document.approved_by,
        "approved_by_name": _user_label(document.approver),
        "confirmed_at": document.confirmed_at.isoformat() if document.confirmed_at else None,
        "created_at": document.created_at.isoformat() if document.created_at else None,
        "updated_at": document.updated_at.isoformat() if document.updated_at else None,
    }
    if include_children:
        data["lines"] = [serialize_stock_document_line(line) for line in document.lines] if include_lines else []
        data["movements"] = [serialize_stock_movement(movement) for movement in document.movements] if include_movements else []
    return data
