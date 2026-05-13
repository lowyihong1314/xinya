import mimetypes
import os
import re
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import or_
from sqlalchemy.orm import joinedload, lazyload, selectinload

from app.asset.exceptions import NotFound, ValidationError
from app.paths import DATA_ROOT
from app.asset.serializers import (
    serialize_inventory_row,
    serialize_item,
    serialize_partner,
    serialize_stock_document,
    serialize_warehouse,
)
from models import db
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
from models.finance import ReimbursementRequest

DOCUMENT_TYPES = {
    "purchase_in",
    "manual_in",
    "issue_out",
    "transfer",
    "sale_out",
    "sale_return",
    "adjust",
}

INBOUND_DOCUMENT_TYPES = {"purchase_in", "manual_in", "sale_return"}
OUTBOUND_DOCUMENT_TYPES = {"issue_out", "sale_out"}
PARTNER_TYPES = {"supplier", "customer", "both"}
ASSET_INVOICE_DIR = DATA_ROOT / "NAS" / "UTBA" / "asset_invoice"
WAREHOUSE_CODE_PREFIX = "WH-"
ITEM_CODE_PREFIX = "ITM-"
REFERENCE_TYPES = {"reimbursement_request"}


def _clean_text(value):
    text = str(value or "").strip()
    return text or None


def _require_text(value, field_name):
    text = _clean_text(value)
    if not text:
        raise ValidationError(f"{field_name} 不能为空")
    return text


def _optional_int(value, field_name):
    if value in (None, "", "null"):
        return None
    try:
        return int(value)
    except Exception as exc:
        raise ValidationError(f"{field_name} 格式错误") from exc


def _require_positive_int(value, field_name):
    try:
        parsed = int(value)
    except Exception as exc:
        raise ValidationError(f"{field_name} 必须是整数") from exc
    if parsed <= 0:
        raise ValidationError(f"{field_name} 必须大于 0")
    return parsed


def _require_nonzero_int(value, field_name):
    try:
        parsed = int(value)
    except Exception as exc:
        raise ValidationError(f"{field_name} 必须是整数") from exc
    if parsed == 0:
        raise ValidationError(f"{field_name} 不能为 0")
    return parsed


def _require_non_negative_int(value, field_name):
    try:
        parsed = int(value)
    except Exception as exc:
        raise ValidationError(f"{field_name} 必须是整数") from exc
    if parsed < 0:
        raise ValidationError(f"{field_name} 不能小于 0")
    return parsed


def _optional_money(value, field_name):
    if value in (None, ""):
        return None
    try:
        return round(float(value), 2)
    except Exception as exc:
        raise ValidationError(f"{field_name} 金额格式错误") from exc


def _require_document_type(value):
    document_type = _clean_text(value)
    if document_type not in DOCUMENT_TYPES:
        raise ValidationError("document_type 不合法")
    return document_type


def _normalize_code_or_none(value):
    code = _clean_text(value)
    return code.upper() if code else None


def _generate_next_warehouse_code():
    existing_codes = (
        db.session.query(AssetWarehouse.code)
        .filter(AssetWarehouse.code.like(f"{WAREHOUSE_CODE_PREFIX}%"))
        .all()
    )
    max_serial = 0
    for row in existing_codes:
        code = str(row[0] or "").strip().upper()
        match = re.fullmatch(rf"{re.escape(WAREHOUSE_CODE_PREFIX)}(\d+)", code)
        if not match:
            continue
        max_serial = max(max_serial, int(match.group(1)))

    next_serial = max_serial + 1
    while True:
        candidate = f"{WAREHOUSE_CODE_PREFIX}{next_serial:04d}"
        duplicate = AssetWarehouse.query.filter(
            db.func.lower(AssetWarehouse.code) == candidate.lower()
        ).first()
        if not duplicate:
            return candidate
        next_serial += 1


def _generate_next_item_code():
    existing_codes = (
        db.session.query(AssetItem.code)
        .filter(AssetItem.code.like(f"{ITEM_CODE_PREFIX}%"))
        .all()
    )
    max_serial = 0
    for row in existing_codes:
        code = str(row[0] or "").strip().upper()
        match = re.fullmatch(rf"{re.escape(ITEM_CODE_PREFIX)}(\d+)", code)
        if not match:
            continue
        max_serial = max(max_serial, int(match.group(1)))

    next_serial = max_serial + 1
    while True:
        candidate = f"{ITEM_CODE_PREFIX}{next_serial:04d}"
        duplicate = AssetItem.query.filter(
            db.func.lower(AssetItem.code) == candidate.lower()
        ).first()
        if not duplicate:
            return candidate
        next_serial += 1


def _require_partner_type(value):
    partner_type = _clean_text(value) or "both"
    if partner_type not in PARTNER_TYPES:
        raise ValidationError("partner_type 不合法")
    return partner_type


def _guess_extension(file_name, mime_type):
    extension = os.path.splitext(file_name or "")[1].strip()
    if extension:
        return extension

    guessed = mimetypes.guess_extension((mime_type or "").split(";")[0].strip(), strict=False)
    if guessed == ".jpe":
        return ".jpg"
    return guessed or ""


