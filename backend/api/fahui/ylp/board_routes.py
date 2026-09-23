"""看板（大板贴牌位）与订单牌位条目的接口，挂在 ``/board_router/*``。

原 backend/app/fahui/YLP/board_routes.py（Flask Blueprint ``board_router``，
挂在 ``{API_PREFIX}/board_router``）。只做框架适配：装饰器、参数提取、响应构造。
校验顺序、状态码、中文文案、响应体的键名全部逐字照搬 ——
CRM 查板页、扫码贴板终端、公开付款页三处前端都在按这些键分支。

本文件是六个 router 里最大的一个（61 条），规范路径与旧别名一起搬，
对照表见 app/fahui/route_contracts.py 的 ylp_board 组。URL 只去掉了 ``/api`` 这一段。

── 四条搬迁硬约束 ────────────────────────────────────────────────────
  ① 本文件**不能写 ``from __future__ import annotations``**（core.auth 的装饰器
     用 functools.wraps 包过，FastAPI 会去 core/auth.py 的命名空间求值注解）。
  ② 路由函数一律 ``def``（同步）：底下全是同步 ORM + PyMuPDF + 文件 IO。
  ③ ``@router.*`` 在上、``@permission_required_any`` 在下。
  ④ 路径参数一律 ``{xxx:int}``。除了「Flask 的 ``<int:>`` 不匹配是 404、
     光靠注解会变 422」这条通则之外，本文件还**额外依赖**它分家：
         GET  /orders            ↔  GET  /orders/detail
         GET  /print-pdfs        ↔  GET  /print-pdfs/{pdf_id}
         GET  /print-pdfs/unattached | /history
         POST /orders/delete | /clone | /copy-to-current | /quick-search
                                 ↔  POST /orders/{order_id}/customer | /items | /status
         POST /boards/entries | /boards/entries/reorder | /boards/scan
                                 ↔  POST /boards/{board_id}
     ``:int`` 在**匹配阶段**就只认数字，所以这些具名路径不会被 ``{id}`` 吃掉。
     声明顺序也照抄了 Flask 原文件，当第二道保险 —— 但真正保命的是转换器。

── 鉴权：三种形状，不要对齐 ───────────────────────────────────────────
  · 读：``@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)``
  · 写：``@permission_required_any("account_edit")``
  · **完全没有装饰器**的那几条，鉴权在函数体里，或者压根就是公开的：
      ``/orders/<id>/customer``  —— 公开访客可改「已验证手机号」名下的订单
      ``/orders/<id>/logs``      —— 同上，走 user_can_view_order
      ``/orders/<id>/items``（增）/ ``items/<item_id>``（改、删）/
      ``/item-form-values`` / ``/orders/detail`` / ``/orders/quick-search``
                                 —— 鉴权在 board_services 里（_require_order_access）
      ``/payment-channels``（GET）—— 付款页要向报名者展示收款方式
      ``/relation-options``（GET）—— 填牌位时要下拉选关系
      ``/terminal/boards``        —— 第二显示器凭 Redis token 进
    照搬。换成装饰器就等于把公开登记流程整条掐掉。

── 出向推送 ──────────────────────────────────────────────────────────
``/terminal/highlight`` 原来是 ``socket_broker.emit(..., room=terminal_room(uid))``，
现在是 ``publish_sync(REALTIME_APP, terminal_room(uid), ...)``，见 api/fahui/realtime.py。
**500「广播失败」那条分支保住了**：原来 Redis 挂掉时 socket_broker.emit 会抛 →
落到 except → 500；publish_sync 自己吞异常、只**返回 False**，所以这里改成判返回值。
不判的话 Redis 挂了会静默回 200，查板页那头点了没反应却看不出问题。
"""

from typing import Optional

from fastapi import APIRouter, Body, Depends

from backend.api.fahui.realtime import REALTIME_APP
from backend.api.fahui.uploads import form_and_files
from backend.core.auth import current_user, permission_required_any
from backend.core.config import settings
from backend.core.realtime import publish_sync
from backend.core.responses import json_response

from ..common.access import FAHUI_READ_PERMISSION_NAMES
from ..common.session_state import open_session, persist_session
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
    scan_attach_to_board,
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
    merge_print_pdfs,
    preview_merge_print_pdfs,
    quick_search_orders,
    reorder_board_entry,
    update_order_customer,
    update_order_item_fields,
    update_order_item_form_value,
    update_order_status,
)

# prefix 用 settings.api_prefix 拼而不是写死 "/board_router"：api_prefix 今天是空串，
# 留着是为了需要时能整体把 /api 加回来。
router = APIRouter(prefix=f"{settings.api_prefix}/board_router", tags=["fahui-board"])

