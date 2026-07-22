from __future__ import annotations

from datetime import datetime

from flask_login import current_user
from sqlalchemy import func, or_, text
from sqlalchemy.orm import selectinload

from .services import (
    get_available_versions,
    get_order_detail as get_order_detail_response,
    serialize_order,
    serialize_print_pdf,
    user_can_view_order,
)
from .shared import active_order_version, normalize_version
from models import db
from models.fahui import (
    FahuiBoardData,
    FahuiBoardHeader,
    FahuiItemFormData,
    FahuiOrder,
    FahuiOrderItem,
    FahuiPdfPageData,
    FahuiPrintPdf,
)


PRICE_MAP = {
    "A1": 100,
    "A2": 100,
    "A3": 100,
    "B1": 35,
    "B2": 35,
    "B3": 35,
    "C": 15,
    "D1": 50,
}


def _is_logged_in() -> bool:
    return bool(current_user and current_user.is_authenticated)


def _board_owner_or_deceased(item: FahuiOrderItem) -> str | None:
    owner_value = None
    deceased_value = None
    for field in item.form_data or []:
        if field.field_name == "owner" and field.field_value:
            owner_value = field.field_value
            break
    if owner_value:
        return owner_value

    for field in item.form_data or []:
        if field.field_name == "deceased" and field.field_value:
            deceased_value = field.field_value
            break
    return deceased_value


def _get_all_boards_with_orders(version: str | None = None) -> list[dict]:
    query = (
        db.session.query(FahuiBoardHeader)
        .options(
            selectinload(FahuiBoardHeader.board_entries)
            .selectinload(FahuiBoardData.print_pdf)
            .selectinload(FahuiPrintPdf.pages)
            .selectinload(FahuiPdfPageData.order_item)
            .selectinload(FahuiOrderItem.order),
            selectinload(FahuiBoardHeader.board_entries)
            .selectinload(FahuiBoardData.print_pdf)
            .selectinload(FahuiPrintPdf.pages)
            .selectinload(FahuiPdfPageData.order_item)
            .selectinload(FahuiOrderItem.form_data),
        )
        .order_by(FahuiBoardHeader.id.asc())
    )
    if version:
        query = query.filter(FahuiBoardHeader.version == version)
    headers = query.all()

    result = []
    for header in headers:
        grouped = []
        entries = sorted(
            header.board_entries or [],
            key=lambda entry: ((entry.location or 0), entry.id or 0),
        )
        for board_entry in entries:
            order_seen = set()
            order_list = []
            pdf = board_entry.print_pdf
            if pdf:
                for page in pdf.pages or []:
                    item = page.order_item
                    order = item.order if item else None
                    if not order or order.id in order_seen:
                        continue

                    order_seen.add(order.id)
                    order_list.append(
                        {
                            "order_item_id": item.id if item else None,
                            "order_id": order.id,
                            "customer_name": order.customer_name,
                            "owner_or_deceased": _board_owner_or_deceased(item),
                        }
                    )

            grouped.append(
                {
                    "width": pdf.width if pdf else None,
                    "height": pdf.height if pdf else None,
                    "print_pdf_id": board_entry.print_pdf_id,
                    "side_id": board_entry.id,
                    "location": board_entry.location,
                    "orders": order_list,
                }
            )

        result.append(
            {
                "board_id": header.id,
                "board_name": header.board_name,
                "board_width": header.board_width,
                "board_height": header.board_height,
                "version": header.version,
                "board_data": grouped,
            }
        )

    return result


def _coerce_int(value):
    if value in ("", None):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _require_order_access(order: FahuiOrder | None):
    if not order:
        return {"success": False, "message": "Order not found"}, 404
    if not user_can_view_order(order):
        return {"success": False, "message": "未登录或没有权限操作此订单"}, 403
    return None


def default_item_price(code: str | None) -> int:
    return PRICE_MAP.get(code or "", 0)