def _normalize_upload_name(raw_name, mime_type):
    cleaned = os.path.basename((raw_name or "").replace("\\", "/")).strip()
    cleaned = "".join(char for char in cleaned if char >= " " and char != "\x7f")
    if not cleaned:
        cleaned = "invoice"

    extension = _guess_extension(cleaned, mime_type)
    stem, current_extension = os.path.splitext(cleaned)
    if current_extension:
        return cleaned, current_extension

    stem = stem or cleaned or "invoice"
    return f"{stem}{extension}", extension


def _get_warehouse_or_raise(warehouse_id):
    warehouse = AssetWarehouse.query.get(warehouse_id)
    if not warehouse:
        raise NotFound("找不到仓库")
    return warehouse


def _get_item_or_raise(item_id):
    item = AssetItem.query.options(
        lazyload("*"),
        selectinload(AssetItem.sub_items).lazyload("*"),
    ).get(item_id)
    if not item:
        raise NotFound("找不到资产 item")
    return item


def _get_partner_or_raise(partner_id):
    partner = AssetPartner.query.get(partner_id)
    if not partner:
        raise NotFound("找不到往来对象")
    return partner


def _get_sub_item_or_raise(sub_item_id):
    sub_item = AssetSubItem.query.options(
        lazyload("*"),
        joinedload(AssetSubItem.item).lazyload("*"),
    ).get(sub_item_id)
    if not sub_item:
        raise NotFound("找不到子 item")
    return sub_item


def _get_document_or_raise(document_id):
    document = (
        AssetStockDocument.query.options(
            lazyload("*"),
            selectinload(AssetStockDocument.lines).lazyload("*"),
            selectinload(AssetStockDocument.lines)
            .joinedload(AssetStockDocumentLine.sub_item)
            .lazyload("*"),
            selectinload(AssetStockDocument.lines)
            .joinedload(AssetStockDocumentLine.sub_item)
            .joinedload(AssetSubItem.item)
            .lazyload("*"),
            selectinload(AssetStockDocument.movements).lazyload("*"),
            selectinload(AssetStockDocument.movements)
            .joinedload(AssetStockMovement.warehouse)
            .lazyload("*"),
            joinedload(AssetStockDocument.source_warehouse).lazyload("*"),
            joinedload(AssetStockDocument.target_warehouse).lazyload("*"),
            joinedload(AssetStockDocument.requester).lazyload("*"),
            joinedload(AssetStockDocument.handler).lazyload("*"),
            joinedload(AssetStockDocument.taken_by_user).lazyload("*"),
            joinedload(AssetStockDocument.counterparty).lazyload("*"),
            joinedload(AssetStockDocument.creator).lazyload("*"),
            joinedload(AssetStockDocument.approver).lazyload("*"),
            joinedload(AssetStockDocument.event).lazyload("*"),
        )
        .filter(AssetStockDocument.id == document_id)
        .first()
    )
    if not document:
        raise NotFound("找不到库存单据")
    return document


def _get_reimbursement_request_or_raise(request_id):
    request_obj = ReimbursementRequest.query.get(request_id)
    if not request_obj:
        raise NotFound("找不到报销申请")
    return request_obj


def _get_inventory_or_raise(inventory_id):
    inventory = (
        AssetInventory.query.options(
            lazyload("*"),
            joinedload(AssetInventory.warehouse).lazyload("*"),
            joinedload(AssetInventory.sub_item).lazyload("*"),
            joinedload(AssetInventory.sub_item).joinedload(AssetSubItem.item).lazyload("*"),
        )
        .filter(AssetInventory.id == inventory_id)
        .first()
    )
    if not inventory:
        raise NotFound("找不到库存记录")
    return inventory


def _delete_relative_data_file(relative_path):
    normalized = str(relative_path or "").strip()
    if not normalized:
        return
    target = DATA_ROOT / Path(normalized)
    try:
        if target.is_file():
            target.unlink()
    except Exception:
        pass


def _generate_document_no():
    return f"AST-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"


def _get_or_create_inventory(warehouse_id, sub_item_id):
    inventory = (
        AssetInventory.query.filter_by(warehouse_id=warehouse_id, sub_item_id=sub_item_id)
        .with_for_update()
        .first()
    )
    if inventory:
        return inventory

    inventory = AssetInventory(
        warehouse_id=warehouse_id,
        sub_item_id=sub_item_id,
        quantity=0,
        reserved_quantity=0,
        min_quantity=0,
    )
    db.session.add(inventory)
    db.session.flush()
    return inventory