# 对应 Flask 的 ``request.get_json(silent=True) or {}``。
_JSON_BODY = Body(default=None)


def _int_arg(raw, default=None):
    """对应 Flask 的 ``request.args.get(k, default, type=int)``：转不动就当没传。"""
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


@router.get("/print-pdfs/{pdf_id:int}")
@router.get("/get_pdf_data/{pdf_id:int}")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def get_print_pdf_detail_route(pdf_id: int):
    payload, status_code = get_print_pdf_data(pdf_id)
    return json_response(payload, status_code)


@router.delete("/boards/entries/{board_data_id:int}")
@router.delete("/delete_board/{board_data_id:int}")
@permission_required_any("account_edit")
def delete_board_entry_route(board_data_id: int):
    payload, status_code = delete_board_entry(board_data_id)
    return json_response(payload, status_code)


@router.get("/boards")
@router.get("/list_all")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_boards_route(version: Optional[str] = None):
    # ``or None``：Flask 那边是 ``args.get("version", type=str) or None``，
    # 也就是 ``?version=`` （空串）与「不传」等价 —— 都表示「不按版本过滤」。
    return json_response(list_all_boards(version or None))


@router.get("/print-pdfs/unattached")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_unattached_print_pdfs_route(
    version: Optional[str] = None, page: str = "", per_page: str = ""
):
    return json_response(
        list_unattached_print_pdfs(version, _int_arg(page, 1), _int_arg(per_page, 12))
    )


@router.get("/print-pdfs/history")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_print_pdf_history_route(
    version: Optional[str] = None, page: str = "", per_page: str = ""
):
    return json_response(
        list_print_pdf_history(version, _int_arg(page, 1), _int_arg(per_page, 20))
    )


@router.post("/print-pdfs/unattached/clear")
@permission_required_any("account_edit")
def clear_unattached_print_pdfs_route(payload: Optional[dict] = _JSON_BODY):
    result, status_code = clear_unattached_print_pdfs((payload or {}).get("version"))
    return json_response(result, status_code)


@router.post("/terminal-link")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def create_board_terminal_link_route():
    token, expires_in = get_or_create_terminal_token(current_user.id)
    return json_response({"status": "success", "token": token, "expires_in": expires_in})


@router.get("/terminal/boards")
def board_terminal_boards_route(token: str = "", version: Optional[str] = None):
    # 终端页公开入口：token 有效即返回大板数据，并给 session 打标以放行牌位预览图。
    user_id = resolve_terminal_token(token)
    if not user_id:
        return json_response(
            {"status": "error", "message": "链接不存在或已过期，请在看板页重新复制终端链接"}, 404
        )

    # ★ 会话快照要在 grant 之前取，出口再 persist —— 少了这一步，终端页能打开，
    #   但页面里的牌位预览图全是 403（那些图靠 session 标记放行）。
    #   详见 common/session_state.py 的模块头。
    session, snapshot = open_session()
    grant_terminal_session()
    from .shared import active_order_version

    resolved_version = version or active_order_version()
    payload = list_all_boards(resolved_version)
    payload.update({"status": "success", "room": terminal_room(user_id), "version": resolved_version})
    return persist_session(json_response(payload), session, snapshot)


@router.post("/terminal/highlight")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def board_terminal_highlight_route(payload: Optional[dict] = _JSON_BODY):
    # CRM 查板点击订单后，把点亮指令广播到自己的终端房间。
    # 见模块头「出向推送」：publish_sync 返回 False = 发不出去，对应原来的 except 分支。
    if not publish_sync(
        REALTIME_APP, terminal_room(current_user.id), "fahui:board_highlight", payload or {}
    ):
        return json_response({"success": False, "message": "广播失败"}, 500)
    return json_response({"success": True})


@router.post("/boards")
@permission_required_any("account_edit")
def create_board_route(payload: Optional[dict] = _JSON_BODY):
    body, status_code = create_board(payload or {})
    return json_response(body, status_code)


@router.post("/boards/{board_id:int}")
@permission_required_any("account_edit")
def update_board_route(board_id: int, payload: Optional[dict] = _JSON_BODY):
    body, status_code = update_board(board_id, payload or {})
    return json_response(body, status_code)


@router.delete("/boards/{board_id:int}")
@permission_required_any("account_edit")
def delete_board_header_route(board_id: int):
    payload, status_code = delete_board_header(board_id)
    return json_response(payload, status_code)


@router.post("/print-pdfs/merge/preview")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def preview_merge_print_pdfs_route(payload: Optional[dict] = _JSON_BODY):
    body, status_code = preview_merge_print_pdfs(payload or {})
    return json_response(body, status_code)