def get_print_pdf_data(pdf_id: int) -> tuple[dict, int]:
    pdf = FahuiPrintPdf.query.get(pdf_id)
    if not pdf:
        return {"status": "error", "message": f"PrintPDF {pdf_id} 不存在"}, 404
    return {"status": "success", "data": serialize_print_pdf(pdf)}, 200


def delete_board_entry(board_data_id: int) -> tuple[dict, int]:
    board_entry = FahuiBoardData.query.get(board_data_id)
    if not board_entry:
        return {"status": "error", "message": f"BoardData {board_data_id} not found"}, 404

    db.session.delete(board_entry)
    db.session.commit()
    return {
        "status": "success",
        "message": f"BoardData {board_data_id} deleted successfully",
        "all_board": _get_all_boards_with_orders(),
    }, 200


def list_all_boards(version: str | None = None) -> dict:
    return {"all_board": _get_all_boards_with_orders(version)}


def create_board(data: dict) -> tuple[dict, int]:
    """新建一块空的大板（board_header），归属某个版本（年份）。"""
    name = (data.get("board_name") or "").strip()
    version = (data.get("version") or "").strip() or None
    header = FahuiBoardHeader(
        board_name=name or "未命名板",
        board_width=_coerce_int(data.get("board_width")),
        board_height=_coerce_int(data.get("board_height")),
        version=version,
    )
    db.session.add(header)
    db.session.commit()
    return {
        "success": True,
        "board_id": header.id,
        "board_name": header.board_name,
        "all_board": _get_all_boards_with_orders(version),
    }, 200


def update_board(board_id: int, data: dict) -> tuple[dict, int]:
    """改大板名字/尺寸。"""
    header = FahuiBoardHeader.query.get(board_id)
    if not header:
        return {"error": f"board_id={board_id} 不存在"}, 404
    if "board_name" in data:
        name = (data.get("board_name") or "").strip()
        if name:
            header.board_name = name
    if data.get("board_width") is not None:
        header.board_width = _coerce_int(data.get("board_width"))
    if data.get("board_height") is not None:
        header.board_height = _coerce_int(data.get("board_height"))
    db.session.commit()
    return {"success": True, "all_board": _get_all_boards_with_orders()}, 200


def delete_board_header(board_id: int) -> tuple[dict, int]:
    """删除整块大板（连同板上所有位置 board_data；print_pdf 本身保留，只是解除贴板）。"""
    header = FahuiBoardHeader.query.get(board_id)
    if not header:
        return {"error": f"board_id={board_id} 不存在"}, 404
    ver = header.version
    db.session.delete(header)  # FK ondelete=CASCADE + passive_deletes 自动清 board_data
    db.session.commit()
    return {
        "success": True,
        "message": f"board {board_id} 已删除",
        "all_board": _get_all_boards_with_orders(ver),
    }, 200


def reset_year_barcodes(version: str | None) -> tuple[dict, int]:
    """重置某年份的条码/二维码：删除该版本订单的所有 print_pdf（连带板上摆放）。
    只允许重置「当前年份」，往年不可重置。"""
    version = (version or "").strip()
    if not version:
        return {"error": "缺少 version"}, 400
    current = active_order_version()
    if version != current:
        return {"error": f"只能重置当前年份（{current}）的条码，{version} 不可重置"}, 400

    pdf_ids = [
        pid
        for (pid,) in (
            db.session.query(FahuiPdfPageData.print_pdf_id)
            .join(FahuiOrderItem, FahuiPdfPageData.order_item_id == FahuiOrderItem.id)
            .join(FahuiOrder, FahuiOrderItem.order_id == FahuiOrder.id)
            .filter(FahuiOrder.version == version)
            .distinct()
            .all()
        )
        if pid is not None
    ]

    removed = 0
    if pdf_ids:
        # 先删板上摆放（board_data），再删 print_pdf（DB 级联清 pdf_page_data）
        FahuiBoardData.query.filter(FahuiBoardData.print_pdf_id.in_(pdf_ids)).delete(synchronize_session=False)
        removed = FahuiPrintPdf.query.filter(FahuiPrintPdf.id.in_(pdf_ids)).delete(synchronize_session=False)
    db.session.commit()
    return {
        "success": True,
        "message": f"已重置 {version} 的条码（清除 {removed} 张）",
        "all_board": _get_all_boards_with_orders(version),
    }, 200


