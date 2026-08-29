from __future__ import annotations

from datetime import datetime

from flask_login import current_user
from sqlalchemy import case, func, or_
from sqlalchemy.orm import selectinload

from app.fahui.common.payment import normalize_fahui_payment_status
from app.fahui.common.session_state import current_session_phone, current_verified_phones
from app.extensions import socket_broker
from models import db
from models.fahui import (
    FahuiItemFormData,
    FahuiOrder,
    FahuiVersionEvent,
    FahuiOrderItem,
    FahuiPayment,
    FahuiPdfPageData,
    FahuiPrintPdf,
    fahui_payment_order,
)
from models.user_data import User
from .shared import (
    active_order_version,
    format_created_at,
    format_datetime,
    item_price_decimal,
    item_price_int,
    latest_payment as shared_latest_payment,
    mask_phone,
    normalize_version,
    order_all_payments,
    order_payment_state,
    order_payment_status,
    order_total_amount,
)


def user_can_view_order(order: FahuiOrder) -> bool:
    # 管理端需要法会读权限（fahui_read/account_read/account_edit）；
    # 公开访客只能看「已验证手机号」名下的订单。
    from ..common.access import can_access_phone_records

    session_phone = current_session_phone()
    if session_phone and session_phone == (order.phone or "").strip():
        return True

    return can_access_phone_records(order.phone)


def item_price(item: FahuiOrderItem) -> int:
    return item_price_int(item)


def serialize_item_form_field(field: FahuiItemFormData) -> dict:
    return {
        "id": field.id,
        "item_id": field.item_id,
        "field_name": field.field_name,
        "field_value": field.field_value,
    }


def serialize_pdf_page(page: FahuiPdfPageData) -> dict:
    return {
        "id": page.id,
        "print_pdf_id": page.print_pdf_id,
        "order_item_id": page.order_item_id,
        "order_id": page.order_item.order_id if page.order_item else None,
    }


def serialize_print_pdf(pdf: FahuiPrintPdf, include_pages: bool = True) -> dict:
    data = {
        "id": pdf.id,
        "created_at": format_datetime(pdf.created_at),
        "width": pdf.width,
        "height": pdf.height,
        # 这张打印页（单号=id）目前贴在哪块板的哪个位置——扫条码/输单号查板用。
        "boards": [
            {
                "board_id": entry.board.id,
                "board_name": entry.board.board_name,
                "location": entry.location,
                "board_data_id": entry.id,
            }
            for entry in (pdf.board_entries or [])
            if entry.board
        ],
    }
    if include_pages:
        data["page_data"] = [serialize_pdf_page(page) for page in (pdf.pages or [])]
    return data


def serialize_order_item(item: FahuiOrderItem, full: bool = False) -> dict:
    data = {
        "id": item.id,
        "order_id": item.order_id,
        "code": item.code,
        "item_name": item.item_name,
        "price": item_price(item),
    }

    if not full:
        data["item_form_data"] = [serialize_item_form_field(field) for field in (item.form_data or [])]
        return data

    form_data_dict: dict[str, list[dict]] = {}
    for field in item.form_data or []:
        form_data_dict.setdefault(field.field_name or "", []).append(
            {
                "val": field.field_value,
                "val_id": field.id,
            }
        )
    data["item_form_data"] = form_data_dict

    item_location = []
    for page in item.pdf_pages or []:
        pdf = page.print_pdf
        if not pdf:
            continue

        boards = []
        for board_entry in pdf.board_entries or []:
            board = board_entry.board
            if not board:
                continue
            boards.append(
                {
                    "board_id": board.id,
                    "board_name": board.board_name,
                    "location": board_entry.location,
                    "board_data_id": board_entry.id,
                }
            )

        item_location.append(
            {
                "print_pdf": serialize_print_pdf(pdf, include_pages=False),
                "pdf_page_data": serialize_pdf_page(page),
                "boards": boards,
            }
        )

    data["item_location"] = item_location
    return data


def latest_payment(order: FahuiOrder) -> FahuiPayment | None:
    return shared_latest_payment(order)


def payment_status(order: FahuiOrder) -> str:
    return order_payment_status(order)


def maintainer_display_name(order: FahuiOrder) -> str | None:
    # 优先显示 user_id 对应用户；旧数据退回 member_name 文本。
    user = getattr(order, "maintainer", None)
    if user is not None:
        return user.display_name or user.username or user.email
    return order.member_name