def _create_movement(document, line, warehouse_id, movement_type, quantity_delta, actor_user):
    inventory = _get_or_create_inventory(warehouse_id, line.sub_item_id)
    before = int(inventory.quantity or 0)
    after = before + int(quantity_delta)
    if after < 0:
        warehouse = _get_warehouse_or_raise(warehouse_id)
        sub_item = _get_sub_item_or_raise(line.sub_item_id)
        raise ValidationError(
            f"库存不足：{warehouse.name} 的 {sub_item.name} 当前只有 {before}，无法变动 {quantity_delta}"
        )

    inventory.quantity = after
    inventory.updated_at = datetime.utcnow()

    movement = AssetStockMovement(
        document_id=document.id,
        document_line_id=line.id,
        warehouse_id=warehouse_id,
        sub_item_id=line.sub_item_id,
        movement_type=movement_type,
        quantity_delta=quantity_delta,
        quantity_before=before,
        quantity_after=after,
        taken_by_user_id=document.taken_by_user_id,
        destination_text=document.destination_text,
        invoice_no=document.invoice_no,
        created_by=getattr(actor_user, "id", None),
    )
    db.session.add(movement)


def _query_asset_warehouses():
    return (
        AssetWarehouse.query.options(
            lazyload("*"),
            joinedload(AssetWarehouse.manager).lazyload("*"),
        )
        .order_by(AssetWarehouse.name.asc())
        .all()
    )


def _query_asset_partners():
    return (
        AssetPartner.query.options(lazyload("*"))
        .order_by(
            AssetPartner.partner_type.asc(),
            AssetPartner.name.asc(),
            AssetPartner.id.asc(),
        )
        .all()
    )


def _query_asset_items():
    return (
        AssetItem.query.options(
            lazyload("*"),
            selectinload(AssetItem.sub_items).lazyload("*"),
        )
        .order_by(AssetItem.name.asc(), AssetItem.id.asc())
        .all()
    )


def _query_asset_inventory():
    return (
        AssetInventory.query.options(
            lazyload("*"),
            joinedload(AssetInventory.warehouse).lazyload("*"),
            joinedload(AssetInventory.sub_item).lazyload("*"),
            joinedload(AssetInventory.sub_item).joinedload(AssetSubItem.item).lazyload("*"),
        )
        .order_by(AssetWarehouse.name.asc(), AssetItem.name.asc(), AssetSubItem.size.asc(), AssetSubItem.id.asc())
        .join(AssetInventory.warehouse)
        .join(AssetInventory.sub_item)
        .join(AssetSubItem.item)
        .all()
    )


def _query_asset_documents(limit=30, include_lines=True, include_movements=True):
    options = [
        lazyload("*"),
        joinedload(AssetStockDocument.source_warehouse).lazyload("*"),
        joinedload(AssetStockDocument.target_warehouse).lazyload("*"),
        joinedload(AssetStockDocument.requester).lazyload("*"),
        joinedload(AssetStockDocument.handler).lazyload("*"),
        joinedload(AssetStockDocument.taken_by_user).lazyload("*"),
        joinedload(AssetStockDocument.counterparty).lazyload("*"),
        joinedload(AssetStockDocument.creator).lazyload("*"),
        joinedload(AssetStockDocument.approver).lazyload("*"),
        joinedload(AssetStockDocument.event).lazyload("*"),
    ]
    if include_lines:
        options.extend(
            [
                selectinload(AssetStockDocument.lines).lazyload("*"),
                selectinload(AssetStockDocument.lines)
                .joinedload(AssetStockDocumentLine.sub_item)
                .lazyload("*"),
                selectinload(AssetStockDocument.lines)
                .joinedload(AssetStockDocumentLine.sub_item)
                .joinedload(AssetSubItem.item)
                .lazyload("*"),
            ]
        )
    if include_movements:
        options.extend(
            [
                selectinload(AssetStockDocument.movements).lazyload("*"),
                selectinload(AssetStockDocument.movements)
                .joinedload(AssetStockMovement.sub_item)
                .lazyload("*"),
                selectinload(AssetStockDocument.movements)
                .joinedload(AssetStockMovement.sub_item)
                .joinedload(AssetSubItem.item)
                .lazyload("*"),
                selectinload(AssetStockDocument.movements)
                .joinedload(AssetStockMovement.warehouse)
                .lazyload("*"),
                selectinload(AssetStockDocument.movements)
                .joinedload(AssetStockMovement.taken_by_user)
                .lazyload("*"),
                selectinload(AssetStockDocument.movements)
                .joinedload(AssetStockMovement.creator)
                .lazyload("*"),
            ]
        )
    return (
        AssetStockDocument.query.options(*options)
        .order_by(AssetStockDocument.created_at.desc(), AssetStockDocument.id.desc())
        .limit(limit)
        .all()
    )


def load_asset_master_data():
    warehouses = _query_asset_warehouses()
    partners = _query_asset_partners()
    items = _query_asset_items()
    return {
        "warehouses": [serialize_warehouse(warehouse) for warehouse in warehouses],
        "partners": [serialize_partner(partner) for partner in partners],
        "items": [serialize_item(item) for item in items],
    }


def load_asset_inventory_data():
    warehouses = _query_asset_warehouses()
    inventories = _query_asset_inventory()
    return {
        "warehouses": [serialize_warehouse(warehouse) for warehouse in warehouses],
        "inventory": [serialize_inventory_row(inventory) for inventory in inventories],
    }