def reorder_board_entry(data: dict) -> tuple[dict, int]:
    board_id = _coerce_int(data.get("board_id"))
    pdf_id = _coerce_int(data.get("pdf_id"))
    location = _coerce_int(data.get("location"))
    if not board_id or not pdf_id or not location:
        return {"error": "board_id, pdf_id, location 都不能为空"}, 400

    entry = FahuiBoardData.query.filter_by(print_pdf_id=pdf_id, board_id=board_id).first()
    if not entry:
        return {"error": f"pdf_id={pdf_id} 不存在于 board_id={board_id}"}, 400

    old_location = entry.location
    if old_location == location:
        return {"success": True, "message": "位置未改变"}, 200

    if old_location is None:
        entry.location = location
    elif old_location < location:
        (
            FahuiBoardData.query.filter(
                FahuiBoardData.board_id == board_id,
                FahuiBoardData.location > old_location,
                FahuiBoardData.location <= location,
            ).update(
                {FahuiBoardData.location: FahuiBoardData.location - 1},
                synchronize_session=False,
            )
        )
        entry.location = location
    else:
        (
            FahuiBoardData.query.filter(
                FahuiBoardData.board_id == board_id,
                FahuiBoardData.location >= location,
                FahuiBoardData.location < old_location,
            ).update(
                {FahuiBoardData.location: FahuiBoardData.location + 1},
                synchronize_session=False,
            )
        )
        entry.location = location

    db.session.commit()
    return {
        "success": True,
        "board_id": board_id,
        "pdf_id": pdf_id,
        "location": location,
        "all_board": _get_all_boards_with_orders(),
    }, 200


def attach_pdf_to_board(data: dict) -> tuple[dict, int]:
    board_id = _coerce_int(data.get("board_id"))
    pdf_id_raw = data.get("pdf_id")
    board_name = (data.get("board_name") or "").strip()
    board_width = _coerce_int(data.get("board_width"))
    board_height = _coerce_int(data.get("board_height"))
    if not board_id:
        return {"error": "board_id 不能为空"}, 400

    if pdf_id_raw in ("none", "", None):
        pdf_id = None
    else:
        pdf_id = _coerce_int(pdf_id_raw)
        if pdf_id is None:
            return {"error": "pdf_id 必须是整数或 none"}, 400

    if pdf_id:
        pdf = FahuiPrintPdf.query.get(pdf_id)
        if not pdf:
            return {"error": f"print_pdf_id={pdf_id} 不存在"}, 400

        existing = FahuiBoardData.query.filter_by(print_pdf_id=pdf_id).first()
        if existing:
            return {"error": f"pdf_id={pdf_id} 已经绑定在 board_id={existing.board_id} 上"}, 400

    header = FahuiBoardHeader.query.get(board_id)
    if not header:
        header = FahuiBoardHeader(
            id=board_id,
            board_name=board_name or f"board_{board_id}",
            board_width=board_width,
            board_height=board_height,
        )
        db.session.add(header)
        db.session.flush()
    else:
        if board_width is not None:
            header.board_width = board_width
        if board_height is not None:
            header.board_height = board_height
        if board_name:
            header.board_name = board_name

    board_entry = None
    if pdf_id:
        board_entry = FahuiBoardData.query.filter_by(board_id=header.id, print_pdf_id=None).first()
        if board_entry:
            board_entry.print_pdf_id = pdf_id
        else:
            last_location = (
                db.session.query(func.max(FahuiBoardData.location))
                .filter_by(board_id=header.id)
                .scalar()
                or 0
            )
            board_entry = FahuiBoardData(
                board_id=header.id,
                print_pdf_id=pdf_id,
                location=last_location + 1,
            )
            db.session.add(board_entry)

    db.session.commit()
    return {
        "side_id": board_entry.id if board_entry else None,
        "pdf_id": pdf_id,
        "pdf_data": [],
        "all_board": _get_all_boards_with_orders(),
    }, 200