@router.post("/print-pdfs/merge")
@permission_required_any("account_edit")
def merge_print_pdfs_route(payload: Optional[dict] = _JSON_BODY):
    body, status_code = merge_print_pdfs(payload or {})
    return json_response(body, status_code)


@router.post("/print-pdfs/reset")
@permission_required_any("account_edit")
def reset_year_barcodes_route(payload: Optional[dict] = _JSON_BODY):
    body, status_code = reset_year_barcodes((payload or {}).get("version"))
    return json_response(body, status_code)


@router.post("/boards/entries/reorder")
@router.post("/insert_pdf")
@permission_required_any("account_edit")
def reorder_board_entry_route(payload: Optional[dict] = _JSON_BODY):
    body, status_code = reorder_board_entry(payload or {})
    return json_response(body, status_code)


@router.post("/boards/entries")
@router.post("/add_pdf")
@permission_required_any("account_edit")
def attach_pdf_to_board_route(payload: Optional[dict] = _JSON_BODY):
    body, status_code = attach_pdf_to_board(payload or {})
    return json_response(body, status_code)


@router.post("/boards/scan")
@permission_required_any("account_edit")
def scan_attach_to_board_route(payload: Optional[dict] = _JSON_BODY):
    body, status_code = scan_attach_to_board(payload or {})
    return json_response(body, status_code)


@router.post("/print-pdfs/clear")
# ⚠️ 旧别名 ``/clear_print_pdf`` 是 **GET**，不是笔误：那是个「点一下就清空」的
#    老链接，照搬（改成 POST 会让还在用它的页面静默失效）。
@router.get("/clear_print_pdf")
@permission_required_any("account_edit")
def clear_print_pdfs_route():
    payload, status_code = clear_print_pdf_records()
    return json_response(payload, status_code)


@router.get("/print-pdfs")
@router.get("/get_all_print_data")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_print_pdfs_route():
    return json_response(list_print_pdf_records(), 200)


@router.get("/versions")
@router.get("/get_version_list")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_versions_route():
    return json_response(list_versions())


@router.get("/orders")
@router.get("/get_orders_data")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_orders_route(version: str = "2024_YLP"):
    # 原式是 ``request.args.get("version", "2024_YLP")``：**没有** type=str，
    # 所以 ``?version=`` （空串）会原样传进去（不是回落到默认值）。照搬。
    return json_response(list_orders_by_version(version))


@router.post("/orders/{order_id:int}/customer")
@router.post("/update_customer/{order_id:int}")
def update_order_customer_route(order_id: int, payload: Optional[dict] = _JSON_BODY):
    # 公开访客只能改「已验证手机号」名下的订单；管理端需法会读权限。
    from ..common.access import can_access_phone_records, has_fahui_read, owner_or_reader_denied
    from backend.models.fahui import FahuiOrder

    if not has_fahui_read():
        order = FahuiOrder.query.get(order_id)
        if order is None:
            return json_response({"status": "error", "message": "order not found"}, 404)
        if not can_access_phone_records(order.phone):
            return owner_or_reader_denied()
    body, status_code = update_order_customer(order_id, payload or {})
    return json_response(body, status_code)


@router.get("/orders/{order_id:int}/logs")
def list_order_logs_route(order_id: int):
    """订单改动记录。权限和看订单详情一致：后台有法会读权限，
    公开访客只能看自己已验证手机号名下的订单。"""
    from backend.models.fahui import FahuiOrder
    from .order_log import list_order_logs
    from .services import user_can_view_order

    order = FahuiOrder.query.get(order_id)
    if order is None:
        return json_response({"status": "error", "message": "订单不存在"}, 404)
    if not user_can_view_order(order):
        return json_response({"status": "error", "message": "未登录或没有权限查看此订单"}, 403)

    return json_response({"status": "success", "data": list_order_logs(order_id)}, 200)


@router.post("/orders/{order_id:int}/status")
@permission_required_any("account_edit")
def update_order_status_route(order_id: int, payload: Optional[dict] = _JSON_BODY):
    body, status_code = update_order_status(order_id, payload or {})
    return json_response(body, status_code)


@router.get("/payment-channels")
def list_payment_channels_route(version: Optional[str] = None):
    # 公开可读：付款页需要向报名者展示收款方式（扫码/银行）。
    payload, status_code = list_payment_channels(version)
    return json_response(payload, status_code)


@router.post("/payment-channels")
@permission_required_any("account_edit")
def create_payment_channel_route(parsed=Depends(form_and_files)):
    form, files = parsed
    payload, status_code = create_payment_channel(form, files)
    return json_response(payload, status_code)


