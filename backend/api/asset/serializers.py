"""资产模块的 JSON 序列化（原 backend/app/asset/serializers.py，一字未改）。

这里每一个键名都是前端在读的字段，**改名即线上故障**。几处容易被「顺手优化」掉的：

  · ``_user_label`` 写的是 display_name → ``name_nric`` → username，但中间那一档
    **实际上永远取不到值**：``name_nric`` 是 NRIC 资料表（models/form.py）上的列，
    User 上没有这个属性，要经 ``user.nric_asset.name_nric`` 才拿得到。
    所以真实行为是 display_name → username。
    ★ 这是「看着像 bug、故意保留」的一处：把它接通会让一批**现在显示 username**
      的用户突然变成显示真实姓名（单据上的经手人/领用人列），属于可见变更。
    TODO(资产): 要接通就改成 ``getattr(getattr(user, "nric_asset", None), "name_nric", None)``，
      但必须和前端一起确认单据历史显示能不能变。（隔壁 gl 的 ``name_NRIC`` 同理，也是死分支。）
  · ``_user_label`` 的第一档是 ``user.display_name``（直接取属性，不是 getattr）——
    传进来的不是 User 对象时会 AttributeError → 500。原样保留：调用点传的都是关系属性。
  · ``available_quantity`` = max(quantity - reserved, 0)，**不允许出负数**。
    前端直接拿它显示「可用」，出负数会让库存页显示成负库存。
  · ``serialize_item`` 里子 item 的排序键是 ``(size or "", name or "", id or 0)``
    —— 三个都做了空值兜底，因为 size/name 允许为 NULL，不兜底会 TypeError。
    排序发生在 Python 侧而不是 SQL 侧（size 是尺码串，DB 排序规则和这里不一定一致），保持。
  · ``invoice_file_path`` 先 strip 再 ``or None``：空串要变成 None，
    前端按 ``if (data.invoice_file_path)`` 判断有没有发票文件，空串会被判成「有」。
    ``invoice_file_name`` 只是它的 basename，路径为空时同样是 None。
  · ``taken_by_name`` / ``counterparty_name`` 先取单据上**冗余存的那一份**，
    再回退到关联对象的名字。顺序不能反：单据存的是「当时那个名字」，
    关联对象改名之后历史单据要维持原样。
  · 日期一律 ``isoformat()``，空值出 None（不是空字符串）。
  · ``serialize_stock_document`` 的 ``include_children=False`` 时**根本不放** lines/movements 这两个键
    （不是放空列表）；``include_children=True`` 而 include_lines/include_movements 为 False 时
    放的是**空列表**。两种「没有明细」的形状不一样，前端两条分支都在用，别合并。
"""

import os
from decimal import Decimal

from backend.models.asset import (
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
        "finance_payment_status": document.finance_payment_status,
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