def load_asset_documents_data(limit=30):
    warehouses = _query_asset_warehouses()
    items = _query_asset_items()
    documents = _query_asset_documents(limit=limit, include_lines=True, include_movements=False)
    return {
        "warehouses": [serialize_warehouse(warehouse) for warehouse in warehouses],
        "items": [serialize_item(item) for item in items],
        "documents": [
            serialize_stock_document(document, include_children=True, include_lines=True, include_movements=False)
            for document in documents
        ],
    }


def load_asset_movements_data(limit=30):
    documents = _query_asset_documents(limit=limit, include_lines=False, include_movements=True)
    return {
        "documents": [
            serialize_stock_document(document, include_children=True, include_lines=False, include_movements=True)
            for document in documents
        ],
    }


def load_asset_dashboard():
    warehouses = _query_asset_warehouses()
    partners = _query_asset_partners()
    items = _query_asset_items()
    inventories = _query_asset_inventory()
    documents = _query_asset_documents(limit=30, include_lines=True, include_movements=True)

    metrics = {
        "warehouse_count": len(warehouses),
        "item_count": len(items),
        "sub_item_count": sum(len(item.sub_items or []) for item in items),
        "inventory_unit_count": sum(int(inventory.quantity or 0) for inventory in inventories),
        "draft_document_count": sum(1 for document in documents if document.status == "draft"),
    }

    return {
        "metrics": metrics,
        "warehouses": [serialize_warehouse(warehouse) for warehouse in warehouses],
        "partners": [serialize_partner(partner) for partner in partners],
        "items": [serialize_item(item) for item in items],
        "inventory": [serialize_inventory_row(inventory) for inventory in inventories],
        "documents": [serialize_stock_document(document, include_children=True) for document in documents],
    }


def list_asset_partners():
    partners = _query_asset_partners()
    return [serialize_partner(partner) for partner in partners]


def create_warehouse(payload, user):
    name = _require_text(payload.get("name"), "仓库名称")
    code = _normalize_code_or_none(payload.get("code")) or _generate_next_warehouse_code()
    location = _clean_text(payload.get("location"))
    remark = _clean_text(payload.get("remark"))
    manager_user_id = _optional_int(payload.get("manager_user_id"), "负责人")

    if AssetWarehouse.query.filter(db.func.lower(AssetWarehouse.name) == name.lower()).first():
        raise ValidationError("仓库名称已存在")
    if AssetWarehouse.query.filter(db.func.lower(AssetWarehouse.code) == code.lower()).first():
        raise ValidationError("仓库编号已存在")

    if manager_user_id is not None:
        from models.user_data import User

        if not User.query.get(manager_user_id):
            raise ValidationError("负责人不存在")

    warehouse = AssetWarehouse(
        name=name,
        code=code,
        location=location,
        remark=remark,
        manager_user_id=manager_user_id,
    )
    db.session.add(warehouse)
    db.session.commit()
    return warehouse


def update_warehouse(warehouse_id, payload, user):
    del user
    warehouse = _get_warehouse_or_raise(warehouse_id)
    name = _require_text(payload.get("name"), "仓库名称")
    code = _normalize_code_or_none(payload.get("code")) or warehouse.code
    location = _clean_text(payload.get("location"))
    remark = _clean_text(payload.get("remark"))
    manager_user_id = _optional_int(payload.get("manager_user_id"), "负责人")

    duplicate_name = AssetWarehouse.query.filter(
        db.func.lower(AssetWarehouse.name) == name.lower(),
        AssetWarehouse.id != warehouse.id,
    ).first()
    if duplicate_name:
        raise ValidationError("仓库名称已存在")

    duplicate_code = AssetWarehouse.query.filter(
        db.func.lower(AssetWarehouse.code) == code.lower(),
        AssetWarehouse.id != warehouse.id,
    ).first()
    if duplicate_code:
        raise ValidationError("仓库编号已存在")

    if manager_user_id is not None:
        from models.user_data import User

        if not User.query.get(manager_user_id):
            raise ValidationError("负责人不存在")

    warehouse.name = name
    warehouse.code = code
    warehouse.location = location
    warehouse.remark = remark
    warehouse.manager_user_id = manager_user_id
    warehouse.updated_at = datetime.utcnow()
    db.session.commit()
    return _get_warehouse_or_raise(warehouse.id)


def delete_warehouse(warehouse_id, user):
    del user
    warehouse = _get_warehouse_or_raise(warehouse_id)

    if AssetInventory.query.filter_by(warehouse_id=warehouse.id).first():
        raise ValidationError("仓库已有库存记录，不能删除")
    if AssetStockMovement.query.filter_by(warehouse_id=warehouse.id).first():
        raise ValidationError("仓库已经出现在库存流水中，不能删除")
    if AssetStockDocument.query.filter(
        or_(
            AssetStockDocument.source_warehouse_id == warehouse.id,
            AssetStockDocument.target_warehouse_id == warehouse.id,
        )
    ).first():
        raise ValidationError("仓库已经出现在库存单据中，不能删除")

    db.session.delete(warehouse)
    db.session.commit()