def serialize_order(order: FahuiOrder, include_items: bool = False, full_items: bool = False) -> dict:
    can_view = user_can_view_order(order)
    is_logged_in = bool(current_user and current_user.is_authenticated)
    phone = order.phone if can_view else mask_phone(order.phone)

    data = {
        "id": order.id,
        "status": payment_status(order),
        "payment_state": order_payment_state(order),
        "order_status": order.status,
        "name": order.name,
        "email": order.email,
        "customer_name": order.customer_name,
        "member_name": order.member_name,
        "user_id": order.user_id,
        "maintainer_name": maintainer_display_name(order),
        "phone": phone,
        "created_at": format_created_at(order.created_at),
        "version": order.version,
        "total_amount": float(order_total_amount(order)),
        "login": is_logged_in,
        "is_logged_in": is_logged_in,
        "owner": can_view and not is_logged_in,
        "is_owner": can_view and not is_logged_in,
    }

    if include_items and can_view:
        data["order_items"] = [serialize_order_item(item, full=full_items) for item in (order.items or [])]

    return data


def serialize_order_detail(order: FahuiOrder) -> dict:
    if not user_can_view_order(order):
        return {
            "status": "error",
            "message": "未登录或没有权限查看此订单",
        }

    data = serialize_order(order, include_items=True, full_items=True)

    prev_order = (
        FahuiOrder.query.filter(FahuiOrder.id < order.id).order_by(FahuiOrder.id.desc()).first()
    )
    next_order = (
        FahuiOrder.query.filter(FahuiOrder.id > order.id).order_by(FahuiOrder.id.asc()).first()
    )

    data["prev_id"] = prev_order.id if prev_order else None
    data["next_id"] = next_order.id if next_order else None
    return data


def _order_search_filter(value: str):
    # 搜索范围：订单号 / 功德主 / 联络人 / 电话 / 牌位内容（所有表单值 + 项目名）/ 维护人。
    # 用 EXISTS 子查询代替 join+distinct，这样任意字段排序在 MySQL 下都合法。
    like_value = f"%{value}%"

    item_match = (
        db.session.query(FahuiOrderItem.id)
        .outerjoin(FahuiItemFormData, FahuiItemFormData.item_id == FahuiOrderItem.id)
        .filter(
            FahuiOrderItem.order_id == FahuiOrder.id,
            or_(
                FahuiItemFormData.field_value.ilike(like_value),
                FahuiOrderItem.item_name.ilike(like_value),
            ),
        )
        .exists()
    )
    maintainer_match = (
        db.session.query(User.id)
        .filter(
            User.id == FahuiOrder.user_id,
            or_(User.display_name.ilike(like_value), User.username.ilike(like_value)),
        )
        .exists()
    )

    conditions = [
        FahuiOrder.name.ilike(like_value),
        FahuiOrder.customer_name.ilike(like_value),
        FahuiOrder.phone.ilike(like_value),
        FahuiOrder.member_name.ilike(like_value),
        item_match,
        maintainer_match,
    ]
    if value.isdigit():
        conditions.append(FahuiOrder.id == int(value))
    return or_(*conditions)


_APPROVED_PAYMENT_STATUSES = ("approve", "approved")