def clear_print_pdf_records() -> tuple[dict, int]:
    db.session.query(FahuiBoardData).update(
        {FahuiBoardData.print_pdf_id: None},
        synchronize_session=False,
    )
    db.session.commit()
    db.session.query(FahuiPdfPageData).delete()
    db.session.commit()
    db.session.query(FahuiPrintPdf).delete()
    db.session.commit()

    for table_name in ("pdf_page_data", "print_pdf"):
        try:
            db.session.execute(text(f"ALTER TABLE {table_name} AUTO_INCREMENT = 1"))
            db.session.commit()
        except Exception:
            db.session.rollback()

    return {"success": True, "message": "Tables cleared and IDs reset"}, 200


def list_print_pdf_records() -> list[dict]:
    records = FahuiPrintPdf.query.order_by(FahuiPrintPdf.created_at.desc()).all()
    return [serialize_print_pdf(record) for record in records]


def list_versions() -> list[str]:
    return get_available_versions()


def list_orders_by_version(version: str) -> list[dict]:
    normalized_version = normalize_version(version) or version or active_order_version()
    orders = (
        FahuiOrder.query.options(
            selectinload(FahuiOrder.items).selectinload(FahuiOrderItem.form_data),
            selectinload(FahuiOrder.payments),
        )
        .filter(FahuiOrder.version == normalized_version)
        .order_by(FahuiOrder.created_at.desc(), FahuiOrder.id.desc())
        .all()
    )
    return [serialize_order(order) for order in orders]


def update_order_customer(order_id: int, data: dict) -> tuple[dict, int]:
    order = FahuiOrder.query.get(order_id)
    denied = _require_order_access(order)
    if denied:
        return denied

    order.customer_name = data.get("customer_name", order.customer_name)
    order.email = data.get("email", order.email)

    new_phone = (data.get("phone") or "").strip()
    if new_phone and new_phone != (order.phone or "").strip():
        if _is_logged_in():
            order.phone = new_phone
        else:
            return {"success": False, "message": "未登录用户无法修改手机号"}, 403

    db.session.commit()
    return {"success": True, "message": "Customer info updated"}, 200


def update_order_status(order_id: int, data: dict) -> tuple[dict, int]:
    order = FahuiOrder.query.get(order_id)
    if not order:
        return {"success": False, "message": f"Order {order_id} not found"}, 404

    status = str(data.get("status") or "").strip()
    if not status:
        return {"success": False, "message": "缺少 status"}, 400

    order.status = status
    db.session.commit()
    return {"success": True, "message": "订单状态已更新", "status": order.status}, 200


def get_board_order_detail(order_id: int | None) -> tuple[dict, int]:
    if not order_id:
        return {"error": "Missing 'id' parameter"}, 400

    payload, status_code = get_order_detail_response(order_id)
    if status_code != 200:
        return payload, status_code
    return payload.get("data", {}), 200


def check_duplicate_owner_fields() -> list[int]:
    subquery = (
        db.session.query(
            FahuiItemFormData.item_id,
            func.count(FahuiItemFormData.id).label("owner_count"),
        )
        .filter(FahuiItemFormData.field_name == "owner")
        .group_by(FahuiItemFormData.item_id)
        .having(func.count(FahuiItemFormData.id) > 1)
        .subquery()
    )
    order_ids = (
        db.session.query(FahuiOrderItem.order_id)
        .join(subquery, FahuiOrderItem.id == subquery.c.item_id)
        .distinct()
        .all()
    )
    return [order_id for (order_id,) in order_ids]