def create_partner(payload, user):
    del user
    name = _require_text(payload.get("name"), "往来对象名称")
    code = _require_text(payload.get("code"), "往来对象编号").upper()
    partner_type = _require_partner_type(payload.get("partner_type"))
    contact_person = _clean_text(payload.get("contact_person"))
    phone = _clean_text(payload.get("phone"))
    address = _clean_text(payload.get("address"))
    status = _clean_text(payload.get("status")) or "active"
    remark = _clean_text(payload.get("remark"))

    if AssetPartner.query.filter(db.func.lower(AssetPartner.code) == code.lower()).first():
        raise ValidationError("往来对象编号已存在")

    partner = AssetPartner(
        name=name,
        code=code,
        partner_type=partner_type,
        contact_person=contact_person,
        phone=phone,
        address=address,
        status=status,
        remark=remark,
    )
    db.session.add(partner)
    db.session.commit()
    return partner


def update_partner(partner_id, payload, user):
    del user
    partner = _get_partner_or_raise(partner_id)
    name = _require_text(payload.get("name"), "往来对象名称")
    code = _require_text(payload.get("code"), "往来对象编号").upper()
    partner_type = _require_partner_type(payload.get("partner_type"))
    contact_person = _clean_text(payload.get("contact_person"))
    phone = _clean_text(payload.get("phone"))
    address = _clean_text(payload.get("address"))
    status = _clean_text(payload.get("status")) or "active"
    remark = _clean_text(payload.get("remark"))

    duplicate_code = AssetPartner.query.filter(
        db.func.lower(AssetPartner.code) == code.lower(),
        AssetPartner.id != partner.id,
    ).first()
    if duplicate_code:
        raise ValidationError("往来对象编号已存在")

    partner.name = name
    partner.code = code
    partner.partner_type = partner_type
    partner.contact_person = contact_person
    partner.phone = phone
    partner.address = address
    partner.status = status
    partner.remark = remark
    partner.updated_at = datetime.utcnow()
    db.session.commit()
    return _get_partner_or_raise(partner.id)


def delete_partner(partner_id, user):
    del user
    partner = _get_partner_or_raise(partner_id)
    if AssetStockDocument.query.filter_by(counterparty_id=partner.id).first():
        raise ValidationError("往来对象已被库存单据引用，不能删除")

    db.session.delete(partner)
    db.session.commit()


def create_item(payload, user):
    del user
    name = _require_text(payload.get("name"), "item 名称")
    code = _normalize_code_or_none(payload.get("code")) or _generate_next_item_code()
    category = _clean_text(payload.get("category"))
    unit = _clean_text(payload.get("unit")) or "件"
    status = _clean_text(payload.get("status")) or "active"
    remark = _clean_text(payload.get("remark"))

    if AssetItem.query.filter(db.func.lower(AssetItem.code) == code.lower()).first():
        raise ValidationError("item 编码已存在")

    item = AssetItem(
        name=name,
        code=code,
        category=category,
        unit=unit,
        status=status,
        remark=remark,
    )
    db.session.add(item)
    db.session.commit()
    return item


def update_item(item_id, payload, user):
    del user
    item = _get_item_or_raise(item_id)
    name = _require_text(payload.get("name"), "item 名称")
    code = _normalize_code_or_none(payload.get("code")) or item.code
    category = _clean_text(payload.get("category"))
    unit = _clean_text(payload.get("unit")) or "件"
    status = _clean_text(payload.get("status")) or "active"
    remark = _clean_text(payload.get("remark"))

    duplicate_code = AssetItem.query.filter(
        db.func.lower(AssetItem.code) == code.lower(),
        AssetItem.id != item.id,
    ).first()
    if duplicate_code:
        raise ValidationError("item 编码已存在")

    item.name = name
    item.code = code
    item.category = category
    item.unit = unit
    item.status = status
    item.remark = remark
    item.updated_at = datetime.utcnow()
    db.session.commit()
    return _get_item_or_raise(item.id)


def delete_item(item_id, user):
    del user
    item = _get_item_or_raise(item_id)
    if item.sub_items:
        raise ValidationError("请先删除这个 Item 下的全部子 Item")

    db.session.delete(item)
    db.session.commit()


def create_sub_item(item_id, payload, user):
    del user
    item = _get_item_or_raise(item_id)
    name = _require_text(payload.get("name"), "子 item 名称")
    sku = _clean_text(payload.get("sku"))
    size = _clean_text(payload.get("size"))
    color = _clean_text(payload.get("color"))
    barcode = _clean_text(payload.get("barcode"))
    status = _clean_text(payload.get("status")) or "active"
    remark = _clean_text(payload.get("remark"))

    if sku and AssetSubItem.query.filter(db.func.lower(AssetSubItem.sku) == sku.lower()).first():
        raise ValidationError("SKU 已存在")
    if barcode and AssetSubItem.query.filter(db.func.lower(AssetSubItem.barcode) == barcode.lower()).first():
        raise ValidationError("条码已存在")

    sub_item = AssetSubItem(
        item_id=item.id,
        name=name,
        sku=sku,
        size=size,
        color=color,
        barcode=barcode,
        status=status,
        remark=remark,
    )
    db.session.add(sub_item)
    db.session.commit()
    return sub_item