def _order_sort_columns(sort: str | None, direction: str | None):
    descending = str(direction or "").lower() == "desc"

    def directed(column):
        return column.desc() if descending else column.asc()

    if sort == "id":
        primary = FahuiOrder.id
    elif sort == "customer":
        primary = func.coalesce(FahuiOrder.customer_name, FahuiOrder.name)
    elif sort == "phone":
        primary = FahuiOrder.phone
    elif sort == "total":
        primary = (
            db.session.query(func.coalesce(func.sum(FahuiOrderItem.price), 0))
            .filter(FahuiOrderItem.order_id == FahuiOrder.id)
            .scalar_subquery()
        )
    elif sort == "maintainer":
        maintainer_name = (
            db.session.query(func.coalesce(User.display_name, User.username, User.email))
            .filter(User.id == FahuiOrder.user_id)
            .scalar_subquery()
        )
        primary = func.coalesce(maintainer_name, FahuiOrder.member_name)
    elif sort == "created_at":
        primary = FahuiOrder.created_at
    elif sort == "order_status":
        # 订单本身的流程状态（orders.status 列），空值当 Draft 排在一起
        primary = func.coalesce(func.nullif(FahuiOrder.status, ""), "Draft")
    elif sort == "status":
        # 与 serialize 的汇总付款状态一致：paid(2) > pending(1) > none(0)。
        direct_approved = (
            db.session.query(FahuiPayment.id)
            .filter(
                FahuiPayment.order_id == FahuiOrder.id,
                func.lower(FahuiPayment.status).in_(_APPROVED_PAYMENT_STATUSES),
            )
            .exists()
        )
        grouped_approved = (
            db.session.query(FahuiPayment.id)
            .join(fahui_payment_order, fahui_payment_order.c.payment_id == FahuiPayment.id)
            .filter(
                fahui_payment_order.c.order_id == FahuiOrder.id,
                func.lower(FahuiPayment.status).in_(_APPROVED_PAYMENT_STATUSES),
            )
            .exists()
        )
        direct_any = (
            db.session.query(FahuiPayment.id).filter(FahuiPayment.order_id == FahuiOrder.id).exists()
        )
        grouped_any = (
            db.session.query(FahuiPayment.id)
            .join(fahui_payment_order, fahui_payment_order.c.payment_id == FahuiPayment.id)
            .filter(fahui_payment_order.c.order_id == FahuiOrder.id)
            .exists()
        )
        primary = case(
            (or_(direct_approved, grouped_approved), 2),
            (or_(direct_any, grouped_any), 1),
            else_=0,
        )
    else:
        return [FahuiOrder.created_at.desc(), FahuiOrder.id.desc()]

    return [directed(primary), FahuiOrder.id.desc()]


def search_orders(
    version: object,
    value: str,
    page_num: int = 1,
    per_page: int = 20,
    sort: str | None = None,
    direction: str | None = None,
) -> dict:
    normalized_version = normalize_version(version)
    if not normalized_version:
        raise ValueError("version is required")

    page_num = max(1, int(page_num or 1))
    per_page = max(1, min(int(per_page or 20), 100))
    value = (value or "").strip()

    query = (
        db.session.query(FahuiOrder)
        .options(
            selectinload(FahuiOrder.items).selectinload(FahuiOrderItem.form_data),
            selectinload(FahuiOrder.payments),
        )
        # 删除只认一套约定：软删除 = 移到 "DELETE" 版本（见 delete_order_batch）。
        # 以前还有一套「status='delete'」的旧标记，两套并存会让订单在自己版本里被藏起来、
        # 在 DELETE 版本里又找不到，等于全版本隐身，所以这里不再看 status。
        .filter(FahuiOrder.version == normalized_version)
    )

    if value:
        query = query.filter(_order_search_filter(value))

    total = query.count()
    items = (
        query.order_by(*_order_sort_columns(sort, direction))
        .offset((page_num - 1) * per_page)
        .limit(per_page)
        .all()
    )

    return {
        "items": [serialize_order(order) for order in items],
        "pagination": {
            "page": page_num,
            "per_page": per_page,
            "total": total,
            "pages": (total + per_page - 1) // per_page if total else 0,
            "has_next": page_num * per_page < total,
            "has_prev": page_num > 1,
        },
    }


def _export_order_item(item: FahuiOrderItem) -> dict:
    """导出用的项目序列化：表单字段给全（和 full_items 同一套 {val, val_id} 结构），
    但不去捞牌位板位置——那要连着 pdf_pages → print_pdf → board_entries 翻三层，
    整版导出会被拖成 N+1。"""
    form_data: dict[str, list[dict]] = {}
    for field in item.form_data or []:
        form_data.setdefault(field.field_name or "", []).append(
            {"val": field.field_value, "val_id": field.id}
        )
    return {
        "id": item.id,
        "order_id": item.order_id,
        "code": item.code,
        "item_name": item.item_name,
        # 列表用的是取整价（item_price_int），导出要能对账，所以给两位小数的真实金额。
        "price": float(item_price_decimal(item)),
        "item_form_data": form_data,
    }


def _export_order_payment(payment: FahuiPayment) -> dict:
    # 合并付款（一笔覆盖多张订单）会挂在每张订单下，导出时容易被重复计算，
    # 所以把它覆盖的订单号一起带出去，让报表能标出来。
    covered: list[int] = []
    if payment.order_id is not None:
        covered.append(payment.order_id)
    for grouped in payment.grouped_orders or []:
        if grouped.id is not None and grouped.id not in covered:
            covered.append(grouped.id)
    return {
        "id": payment.id,
        "order_ids": covered,
        "amount": float(payment.total_price or 0),
        "payment_mode": payment.payment_mode,
        "status": normalize_fahui_payment_status(payment.status),
        "payer_name": payment.payer_name,
        "paid_at": format_datetime(payment.paid_at),
        "created_at": format_datetime(payment.created_at),
        "valid_by": payment.valid_by,
        "note": payment.note,
    }