def quick_search_orders(keyword: str | None) -> dict:
    keyword = (keyword or "").strip().lower()
    if not keyword:
        return {"success": True, "results": []}

    base_query = FahuiOrder.query.options(
        selectinload(FahuiOrder.items).selectinload(FahuiOrderItem.form_data),
        selectinload(FahuiOrder.payments),
    )

    orders = []
    if keyword.isdigit():
        order = base_query.filter_by(id=int(keyword)).first()
        if order:
            orders = [order]

        if not orders:
            order_item = (
                FahuiOrderItem.query.options(
                    selectinload(FahuiOrderItem.order)
                    .selectinload(FahuiOrder.items)
                    .selectinload(FahuiOrderItem.form_data),
                    selectinload(FahuiOrderItem.order).selectinload(FahuiOrder.payments),
                )
                .filter_by(id=int(keyword))
                .first()
            )
            if order_item and order_item.order:
                orders = [order_item.order]

        if not orders:
            orders = (
                base_query.filter(FahuiOrder.phone.like(f"%{keyword}%"))
                .order_by(FahuiOrder.created_at.desc())
                .limit(5)
                .all()
            )
    else:
        orders = (
            base_query.filter(
                or_(
                    FahuiOrder.customer_name.ilike(f"%{keyword}%"),
                    FahuiOrder.name.ilike(f"%{keyword}%"),
                    FahuiOrder.member_name.ilike(f"%{keyword}%"),
                )
            )
            .order_by(FahuiOrder.created_at.desc())
            .limit(5)
            .all()
        )

    if not orders:
        matched_item_ids = (
            db.session.query(FahuiItemFormData.item_id)
            .filter(FahuiItemFormData.field_value.ilike(f"%{keyword}%"))
            .limit(10)
            .all()
        )
        item_ids = [item_id for (item_id,) in matched_item_ids]
        if item_ids:
            order_ids = (
                db.session.query(FahuiOrderItem.order_id)
                .filter(FahuiOrderItem.id.in_(item_ids))
                .limit(10)
                .all()
            )
            flat_order_ids = [order_id for (order_id,) in order_ids]
            if flat_order_ids:
                top_ids = sorted(flat_order_ids, reverse=True)[:5]
                orders = base_query.filter(FahuiOrder.id.in_(top_ids)).all()
                orders.sort(key=lambda order: top_ids.index(order.id))

    results = []
    for order in orders:
        if order.version == "DELETE" and not _is_logged_in():
            continue
        results.append(serialize_order(order))
    return {"success": True, "results": results}


def _validate_item_payload(code: str, owner, deceased) -> str | None:
    """Return an error message when the item payload is invalid, else None."""
    if not code:
        return "缺少 form-group/code"

    has_valid_owner = isinstance(owner, list) and any((name or "").strip() for name in owner)
    if not has_valid_owner and isinstance(owner, str):
        has_valid_owner = bool(owner.strip())

    has_valid_deceased = False
    if isinstance(deceased, str) and deceased.strip():
        has_valid_deceased = True
    elif isinstance(deceased, list) and any((value or "").strip() for value in deceased):
        has_valid_deceased = True

    if isinstance(owner, list):
        for name in owner:
            if name and len(name.strip()) > 50:
                return f"施主姓名“{name}”不能超过 50 个字"

    if code in {"A2", "B2"} and not (has_valid_owner and has_valid_deceased):
        return "A2/B2 表单必须同时填写 owner 和 deceased"
    if code != "D1" and not (has_valid_owner or has_valid_deceased):
        return "必须填写 owner 或 deceased 至少一项"

    return None


_ITEM_FORM_SKIP_KEYS = {"form_code", "form-group", "code", "item_name", "price"}


def _write_item_form_data(item_id: int, data: dict) -> None:
    for key, value in data.items():
        if key in _ITEM_FORM_SKIP_KEYS:
            continue
        values = value if isinstance(value, list) else [value]
        for raw_value in values:
            if raw_value is None or str(raw_value).strip() == "":
                continue
            db.session.add(
                FahuiItemFormData(
                    item_id=item_id,
                    field_name=key,
                    field_value=str(raw_value).strip(),
                )
            )


