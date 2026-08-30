from __future__ import annotations

import re
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
from .shared import active_order_version, format_datetime, normalize_version
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


# 随缘供斋（D）金额自订，默认 0，实际以提交时传来的 price 为准
PRICE_MAP = {
    "D": 0,
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


def _require_current_version(order: FahuiOrder | None):
    # 历史版本（非今年 YLP）的订单一律只读：只能查看，或「复制到今年」后再修改。
    active = active_order_version()
    if order is not None and str(order.version or "") != active:
        return {
            "success": False,
            "message": f"订单属于 {order.version}，历史版本不可修改；如需沿用请「复制到今年」",
        }, 403
    return None


def _touch_maintainer(order: FahuiOrder | None) -> None:
    # 记录最后维护人；公众端未登录的操作不覆盖已有记录。
    if order is not None and _is_logged_in():
        order.user_id = current_user.id


def _notify_order_updated(order_id: int | None) -> None:
    # 广播给正在看公开链接页的访客（房间 fahui:order:<id>），触发前端刷新。
    if not order_id:
        return
    try:
        from app.extensions import socket_broker

        socket_broker.emit(
            "fahui:order_updated",
            {"order_id": order_id},
            room=f"fahui:order:{order_id}",
        )
    except Exception:
        pass


def _notify_board_changed(board_id: int | None, action: str, pdf_id: int | None = None,
                          board_name: str | None = None) -> None:
    """看板有变动就广播一声，CRM 看板页收到自己去刷。

    只发「哪块板、什么动作、哪张牌位」，不塞看板内容 —— 手机扫码时一秒可能好几次，
    payload 越小越好；收到的人自己拉一次最新的就行。
    """
    if not board_id:
        return
    try:
        from app.extensions import socket_broker

        socket_broker.emit(
            "fahui:board_changed",
            {"board_id": board_id, "board_name": board_name, "action": action, "pdf_id": pdf_id},
        )
    except Exception:  # noqa: BLE001
        pass


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

    board_id = board_entry.board_id
    pdf_id = board_entry.print_pdf_id
    db.session.delete(board_entry)
    db.session.commit()
    _notify_board_changed(board_id, "detached", pdf_id)
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
    _notify_board_changed(board_id, "reordered", pdf_id)
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
    _notify_board_changed(header.id, "attached", pdf_id, header.board_name)
    return {
        "side_id": board_entry.id if board_entry else None,
        "pdf_id": pdf_id,
        "pdf_data": [],
        "all_board": _get_all_boards_with_orders(),
    }, 200


# 扫码上板：手机对着板上的牌位扫 QR / 条码，扫到就直接贴。
# 独立于 attach_pdf_to_board 是因为这条路一秒可能触发好几次 ——
# attach 那边每次都回整棵看板树（几十上百块板的全部内容），手机流量顶不住。
# 这里只回一句「贴上了 / 已经在某某板上了」。
_CODE_DIGITS = re.compile(r"\d+")


def scan_attach_to_board(data: dict) -> tuple[dict, int]:
    board_id = _coerce_int(data.get("board_id"))
    raw_code = str(data.get("code") or "").strip()
    if not board_id:
        return {"status": "error", "message": "board_id 不能为空"}, 400

    # 牌位上印的 QR 和条码内容就是牌位单号本身；扫出来带前缀/空白也认。
    digits = _CODE_DIGITS.search(raw_code)
    if not digits:
        return {"status": "unknown", "code": raw_code, "message": f"认不出这个码：{raw_code[:32]}"}, 404
    pdf_id = int(digits.group())

    header = FahuiBoardHeader.query.get(board_id)
    if not header:
        return {"status": "error", "message": f"看板 {board_id} 不存在"}, 404

    pdf = FahuiPrintPdf.query.get(pdf_id)
    if not pdf:
        return {"status": "unknown", "code": raw_code, "pdf_id": pdf_id,
                "message": f"没有单号 #{pdf_id} 的牌位"}, 404

    orders = []
    seen = set()
    for page in pdf.pages or []:
        item = page.order_item
        order = item.order if item else None
        if not order or order.id in seen:
            continue
        seen.add(order.id)
        orders.append({
            "order_id": order.id,
            "customer_name": order.customer_name,
            "owner_or_deceased": _board_owner_or_deceased(item),
        })

    existing = FahuiBoardData.query.filter_by(print_pdf_id=pdf_id).first()
    if existing:
        # 已经贴过了 —— 前端会一直扫到同一张，所以这里必须是幂等的「拒绝」，不是报错崩掉
        other = FahuiBoardHeader.query.get(existing.board_id)
        return {
            "status": "duplicate",
            "pdf_id": pdf_id,
            "board_id": existing.board_id,
            "board_name": other.board_name if other else f"board_{existing.board_id}",
            "same_board": existing.board_id == header.id,
            "location": existing.location,
            "orders": orders,
        }, 409

    # 优先填这块板上的空位，没空位就接在最后（和拖拽上板同一套规则）
    entry = FahuiBoardData.query.filter_by(board_id=header.id, print_pdf_id=None).first()
    if entry:
        entry.print_pdf_id = pdf_id
    else:
        last_location = (
            db.session.query(func.max(FahuiBoardData.location)).filter_by(board_id=header.id).scalar() or 0
        )
        entry = FahuiBoardData(board_id=header.id, print_pdf_id=pdf_id, location=last_location + 1)
        db.session.add(entry)
    db.session.commit()
    _notify_board_changed(header.id, "attached", pdf_id, header.board_name)

    return {
        "status": "attached",
        "pdf_id": pdf_id,
        "side_id": entry.id,
        "board_id": header.id,
        "board_name": header.board_name,
        "location": entry.location,
        "orders": orders,
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


def list_unattached_print_pdfs(version: str | None, page: int = 1, per_page: int = 12) -> dict:
    """某版本（年份）已生成但还没贴上任何大板的牌位单，分页返回，供看板拖拽上板。"""
    normalized_version = normalize_version(version) or active_order_version()
    page = max(1, int(page or 1))
    per_page = max(1, min(int(per_page or 12), 60))

    attached = db.session.query(FahuiBoardData.print_pdf_id).filter(FahuiBoardData.print_pdf_id.isnot(None))
    base = (
        db.session.query(FahuiPrintPdf.id)
        .join(FahuiPdfPageData, FahuiPdfPageData.print_pdf_id == FahuiPrintPdf.id)
        .join(FahuiOrderItem, FahuiOrderItem.id == FahuiPdfPageData.order_item_id)
        .join(FahuiOrder, FahuiOrder.id == FahuiOrderItem.order_id)
        .filter(FahuiOrder.version == normalized_version)
        .filter(~FahuiPrintPdf.id.in_(attached))
        .distinct()
    )
    total = base.count()
    ids = [pdf_id for (pdf_id,) in base.order_by(FahuiPrintPdf.id.asc()).offset((page - 1) * per_page).limit(per_page)]

    items: list[dict] = []
    if ids:
        pdfs = (
            FahuiPrintPdf.query.options(
                selectinload(FahuiPrintPdf.pages)
                .selectinload(FahuiPdfPageData.order_item)
                .selectinload(FahuiOrderItem.order)
            )
            .filter(FahuiPrintPdf.id.in_(ids))
            .all()
        )
        pdfs.sort(key=lambda pdf: ids.index(pdf.id))
        for pdf in pdfs:
            orders_info = []
            seen_items: set[int] = set()
            for pdf_page in pdf.pages or []:
                item = pdf_page.order_item
                if not item or not item.order or item.id in seen_items:
                    continue
                seen_items.add(item.id)
                orders_info.append(
                    {
                        "order_id": item.order.id,
                        "customer_name": item.order.customer_name,
                        "owner_or_deceased": _board_owner_or_deceased(item),
                    }
                )
            items.append({"id": pdf.id, "orders": orders_info})

    return {
        "success": True,
        "items": items,
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": (total + per_page - 1) // per_page if total else 0,
        },
    }


def clear_unattached_print_pdfs(version: str | None) -> tuple[dict, int]:
    """一键清空某版本所有「未上板」的牌位单。号码随即空出，
    下次生成牌位时按最小空缺号复用（见 print_generator），单号不会越长越大。"""
    normalized_version = normalize_version(version) or active_order_version()

    attached = db.session.query(FahuiBoardData.print_pdf_id).filter(FahuiBoardData.print_pdf_id.isnot(None))
    ids = [
        pdf_id
        for (pdf_id,) in (
            db.session.query(FahuiPrintPdf.id)
            .join(FahuiPdfPageData, FahuiPdfPageData.print_pdf_id == FahuiPrintPdf.id)
            .join(FahuiOrderItem, FahuiOrderItem.id == FahuiPdfPageData.order_item_id)
            .join(FahuiOrder, FahuiOrder.id == FahuiOrderItem.order_id)
            .filter(FahuiOrder.version == normalized_version)
            .filter(~FahuiPrintPdf.id.in_(attached))
            .distinct()
            .all()
        )
    ]

    removed = 0
    if ids:
        # pdf_page_data 对 print_pdf 是 DB 级联删除；这些单子不在板上，board_data 无需处理。
        removed = FahuiPrintPdf.query.filter(FahuiPrintPdf.id.in_(ids)).delete(synchronize_session=False)
        db.session.commit()
        # 顺手把自增指针拉回（MySQL 会自动落到 max(id)+1），保持号池紧凑。
        try:
            db.session.execute(text("ALTER TABLE print_pdf AUTO_INCREMENT = 1"))
            db.session.commit()
        except Exception:
            db.session.rollback()

    return {"success": True, "message": f"已清空 {removed} 张未上板牌位单，号码可复用", "removed": removed}, 200


def list_print_pdf_records() -> list[dict]:
    records = FahuiPrintPdf.query.order_by(FahuiPrintPdf.created_at.desc()).all()
    return [serialize_print_pdf(record) for record in records]


def list_print_pdf_history(version: str | None, page: int = 1, per_page: int = 20) -> dict:
    """某版本已注册二维码的牌位单：几时打印的、含哪几张订单、现在贴在哪块板。

    数据源就是看板用的 print_pdf 表本身，不是另一份日志——所以看板那边
    「一键清空未上板」或「重置年度单号」删掉的记录，这里同步就没了。
    """
    normalized_version = normalize_version(version) or active_order_version()
    page = max(1, int(page or 1))
    per_page = max(1, min(int(per_page or 20), 100))

    base = (
        db.session.query(FahuiPrintPdf.id)
        .join(FahuiPdfPageData, FahuiPdfPageData.print_pdf_id == FahuiPrintPdf.id)
        .join(FahuiOrderItem, FahuiOrderItem.id == FahuiPdfPageData.order_item_id)
        .join(FahuiOrder, FahuiOrder.id == FahuiOrderItem.order_id)
        .filter(FahuiOrder.version == normalized_version)
        .distinct()
    )
    total = base.count()
    ids = [
        pdf_id
        for (pdf_id,) in (
            base.order_by(FahuiPrintPdf.created_at.desc(), FahuiPrintPdf.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ]

    items: list[dict] = []
    if ids:
        pdfs = (
            FahuiPrintPdf.query.options(
                selectinload(FahuiPrintPdf.pages)
                .selectinload(FahuiPdfPageData.order_item)
                .selectinload(FahuiOrderItem.order),
                selectinload(FahuiPrintPdf.board_entries).selectinload(FahuiBoardData.board),
            )
            .filter(FahuiPrintPdf.id.in_(ids))
            .all()
        )
        pdfs.sort(key=lambda pdf: ids.index(pdf.id))
        for pdf in pdfs:
            orders_info = []
            seen_items: set[int] = set()
            for pdf_page in pdf.pages or []:
                item = pdf_page.order_item
                if not item or not item.order or item.id in seen_items:
                    continue
                seen_items.add(item.id)
                orders_info.append(
                    {
                        "order_id": item.order.id,
                        "customer_name": item.order.customer_name,
                        "owner_or_deceased": _board_owner_or_deceased(item),
                    }
                )
            boards_info = [
                {
                    "board_id": entry.board.id,
                    "board_name": entry.board.board_name,
                    "location": entry.location,
                }
                for entry in (pdf.board_entries or [])
                if entry.board
            ]
            items.append(
                {
                    "id": pdf.id,
                    "created_at": format_datetime(pdf.created_at),
                    "orders": orders_info,
                    "boards": boards_info,
                }
            )

    return {
        "success": True,
        "items": items,
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": (total + per_page - 1) // per_page if total else 0,
        },
    }


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
    denied = _require_order_access(order) or _require_current_version(order)
    if denied:
        return denied

    from ..common.phone import normalize_phone_for_storage
    from .order_log import log_field_changes

    changes = [
        ("customer_name", order.customer_name, data.get("customer_name", order.customer_name)),
        ("email", order.email, data.get("email", order.email)),
    ]

    # 后台改电话也走同一套规范化，别再往库里写第二种写法。
    new_phone = normalize_phone_for_storage(data.get("phone")) or ""
    if new_phone and new_phone != (order.phone or "").strip():
        if _is_logged_in():
            changes.append(("phone", order.phone, new_phone))
            order.phone = new_phone
        else:
            return {"success": False, "message": "未登录用户无法修改手机号"}, 403

    order.customer_name = data.get("customer_name", order.customer_name)
    order.email = data.get("email", order.email)

    log_field_changes(order.id, changes, target="customer")
    _touch_maintainer(order)
    db.session.commit()
    _notify_order_updated(order.id)
    return {"success": True, "message": "Customer info updated"}, 200


def update_order_status(order_id: int, data: dict) -> tuple[dict, int]:
    order = FahuiOrder.query.get(order_id)
    if not order:
        return {"success": False, "message": f"Order {order_id} not found"}, 404

    denied = _require_current_version(order)
    if denied:
        return denied

    status = str(data.get("status") or "").strip()
    if not status:
        return {"success": False, "message": "缺少 status"}, 400

    from .order_log import log_field_changes

    log_field_changes(order.id, [("status", order.status, status)], target="status")
    order.status = status
    _touch_maintainer(order)
    db.session.commit()
    _notify_order_updated(order.id)
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


def quick_search_orders(keyword: str | None, version: str | None = None) -> dict:
    keyword = (keyword or "").strip().lower()
    if not keyword:
        return {"success": True, "results": []}

    # 查板只查当前选中的版本（年份），不跨版本。
    normalized_version = normalize_version(version)

    base_query = FahuiOrder.query.options(
        selectinload(FahuiOrder.items).selectinload(FahuiOrderItem.form_data),
        selectinload(FahuiOrder.payments),
    )
    if normalized_version:
        base_query = base_query.filter(FahuiOrder.version == normalized_version)

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
                if not normalized_version or str(order_item.order.version or "") == normalized_version:
                    orders = [order_item.order]

        if not orders:
            # 库里统一存 +60…，但工作人员习惯输 0…，所以拿去掉国家码的核心号码去模糊匹配。
            from ..common.phone import canonical_phone

            needle = canonical_phone(keyword) or keyword
            orders = (
                base_query.filter(FahuiOrder.phone.like(f"%{needle}%"))
                .order_by(FahuiOrder.created_at.desc())
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
            .all()
        )

        # 带 + 或者中间有横线空格的号码（+60123…、012-345 6789）不是纯数字，
        # 上面按姓名搜自然搜不到，这里补一次电话匹配。
        if not orders:
            from ..common.phone import canonical_phone

            needle = canonical_phone(keyword)
            if len(needle) >= 7:
                orders = (
                    base_query.filter(FahuiOrder.phone.like(f"%{needle}%"))
                    .order_by(FahuiOrder.created_at.desc())
                    .all()
                )

    # 前面都没命中才翻牌位内容（阳上 / 对象的名字）。这里原本叠了三层截断
    # （10 / 10 / 取前 5），现在一并去掉，全量返回。
    if not orders:
        matched_item_ids = {
            item_id
            for (item_id,) in db.session.query(FahuiItemFormData.item_id).filter(
                FahuiItemFormData.field_value.ilike(f"%{keyword}%")
            )
        }
        if matched_item_ids:
            matched_order_ids = {
                order_id
                for (order_id,) in db.session.query(FahuiOrderItem.order_id).filter(
                    FahuiOrderItem.id.in_(matched_item_ids)
                )
            }
            if matched_order_ids:
                orders = (
                    base_query.filter(FahuiOrder.id.in_(matched_order_ids))
                    .order_by(FahuiOrder.id.desc())
                    .all()
                )

    results = []
    for order in orders:
        if order.version == "DELETE" and not _is_logged_in():
            continue
        # full_items=True 才会带 item_location（牌位单号 + 上板位置），查板/点亮都靠它。
        results.append(serialize_order(order, include_items=True, full_items=True))
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
    # D1 普度贡品按数量、D 随缘供斋只填金额，两者都没有阳上/对象
    if code not in {"D", "D1"} and not (has_valid_owner or has_valid_deceased):
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
    denied = _require_order_access(order) or _require_current_version(order)
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
    db.session.flush()

    from .order_log import describe_item, item_snapshot, log_order_change

    snapshot = item_snapshot(order_item)
    log_order_change(
        order_id,
        target="item",
        action="create",
        item_id=order_item.id,
        new=describe_item(snapshot),
        summary=f"新增牌位 #{order_item.id}：{describe_item(snapshot)}",
    )

    _touch_maintainer(order)
    db.session.commit()
    _notify_order_updated(order_id)
    return {"success": True, "message": "已保存", "item_id": order_item.id}, 200


def update_order_item_fields(item_id: int, data: dict) -> tuple[dict, int]:
    item = FahuiOrderItem.query.get(item_id)
    if not item:
        return {"success": False, "message": "未找到该订单项"}, 404

    denied = _require_order_access(item.order) or _require_current_version(item.order)
    if denied:
        return denied

    code = (data.get("form-group") or data.get("code") or item.code or "").strip()
    error = _validate_item_payload(code, data.get("owner"), data.get("deceased"))
    if error:
        return {"success": False, "message": error}, 400

    from .order_log import diff_item_snapshots, item_snapshot, log_field_changes

    before = item_snapshot(item)

    item.code = code
    if data.get("item_name") is not None:
        item.item_name = data.get("item_name")
    if data.get("price") is not None:
        item.price = data.get("price")

    # Replace form-data rows in place; the item row + its board/PDF links are kept.
    FahuiItemFormData.query.filter_by(item_id=item.id).delete()
    _write_item_form_data(item.id, data)
    db.session.flush()

    # 上面是批量删 + 重新插，item.form_data 这个 selectin 关系还缓存着旧行，
    # 不 expire 的话前后快照会一模一样，改动就记不下来了。
    db.session.expire(item, ["form_data"])
    after = item_snapshot(item)
    log_field_changes(
        item.order_id,
        diff_item_snapshots(before, after),
        target="item",
        item_id=item.id,
        prefix=f"牌位 #{item.id} ",
    )

    _touch_maintainer(item.order)
    db.session.commit()
    _notify_order_updated(item.order_id)
    return {"success": True, "message": "已更新", "item_id": item.id}, 200


def delete_order_item(item_id: int, order_id: int) -> tuple[dict, int]:
    item = FahuiOrderItem.query.get(item_id)
    if not item:
        return {"success": False, "message": "未找到该订单项"}, 404
    if item.order_id != order_id:
        return {"success": False, "message": "订单项与订单不匹配"}, 400

    denied = _require_order_access(item.order) or _require_current_version(item.order)
    if denied:
        return denied

    from .order_log import describe_item, item_snapshot, log_order_change

    snapshot = item_snapshot(item)
    log_order_change(
        order_id,
        target="item",
        action="delete",
        item_id=item.id,
        old=describe_item(snapshot),
        summary=f"删除牌位 #{item.id}：{describe_item(snapshot)}",
    )

    # 子行走 ORM 删除（不用批量 SQL）：item 加载时 form_data/pdf_pages 已被 selectin
    # 拉进 session，批量删除会让 ORM 在 commit 时对已消失的行发 UPDATE 而抛 StaleDataError。
    for form_row in list(item.form_data or []):
        db.session.delete(form_row)
    for pdf_page in list(item.pdf_pages or []):
        db.session.delete(pdf_page)
    _touch_maintainer(item.order)
    db.session.delete(item)
    db.session.commit()
    _notify_order_updated(order_id)
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

    from .order_log import log_order_change

    orders_to_delete = FahuiOrder.query.filter(FahuiOrder.id.in_(order_ids)).all()
    deleted_count = 0
    marked_count = 0
    for order in orders_to_delete:
        if str(order.version) == "DELETE":
            # 已经在 DELETE 版本里再删一次 = 物理删除，日志会跟着订单一起 CASCADE 掉，
            # 所以这一条不记（也记不住）。
            db.session.delete(order)
            deleted_count += 1
        else:
            log_order_change(
                order.id,
                target="order",
                action="delete",
                field="version",
                old=order.version,
                new="DELETE",
                summary=f"订单移入 DELETE 版本（原 {order.version}）",
            )
            order.version = "DELETE"
            _touch_maintainer(order)
            marked_count += 1

    db.session.commit()
    return {
        "status": "success",
        "message": f"标记删除 {marked_count} 个订单，物理删除 {deleted_count} 个订单",
        "marked": marked_count,
        "deleted": deleted_count,
    }, 200


def _log_cloned_order(old_order: FahuiOrder, new_order: FahuiOrder) -> None:
    from .order_log import log_order_change

    log_order_change(
        new_order.id,
        target="order",
        action="create",
        field="version",
        old=old_order.version,
        new=new_order.version,
        summary=f"由订单 #{old_order.id}（{old_order.version}）复制而来，共 {len(new_order.items or [])} 项牌位",
    )


def _clone_order_record(old_order: FahuiOrder, new_version: str) -> FahuiOrder:
    # 复制订单与全部项目到指定版本；新订单回到 Draft（未付款、可编辑），并记录操作人。
    new_order = FahuiOrder(
        status="Draft",
        date=old_order.date,
        time=old_order.time,
        name=old_order.name,
        email=old_order.email,
        customer_name=old_order.customer_name,
        member_name=old_order.member_name,
        user_id=current_user.id if _is_logged_in() else old_order.user_id,
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
    return new_order


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

    new_order = _clone_order_record(old_order, new_version)
    db.session.flush()
    _log_cloned_order(old_order, new_order)
    db.session.commit()
    return {"message": "Order copied successfully", "new_order_id": new_order.id}, 201


def copy_orders_to_current(data: dict) -> tuple[dict, int]:
    # 「复制到今年」：把历史版本订单（含全部牌位项目）复制成今年版本的新 Draft 订单。
    raw_ids = data.get("order_ids")
    if raw_ids is None and data.get("order_id") is not None:
        raw_ids = [data.get("order_id")]
    order_ids = [oid for oid in (_coerce_int(raw) for raw in raw_ids or []) if oid]
    if not order_ids:
        return {"success": False, "message": "缺少 order_ids"}, 400

    active = active_order_version()
    copied: list[dict] = []
    skipped: list[dict] = []
    for order_id in order_ids:
        old_order = FahuiOrder.query.get(order_id)
        if not old_order:
            skipped.append({"id": order_id, "reason": "订单不存在"})
            continue
        if str(old_order.version or "") == active:
            skipped.append({"id": order_id, "reason": f"已是今年版本（{active}）"})
            continue
        new_order = _clone_order_record(old_order, active)
        db.session.flush()
        _log_cloned_order(old_order, new_order)
        copied.append({"old_id": order_id, "new_id": new_order.id})

    if copied:
        db.session.commit()
    else:
        db.session.rollback()

    message = f"已复制 {len(copied)} 张订单到 {active}"
    if skipped:
        message += f"，跳过 {len(skipped)} 张"
    return {"success": True, "message": message, "copied": copied, "skipped": skipped, "version": active}, 200


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
    denied = _require_order_access(order) or _require_current_version(order)
    if denied:
        return denied

    from .order_log import log_field_changes

    if order is not None:
        log_field_changes(
            order.id,
            [(item_form.field_name, item_form.field_value, str(new_value))],
            target="item",
            item_id=item_form.item_id,
            prefix=f"牌位 #{item_form.item_id} ",
        )

    item_form.field_value = str(new_value)
    _touch_maintainer(order)
    db.session.commit()
    _notify_order_updated(order.id if order else None)
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