def update_sub_item(sub_item_id, payload, user):
    del user
    sub_item = _get_sub_item_or_raise(sub_item_id)
    item_id = _optional_int(payload.get("item_id"), "item")
    if item_id is None:
        item_id = sub_item.item_id
    else:
        _get_item_or_raise(item_id)

    name = _require_text(payload.get("name"), "子 item 名称")
    sku = _clean_text(payload.get("sku"))
    size = _clean_text(payload.get("size"))
    color = _clean_text(payload.get("color"))
    barcode = _clean_text(payload.get("barcode"))
    status = _clean_text(payload.get("status")) or "active"
    remark = _clean_text(payload.get("remark"))

    if sku:
        duplicate_sku = AssetSubItem.query.filter(
            db.func.lower(AssetSubItem.sku) == sku.lower(),
            AssetSubItem.id != sub_item.id,
        ).first()
        if duplicate_sku:
            raise ValidationError("SKU 已存在")
    if barcode:
        duplicate_barcode = AssetSubItem.query.filter(
            db.func.lower(AssetSubItem.barcode) == barcode.lower(),
            AssetSubItem.id != sub_item.id,
        ).first()
        if duplicate_barcode:
            raise ValidationError("条码已存在")

    sub_item.item_id = item_id
    sub_item.name = name
    sub_item.sku = sku
    sub_item.size = size
    sub_item.color = color
    sub_item.barcode = barcode
    sub_item.status = status
    sub_item.remark = remark
    sub_item.updated_at = datetime.utcnow()
    db.session.commit()
    return _get_sub_item_or_raise(sub_item.id)


def delete_sub_item(sub_item_id, user):
    del user
    sub_item = _get_sub_item_or_raise(sub_item_id)

    if AssetInventory.query.filter_by(sub_item_id=sub_item.id).first():
        raise ValidationError("子 Item 已有库存记录，不能删除")
    if AssetStockMovement.query.filter_by(sub_item_id=sub_item.id).first():
        raise ValidationError("子 Item 已出现在库存流水中，不能删除")
    if AssetStockDocumentLine.query.filter_by(sub_item_id=sub_item.id).first():
        raise ValidationError("子 Item 已出现在库存单据中，不能删除")

    db.session.delete(sub_item)
    db.session.commit()


def update_inventory_threshold(inventory_id, payload, user):
    del user
    inventory = _get_inventory_or_raise(inventory_id)
    inventory.min_quantity = _require_non_negative_int(payload.get("min_quantity"), "最低库存")
    inventory.updated_at = datetime.utcnow()
    db.session.commit()
    return _get_inventory_or_raise(inventory.id)


def upload_document_invoice(document_id, uploaded_file, user):
    del user
    document = _get_document_or_raise(document_id)
    if not (uploaded_file and uploaded_file.filename):
        raise ValidationError("请选择要上传的 invoice 文件")

    filename, extension = _normalize_upload_name(uploaded_file.filename, uploaded_file.mimetype)
    os.makedirs(ASSET_INVOICE_DIR, exist_ok=True)

    old_path = str(document.invoice_file_path or "").strip() or None
    safe_stem = Path(filename).stem or f"document_{document.id}"
    new_filename = f"asset_document_{document.id}_{uuid.uuid4().hex[:8]}_{safe_stem}{extension}"
    save_path = ASSET_INVOICE_DIR / new_filename
    short_path = os.path.join("NAS", "UTBA", "asset_invoice", new_filename)

    uploaded_file.save(save_path)
    document.invoice_file_path = short_path
    if not document.invoice_type:
        document.invoice_type = (uploaded_file.mimetype or "").strip() or None
    document.updated_at = datetime.utcnow()
    db.session.commit()

    if old_path and old_path != short_path:
        _delete_relative_data_file(old_path)

    return _get_document_or_raise(document.id)


def _normalize_document_lines(lines_payload, document_type):
    if not isinstance(lines_payload, list) or not lines_payload:
        raise ValidationError("至少需要一条库存明细")

    normalized_lines = []
    for index, line_payload in enumerate(lines_payload, start=1):
        sub_item_id = _optional_int(line_payload.get("sub_item_id"), f"第 {index} 行子 item")
        if sub_item_id is None:
            raise ValidationError(f"第 {index} 行缺少子 item")
        _get_sub_item_or_raise(sub_item_id)

        quantity = (
            _require_nonzero_int(line_payload.get("quantity"), f"第 {index} 行数量")
            if document_type == "adjust"
            else _require_positive_int(line_payload.get("quantity"), f"第 {index} 行数量")
        )
        unit_cost = _optional_money(line_payload.get("unit_cost"), f"第 {index} 行成本价")
        unit_price = _optional_money(line_payload.get("unit_price"), f"第 {index} 行单价")
        line_amount = _optional_money(line_payload.get("line_amount"), f"第 {index} 行金额")

        if line_amount is None:
            if unit_price is not None:
                line_amount = round(unit_price * quantity, 2)
            elif unit_cost is not None:
                line_amount = round(unit_cost * quantity, 2)

        normalized_lines.append(
            {
                "sub_item_id": sub_item_id,
                "quantity": quantity,
                "unit_cost": unit_cost,
                "unit_price": unit_price,
                "line_amount": line_amount,
                "remark": _clean_text(line_payload.get("remark")),
            }
        )
    return normalized_lines