def create_order_item(order_id: int, data: dict) -> tuple[dict, int]:
    order = FahuiOrder.query.get(order_id)
    denied = _require_order_access(order)
    if denied:
        return denied

    code = (data.get("form-group") or data.get("code") or "").strip()
    error = _validate_item_payload(code, data.get("owner"), data.get("deceased"))
    if error:
        return {"success": False, "message": error}, 400

    order_item = FahuiOrderItem(
        order_id=order_id,
        code=code,
        item_name=data.get("item_name"),
        price=data.get("price") if data.get("price") is not None else default_item_price(code),
    )
    db.session.add(order_item)
    db.session.flush()

    _write_item_form_data(order_item.id, data)

    db.session.commit()
    return {"success": True, "message": "已保存", "item_id": order_item.id}, 200


def update_order_item_fields(item_id: int, data: dict) -> tuple[dict, int]:
    item = FahuiOrderItem.query.get(item_id)
    if not item:
        return {"success": False, "message": "未找到该订单项"}, 404

    denied = _require_order_access(item.order)
    if denied:
        return denied

    code = (data.get("form-group") or data.get("code") or item.code or "").strip()
    error = _validate_item_payload(code, data.get("owner"), data.get("deceased"))
    if error:
        return {"success": False, "message": error}, 400

    item.code = code
    if data.get("item_name") is not None:
        item.item_name = data.get("item_name")
    if data.get("price") is not None:
        item.price = data.get("price")

    # Replace form-data rows in place; the item row + its board/PDF links are kept.
    FahuiItemFormData.query.filter_by(item_id=item.id).delete()
    _write_item_form_data(item.id, data)

    db.session.commit()
    return {"success": True, "message": "已更新", "item_id": item.id}, 200


def delete_order_item(item_id: int, order_id: int) -> tuple[dict, int]:
    item = FahuiOrderItem.query.get(item_id)
    if not item:
        return {"success": False, "message": "未找到该订单项"}, 404
    if item.order_id != order_id:
        return {"success": False, "message": "订单项与订单不匹配"}, 400

    denied = _require_order_access(item.order)
    if denied:
        return denied

    FahuiItemFormData.query.filter_by(item_id=item_id).delete(synchronize_session=False)
    FahuiPdfPageData.query.filter_by(order_item_id=item_id).delete(synchronize_session=False)
    db.session.delete(item)
    db.session.commit()
    return {"success": True, "message": "删除成功"}, 200


def delete_order_batch(data: dict) -> tuple[dict, int]:
    raw_orders = data.get("data") or data.get("order_ids") or []
    if not raw_orders:
        return {"status": "error", "message": "未提供任何订单数据"}, 400

    order_ids = []
    for raw in raw_orders:
        if isinstance(raw, dict) and "id" in raw:
            order_ids.append(raw["id"])
        elif isinstance(raw, int):
            order_ids.append(raw)

    if not order_ids:
        return {"status": "error", "message": "数据中没有包含订单 ID"}, 400

    orders_to_delete = FahuiOrder.query.filter(FahuiOrder.id.in_(order_ids)).all()
    deleted_count = 0
    marked_count = 0
    for order in orders_to_delete:
        if str(order.version) == "DELETE":
            db.session.delete(order)
            deleted_count += 1
        else:
            order.version = "DELETE"
            marked_count += 1

    db.session.commit()
    return {
        "status": "success",
        "message": f"标记删除 {marked_count} 个订单，物理删除 {deleted_count} 个订单",
        "marked": marked_count,
        "deleted": deleted_count,
    }, 200