@router.post("/payment-channels/{channel_id:int}")
@permission_required_any("account_edit")
def update_payment_channel_route(channel_id: int, parsed=Depends(form_and_files)):
    form, files = parsed
    payload, status_code = update_payment_channel(channel_id, form, files)
    return json_response(payload, status_code)


@router.delete("/payment-channels/{channel_id:int}")
@permission_required_any("account_edit")
def delete_payment_channel_route(channel_id: int):
    payload, status_code = delete_payment_channel(channel_id)
    return json_response(payload, status_code)


@router.get("/relation-options")
def list_relation_options_route():
    # 公开可读：填写牌位时需要下拉选择超度亡灵的关系。
    payload, status_code = list_relation_options()
    return json_response(payload, status_code)


@router.post("/relation-options")
@permission_required_any("account_edit")
def create_relation_option_route(payload: Optional[dict] = _JSON_BODY):
    body, status_code = create_relation_option(payload or {})
    return json_response(body, status_code)


@router.post("/relation-options/import")
@permission_required_any("account_edit")
def import_relation_options_route():
    payload, status_code = import_relation_options_from_history()
    return json_response(payload, status_code)


@router.delete("/relation-options/{option_id:int}")
@permission_required_any("account_edit")
def delete_relation_option_route(option_id: int):
    payload, status_code = delete_relation_option(option_id)
    return json_response(payload, status_code)


@router.get("/orders/detail")
@router.get("/get_order_detail")
def get_order_detail_route(id: str = ""):  # noqa: A002 - 查询参数名就叫 id，照搬
    # ``args.get("id", type=int)``：转不动就当没传（None），服务层据此回 400。
    payload, status_code = get_board_order_detail(_int_arg(id))
    return json_response(payload, status_code)


@router.get("/orders/check-duplicate-owner-fields")
@router.get("/check_duplicate_owner_fields")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def check_duplicate_order_owner_fields_route():
    return json_response(check_duplicate_owner_fields())


@router.post("/orders/quick-search")
@router.post("/fahui_search_emgine")
def quick_search_orders_route(payload: Optional[dict] = _JSON_BODY):
    # ⚠️ ``fahui_search_emgine`` 是线上真实存在的拼写错误（engine → emgine），
    #    还有前端在请求它。不要顺手改对。
    body = payload or {}
    return json_response(quick_search_orders(body.get("keyword"), body.get("version")))


@router.post("/orders/{order_id:int}/items")
@router.post("/add_paiwei/{order_id:int}")
def create_order_item_route(order_id: int, payload: Optional[dict] = _JSON_BODY):
    body, status_code = create_order_item(order_id, payload or {})
    return json_response(body, status_code)


@router.post("/orders/{order_id:int}/items/{item_id:int}")
def update_order_item_route(order_id: int, item_id: int, payload: Optional[dict] = _JSON_BODY):
    # order_id 只用于凑出这条 URL 的形状，业务上不参与（改的是 item 自己的字段）。
    # 原文件在这里写的是 ``del order_id``，效果一样，这里留注释说明即可。
    body, status_code = update_order_item_fields(item_id, payload or {})
    return json_response(body, status_code)


@router.delete("/orders/{order_id:int}/items/{item_id:int}")
# ⚠️ 旧别名的两个路径参数是**反过来**的（先 item_id 后 order_id）。
#    FastAPI 按**名字**注入，所以同一个函数能同时吃下两种顺序 —— 照搬，别对齐。
@router.delete("/delete_item/{item_id:int}/{order_id:int}")
def delete_order_item_route(item_id: int, order_id: int):
    payload, status_code = delete_order_item(item_id, order_id)
    return json_response(payload, status_code)


@router.post("/orders/delete")
@router.post("/delete_orders")
@permission_required_any("account_edit")
def delete_order_batch_route(payload: Optional[dict] = _JSON_BODY):
    body, status_code = delete_order_batch(payload or {})
    return json_response(body, status_code)


@router.post("/orders/clone")
@router.post("/copy_old_data")
@permission_required_any("account_edit")
def clone_orders_route(payload: Optional[dict] = _JSON_BODY):
    body, status_code = clone_order_to_version(payload or {})
    return json_response(body, status_code)


@router.post("/orders/copy-to-current")
@permission_required_any("account_edit")
def copy_orders_to_current_route(payload: Optional[dict] = _JSON_BODY):
    body, status_code = copy_orders_to_current(payload or {})
    return json_response(body, status_code)


@router.post("/item-form-values")
@router.post("/update_item_form_value")
def update_order_item_form_value_route(payload: Optional[dict] = _JSON_BODY):
    body, status_code = update_order_item_form_value(payload or {})
    return json_response(body, status_code)