def serialize_order_for_export(order: FahuiOrder) -> dict:
    """导出用：订单表头 + 全部牌位明细 + 全部付款记录（含合并付款）。"""
    data = serialize_order(order)
    if not user_can_view_order(order):
        return data
    data["order_items"] = [_export_order_item(item) for item in (order.items or [])]
    payments = sorted(
        order_all_payments(order), key=lambda p: (p.created_at or datetime.min, p.id or 0)
    )
    data["payments"] = [_export_order_payment(payment) for payment in payments]
    return data


def list_orders_for_export(version: object, value: str = "") -> dict:
    """返回某版本 + 搜索条件下的「全部」订单（不分页），供全页全选导出/打印使用。"""
    normalized_version = normalize_version(version)
    if not normalized_version:
        raise ValueError("version is required")

    value = (value or "").strip()
    query = (
        db.session.query(FahuiOrder)
        .options(
            selectinload(FahuiOrder.items).selectinload(FahuiOrderItem.form_data),
            selectinload(FahuiOrder.payments),
            selectinload(FahuiOrder.grouped_payments),
        )
        # 删除只认一套约定：软删除 = 移到 "DELETE" 版本（见 delete_order_batch）。
        # 以前还有一套「status='delete'」的旧标记，两套并存会让订单在自己版本里被藏起来、
        # 在 DELETE 版本里又找不到，等于全版本隐身，所以这里不再看 status。
        .filter(FahuiOrder.version == normalized_version)
    )

    if value:
        query = query.filter(_order_search_filter(value))

    orders = query.order_by(FahuiOrder.created_at.desc(), FahuiOrder.id.desc()).all()
    return {
        "items": [serialize_order_for_export(order) for order in orders],
        "total": len(orders),
    }


def get_order_detail(order_id: int) -> tuple[dict, int]:
    order = FahuiOrder.query.get(order_id)
    if not order:
        return {"status": "error", "message": f"找不到订单 ID {order_id}"}, 404

    detail = serialize_order_detail(order)
    if detail.get("status") == "error":
        return detail, 403
    return {"status": "success", "data": detail}, 200


def get_orders_by_phone(phone: str) -> tuple[dict, int]:
    phone = (phone or "").strip()
    if not phone:
        return {"status": "error", "message": "phone is required"}, 400

    from ..common.phone import phone_lookup_variants
    from ..common.access import phones_match

    verified_owner = (
        phones_match(phone, current_session_phone())
        or any(phones_match(phone, verified) for verified in current_verified_phones())
    )
    logged_in = bool(current_user and current_user.is_authenticated)
    if not logged_in and not verified_owner:
        return {"status": "error", "message": "请先完成手机验证"}, 403

    # 库里同一个号可能存成 +60… / 60… / 0…（公开页写一种，后台录入写另一种），
    # 所以按各种写法一起查，别让人从公开页看不到自己的单。
    orders = (
        db.session.query(FahuiOrder)
        .options(selectinload(FahuiOrder.items).selectinload(FahuiOrderItem.form_data), selectinload(FahuiOrder.payments))
        .filter(FahuiOrder.phone.in_(phone_lookup_variants(phone)))
        .order_by(FahuiOrder.created_at.desc(), FahuiOrder.id.desc())
        .all()
    )

    return {
        "status": "success",
        "data": {
            "phone": phone,
            "items": [serialize_order(order, include_items=True) for order in orders],
        },
    }, 200