def _validate_document_payload(payload, user, existing_document=None):
    document_type = _require_document_type(payload.get("document_type"))
    source_warehouse_id = _optional_int(payload.get("source_warehouse_id"), "来源仓库")
    target_warehouse_id = _optional_int(payload.get("target_warehouse_id"), "目标仓库")
    requester_user_id = _optional_int(payload.get("requester_user_id"), "申请人")
    handler_user_id = _optional_int(payload.get("handler_user_id"), "经手人")
    taken_by_user_id = _optional_int(payload.get("taken_by_user_id"), "领用人")
    counterparty_id = _optional_int(payload.get("counterparty_id"), "往来对象")
    event_id = _optional_int(payload.get("event_id"), "活动")
    reference_id = _optional_int(payload.get("reference_id"), "引用编号")
    reference_type = _clean_text(payload.get("reference_type"))

    if document_type == "transfer":
        if source_warehouse_id is None or target_warehouse_id is None:
            raise ValidationError("调拨单必须同时选择来源仓库和目标仓库")
        if source_warehouse_id == target_warehouse_id:
            raise ValidationError("来源仓库和目标仓库不能相同")
    elif document_type in INBOUND_DOCUMENT_TYPES:
        if target_warehouse_id is None:
            raise ValidationError("入库单必须选择目标仓库")
    elif document_type in OUTBOUND_DOCUMENT_TYPES:
        if source_warehouse_id is None:
            raise ValidationError("出库单必须选择来源仓库")
    elif document_type == "adjust":
        if source_warehouse_id is None:
            raise ValidationError("盘点调整必须选择仓库")

    if source_warehouse_id is not None:
        _get_warehouse_or_raise(source_warehouse_id)
    if target_warehouse_id is not None:
        _get_warehouse_or_raise(target_warehouse_id)
    counterparty = _get_partner_or_raise(counterparty_id) if counterparty_id is not None else None

    if reference_type:
        if reference_type not in REFERENCE_TYPES:
            raise ValidationError("reference_type 不合法")
        if reference_id is None:
            raise ValidationError("缺少引用单号")
        if reference_type == "reimbursement_request":
            _get_reimbursement_request_or_raise(reference_id)
    elif reference_id is not None:
        raise ValidationError("reference_type 不能为空")

    normalized_lines = _normalize_document_lines(payload.get("lines") or [], document_type)
    existing_invoice_path = getattr(existing_document, "invoice_file_path", None) if existing_document else None
    counterparty_name = _clean_text(payload.get("counterparty_name")) or getattr(counterparty, "name", None)
    invoice_no = _clean_text(payload.get("invoice_no"))

    if document_type not in {"purchase_in", "sale_out", "sale_return"}:
        invoice_no = None
        reference_type = None
        reference_id = None
    elif reference_type == "reimbursement_request" and reference_id is not None:
        invoice_no = invoice_no or str(reference_id)

    return {
        "document_type": document_type,
        "source_warehouse_id": source_warehouse_id,
        "target_warehouse_id": target_warehouse_id,
        "requester_user_id": requester_user_id or getattr(existing_document, "requester_user_id", None) or getattr(user, "id", None),
        "handler_user_id": handler_user_id,
        "taken_by_user_id": taken_by_user_id,
        "taken_by_name": _clean_text(payload.get("taken_by_name")),
        "destination_type": _clean_text(payload.get("destination_type")),
        "destination_text": _clean_text(payload.get("destination_text")),
        "counterparty_id": counterparty_id,
        "counterparty_name": counterparty_name,
        "event_id": event_id,
        "invoice_no": invoice_no,
        "invoice_type": _clean_text(payload.get("invoice_type")),
        "invoice_file_path": _clean_text(payload.get("invoice_file_path")) if "invoice_file_path" in payload else existing_invoice_path,
        "reference_type": reference_type,
        "reference_id": reference_id,
        "note": _clean_text(payload.get("note")),
        "lines": normalized_lines,
    }


def _apply_document_fields(document, normalized_payload):
    document.document_type = normalized_payload["document_type"]
    document.source_warehouse_id = normalized_payload["source_warehouse_id"]
    document.target_warehouse_id = normalized_payload["target_warehouse_id"]
    document.requester_user_id = normalized_payload["requester_user_id"]
    document.handler_user_id = normalized_payload["handler_user_id"]
    document.taken_by_user_id = normalized_payload["taken_by_user_id"]
    document.taken_by_name = normalized_payload["taken_by_name"]
    document.destination_type = normalized_payload["destination_type"]
    document.destination_text = normalized_payload["destination_text"]
    document.counterparty_id = normalized_payload["counterparty_id"]
    document.counterparty_name = normalized_payload["counterparty_name"]
    document.event_id = normalized_payload["event_id"]
    document.invoice_no = normalized_payload["invoice_no"]
    document.invoice_type = normalized_payload["invoice_type"]
    document.invoice_file_path = normalized_payload["invoice_file_path"]
    document.reference_type = normalized_payload["reference_type"]
    document.reference_id = normalized_payload["reference_id"]
    document.note = normalized_payload["note"]
    document.updated_at = datetime.utcnow()