def clone_order_to_version(data: dict) -> tuple[dict, int]:
    order_id = _coerce_int(data.get("order_id"))
    new_version = normalize_version(data.get("new_version") or data.get("version")) or active_order_version()
    if not order_id:
        return {"error": "order_id and new_version are required"}, 400

    old_order = FahuiOrder.query.get(order_id)
    if not old_order:
        return {"error": f"Order with id {order_id} not found"}, 404
    if old_order.version == new_version:
        return {
            "error": f"Order {order_id} already has version {new_version}, cannot copy again.",
        }, 400

    new_order = FahuiOrder(
        status=old_order.status,
        date=old_order.date,
        time=old_order.time,
        name=old_order.name,
        email=old_order.email,
        customer_name=old_order.customer_name,
        member_name=old_order.member_name,
        phone=old_order.phone,
        code=old_order.code,
        full_code=old_order.full_code,
        created_at=datetime.utcnow(),
        version=new_version,
    )
    db.session.add(new_order)
    db.session.flush()

    old_items = FahuiOrderItem.query.filter_by(order_id=old_order.id).all()
    for old_item in old_items:
        new_item = FahuiOrderItem(
            order_id=new_order.id,
            code=old_item.code,
            item_name=old_item.item_name,
            price=old_item.price,
            line_id=old_item.line_id,
        )
        db.session.add(new_item)
        db.session.flush()

        form_data_list = FahuiItemFormData.query.filter_by(item_id=old_item.id).all()
        for old_data in form_data_list:
            db.session.add(
                FahuiItemFormData(
                    item_id=new_item.id,
                    field_name=old_data.field_name,
                    field_value=old_data.field_value,
                )
            )

    db.session.commit()
    return {"message": "Order copied successfully", "new_order_id": new_order.id}, 201


def update_order_item_form_value(data: dict) -> tuple[dict, int]:
    item_form_id = _coerce_int(data.get("id"))
    new_value = data.get("value")
    if not item_form_id or new_value is None:
        return {"success": False, "message": "缺少参数"}, 400

    item_form = (
        FahuiItemFormData.query.options(
            selectinload(FahuiItemFormData.item).selectinload(FahuiOrderItem.order)
        )
        .filter(FahuiItemFormData.id == item_form_id)
        .first()
    )
    if not item_form:
        return {"success": False, "message": "未找到数据"}, 404

    order = item_form.item.order if item_form.item else None
    denied = _require_order_access(order)
    if denied:
        return denied

    item_form.field_value = str(new_value)
    db.session.commit()
    return {"success": True}, 200


def get_pdf_data(pdf_id: int) -> tuple[dict, int]:
    return get_print_pdf_data(pdf_id)


def delete_board(board_data_id: int) -> tuple[dict, int]:
    return delete_board_entry(board_data_id)


def insert_pdf(data: dict) -> tuple[dict, int]:
    return reorder_board_entry(data)


def add_pdf(data: dict) -> tuple[dict, int]:
    return attach_pdf_to_board(data)


def clear_print_pdf() -> tuple[dict, int]:
    return clear_print_pdf_records()


def get_all_print_data() -> list[dict]:
    return list_print_pdf_records()


def get_version_list() -> list[str]:
    return list_versions()


def get_orders_data(version: str) -> list[dict]:
    return list_orders_by_version(version)


def update_customer(order_id: int, data: dict) -> tuple[dict, int]:
    return update_order_customer(order_id, data)


def get_order_detail(order_id: int | None) -> tuple[dict, int]:
    return get_board_order_detail(order_id)


def fahui_search_engine(keyword: str | None) -> dict:
    return quick_search_orders(keyword)


def add_paiwei(order_id: int, data: dict) -> tuple[dict, int]:
    return create_order_item(order_id, data)


def delete_item(item_id: int, order_id: int) -> tuple[dict, int]:
    return delete_order_item(item_id, order_id)


def delete_orders(data: dict) -> tuple[dict, int]:
    return delete_order_batch(data)


def copy_old_data(data: dict) -> tuple[dict, int]:
    return clone_order_to_version(data)


def update_item_form_value(data: dict) -> tuple[dict, int]:
    return update_order_item_form_value(data)