def create_order_shell(data: dict) -> tuple[dict, int]:
    from ..common.phone import normalize_phone_for_storage, phone_lookup_variants

    name = (data.get("name") or "").strip()
    phone = (data.get("phone") or "").strip()
    if not name or not phone:
        return {"status": "error", "message": "name and phone are required"}, 400

    # 一律按规范写法入库（+60…）；认不出来的座机等原样保留，纯垃圾则拒掉。
    phone = normalize_phone_for_storage(phone) or ""
    if not phone:
        return {"status": "error", "message": "手机号码格式不正确"}, 400

    # 公开登记页（#/ylp-registration）唯一的建单入口：版本一律锁死今年，
    # 不接受 payload 传进来的 version —— 不可能从这里新建往年的牌位订单。
    version = active_order_version()
    # 记录创建人：登录用户直接挂 user_id；匿名提交沿用 payload 里的 member_name 文本（可选）。
    creator_user_id = None
    member_name = None
    if current_user and current_user.is_authenticated:
        creator_user_id = current_user.id
    else:
        member_name = (data.get("member_name") or None)

    # force_new：明确要另开一张（同一个人同一年可能交好几张不同的单据），
    # 不走「姓名+电话+版本」去重，免得第二张把第一张覆盖掉。
    force_new = str(data.get("force_new") or "").strip().lower() in {"1", "true", "yes", "on"} or data.get("force_new") is True

    # 去重同样要认各种写法，否则同一个人换个格式提交就会被当成新客人。
    existing = (
        None
        if force_new
        else db.session.query(FahuiOrder)
        .filter(
            FahuiOrder.name == name,
            FahuiOrder.phone.in_(phone_lookup_variants(phone)),
            FahuiOrder.version == version,
        )
        .first()
    )
    if existing:
        return {
            "success": True,
            "message": "订单已存在",
            "order": serialize_order(existing, include_items=True),
            "duplicated": True,
        }, 200

    order = FahuiOrder(
        email=data.get("email"),
        name=name,
        customer_name=data.get("customer_name"),
        member_name=member_name,
        user_id=creator_user_id,
        phone=phone,
        version=version,
        status=data.get("status"),
    )
    db.session.add(order)
    db.session.flush()

    from .order_log import log_order_change

    log_order_change(
        order.id,
        target="order",
        action="create",
        summary=f"创建订单：功德主 {order.customer_name or order.name or '（空）'}，电话 {order.phone or '（空）'}，版本 {order.version}",
        new=order.version,
    )
    db.session.commit()

    try:
        # 经 redis 消息队列广播，任意 HTTP worker 都能送达 socket 服务；
        # CRM 订单列表监听此事件即时插入新订单。
        socket_broker.emit(
            "fahui:order_created",
            {
                "order": {
                    "id": order.id,
                    "status": order_payment_status(order),
                    "name": order.name,
                    "customer_name": order.customer_name,
                    "phone": order.phone,
                    "created_at": format_created_at(order.created_at),
                    "version": order.version,
                },
                "source": "new_customer",
            },
        )
    except Exception:
        pass

    return {
        "success": True,
        "message": "订单已创建",
        "order": serialize_order(order, include_items=True),
        "duplicated": False,
    }, 200


def create_customer(data: dict) -> tuple[dict, int]:
    return create_order_shell(data)


def list_available_versions() -> list[str]:
    rows = db.session.query(FahuiOrder.version).distinct().order_by(FahuiOrder.version.desc()).all()
    return [value for (value,) in rows if value]


# ---- 版本 ↔ 活动绑定（绑定后该版本的订单收入会进活动预算，做法同报名表格） ----

def get_version_event_binding(version: str, workspace: str = "ylp") -> dict | None:
    version = normalize_version(version) if version else ""
    if not version:
        return None
    row = FahuiVersionEvent.query.filter_by(workspace=workspace, version=version).first()
    return row.to_dict() if row else None


def list_version_event_bindings(workspace: str = "ylp") -> list[dict]:
    rows = FahuiVersionEvent.query.filter_by(workspace=workspace).order_by(FahuiVersionEvent.version.desc()).all()
    return [row.to_dict() for row in rows]


def set_version_event_binding(version: str, event_id, workspace: str = "ylp") -> dict | None:
    """event_id 传 None / 空 = 解除绑定；一个版本同时只能绑一个活动。"""
    from models.event_data import EventData

    version = normalize_version(version) if version else ""
    if not version:
        raise ValueError("缺少版本")
    if version == "DELETE":
        raise ValueError("DELETE 版本不能绑定活动")

    row = FahuiVersionEvent.query.filter_by(workspace=workspace, version=version).first()

    if event_id in (None, "", 0, "0"):
        if row:
            db.session.delete(row)
            db.session.commit()
        return None

    try:
        event_id = int(event_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("event_id 格式错误") from exc

    event = EventData.query.get(event_id)
    if not event:
        raise ValueError("活动不存在")

    if not row:
        row = FahuiVersionEvent(workspace=workspace, version=version)
        db.session.add(row)
    row.event_id = event.id
    row.created_by_user_id = getattr(current_user, "id", None)
    db.session.commit()
    return row.to_dict()


def get_available_versions() -> list[str]:
    return list_available_versions()