def _replace_document_lines(document, normalized_lines):
    document.lines.clear()
    db.session.flush()
    for line_payload in normalized_lines:
        document.lines.append(
            AssetStockDocumentLine(
                sub_item_id=line_payload["sub_item_id"],
                quantity=line_payload["quantity"],
                unit_cost=line_payload["unit_cost"],
                unit_price=line_payload["unit_price"],
                line_amount=line_payload["line_amount"],
                remark=line_payload["remark"],
            )
        )


def create_stock_document(payload, user):
    normalized_payload = _validate_document_payload(payload, user)

    document = AssetStockDocument(
        document_no=_generate_document_no(),
        status="draft",
        created_by=getattr(user, "id", None),
    )
    _apply_document_fields(document, normalized_payload)
    db.session.add(document)
    db.session.flush()
    _replace_document_lines(document, normalized_payload["lines"])

    db.session.commit()
    return _get_document_or_raise(document.id)


def update_stock_document(document_id, payload, user):
    document = _get_document_or_raise(document_id)
    if document.status != "draft":
        raise ValidationError("只有 draft 单据才能编辑")

    normalized_payload = _validate_document_payload(payload, user, existing_document=document)
    _apply_document_fields(document, normalized_payload)
    _replace_document_lines(document, normalized_payload["lines"])
    db.session.commit()
    return _get_document_or_raise(document.id)


def delete_stock_document(document_id, user):
    del user
    document = _get_document_or_raise(document_id)
    if document.status != "draft":
        raise ValidationError("只有 draft 单据才能删除")

    invoice_path = document.invoice_file_path
    db.session.delete(document)
    db.session.commit()
    if invoice_path:
        _delete_relative_data_file(invoice_path)


def cancel_stock_document(document_id, user):
    document = _get_document_or_raise(document_id)
    if document.status == "cancelled":
        raise ValidationError("该单据已经作废")

    if document.status == "draft":
        document.status = "cancelled"
        document.approved_by = getattr(user, "id", None)
        document.updated_at = datetime.utcnow()
        db.session.commit()
        return _get_document_or_raise(document.id)

    if document.status != "confirmed":
        raise ValidationError("只有 draft 或 confirmed 单据才能作废")

    ordered_movements = sorted(document.movements or [], key=lambda row: row.id or 0, reverse=True)
    for movement in ordered_movements:
        inventory = _get_or_create_inventory(movement.warehouse_id, movement.sub_item_id)
        before = int(inventory.quantity or 0)
        quantity_delta = -int(movement.quantity_delta or 0)
        after = before + quantity_delta
        if after < 0:
            raise ValidationError("库存回滚失败，当前库存状态异常")
        inventory.quantity = after
        inventory.updated_at = datetime.utcnow()
        db.session.add(
            AssetStockMovement(
                document_id=document.id,
                document_line_id=movement.document_line_id,
                warehouse_id=movement.warehouse_id,
                sub_item_id=movement.sub_item_id,
                movement_type="cancel",
                quantity_delta=quantity_delta,
                quantity_before=before,
                quantity_after=after,
                taken_by_user_id=document.taken_by_user_id,
                destination_text=document.destination_text,
                invoice_no=document.invoice_no,
                created_by=getattr(user, "id", None),
            )
        )

    document.status = "cancelled"
    document.approved_by = getattr(user, "id", None)
    document.updated_at = datetime.utcnow()
    db.session.commit()
    return _get_document_or_raise(document.id)


def confirm_stock_document(document_id, user):
    document = _get_document_or_raise(document_id)
    if document.status != "draft":
        raise ValidationError("只有 draft 单据才能确认")

    for line in document.lines:
        quantity = int(line.quantity or 0)
        if document.document_type in INBOUND_DOCUMENT_TYPES:
            _create_movement(document, line, document.target_warehouse_id, document.document_type, quantity, user)
        elif document.document_type in OUTBOUND_DOCUMENT_TYPES:
            _create_movement(document, line, document.source_warehouse_id, document.document_type, -quantity, user)
        elif document.document_type == "transfer":
            _create_movement(document, line, document.source_warehouse_id, "transfer_out", -quantity, user)
            _create_movement(document, line, document.target_warehouse_id, "transfer_in", quantity, user)
        elif document.document_type == "adjust":
            _create_movement(document, line, document.source_warehouse_id, "adjust", quantity, user)
        else:
            raise ValidationError("暂不支持该单据类型的确认")

    document.status = "confirmed"
    document.approved_by = getattr(user, "id", None)
    document.confirmed_at = datetime.utcnow()
    document.updated_at = datetime.utcnow()
    db.session.commit()
    return _get_document_or_raise(document.id)
