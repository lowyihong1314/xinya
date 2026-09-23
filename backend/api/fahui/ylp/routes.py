"""YLP 订单主接口：搜索 / 详情 / 建单 / 导出 / 分享链接 / 原始单据 / 版本绑定。

原 backend/app/fahui/YLP/routes.py（Flask Blueprint ``fahui_router``，挂在
``{API_PREFIX}/fahui_router``）。只做框架适配：装饰器、参数提取、响应构造。
校验顺序、状态码、中文文案、响应体的键名与嵌套形状全部逐字照搬 ——
CRM 订单页、公开登记页、分享页三处前端都在按这些键和 message 分支。

── URL 对照（旧 → 新）────────────────────────────────────────────────
``/api`` 这一段整体去掉了，其余路径一个字符没动（规范路径 + 旧别名一起搬，
见 app/fahui/route_contracts.py 的 ylp_orders 组）：

    /api/fahui_router/orders/search | /search          → /fahui_router/orders/search | /search
    /api/fahui_router/orders/export                    → /fahui_router/orders/export
    /api/fahui_router/orders/export-pdf                → /fahui_router/orders/export-pdf
    /api/fahui_router/orders/<id>/share-link           → /fahui_router/orders/{order_id:int}/share-link
    /api/fahui_router/orders/shared                    → /fahui_router/orders/shared
    /api/fahui_router/orders/<id> | /get_order_by_id   → /fahui_router/orders/{order_id:int} | /get_order_by_id
    /api/fahui_router/orders/by-phone | /get_orders_by_phone → 同名
    /api/fahui_router/orders | /new_customer           → /fahui_router/orders | /new_customer
    /api/fahui_router/open_windows[/<id>]              → /fahui_router/open_windows[/{window_id:int}]
    /api/fahui_router/versions | /get_versions         → 同名
    /api/fahui_router/raw_docs*                        → 同名
    /api/fahui_router/versions/bindings                → 同名
    /api/fahui_router/versions/<path:version>/event    → /fahui_router/versions/{version:path}/event

★ **路由声明顺序照抄 Flask 原文件**，没有重排。``/orders/search``、
  ``/orders/export``、``/orders/shared``、``/orders/by-phone`` 这些具名路径和
  ``/orders/{order_id:int}`` 共处一个命名空间，靠的是 Starlette 的 ``:int``
  转换器在**匹配阶段**就只认数字（不是靠声明顺序）。保持原顺序只是第二道保险 ——
  谁以后把转换器删了，``/orders/by-phone`` 会立刻被 ``{order_id}`` 吃掉并回 422。
  同理 ``/versions/bindings`` 与 ``/versions/{version:path}/event``：后者要求
  路径以 ``/event`` 结尾，两者不可能撞。

── 四条搬迁硬约束 ────────────────────────────────────────────────────
  ① 本文件**不能写 ``from __future__ import annotations``**（core.auth 的装饰器
     用 functools.wraps 包过，FastAPI 会去 core/auth.py 的命名空间求值注解 → NameError）。
  ② 路由函数一律 ``def``（同步）：底下是同步 ORM / reportlab / 文件 IO / BytePlus
     读图，写成 async def 会把 worker 的事件循环焊死。
  ③ 装饰器顺序保持 Flask 原样：``@login_required`` 在外、``@permission_required_any``
     在内（本文件那几条 raw_docs 写操作就是这么叠的）。
  ④ 路径参数写 ``{order_id:int}`` / ``{version:path}``（Starlette 转换器），
     不是只靠类型注解。

── 查询参数：为什么全声明成 ``str`` 再手工 int() ─────────────────────
Flask 的 ``request.args.get(k, default, type=int)`` 是「**转不动就当没传**」
（静默回 default）。声明成 ``int`` 会让 ``?page=abc`` 从「按第 1 页查」变成 422。
见下面的 ``_int_arg``。至于 ``type=str`` 的那些：缺参数时 Flask 给的是
``default``，所以 ``version`` 是 ``Optional[str] = None``（后面要判 ``is None``），
而 ``value`` / ``phone`` / ``token`` 这些是 ``str = ""``。

── 「看着像 bug、故意保留」───────────────────────────────────────────
  · ``GET /orders/shared`` 与 ``GET /versions`` 是**完全公开**的（前者靠 token，
    后者连 token 都不要）。route_contracts.py 的匿名自检里就写着
    ``ylp_versions → 200``。
  · ``GET /orders/{id}`` 与 ``/orders/by-phone`` 没有装饰器，鉴权在函数体里：
    管理权限放行，否则只能读「已验证手机号」名下的订单。403 文案含「手机验证」
    四个字，公开页前端靠它识别并重新弹验证框 —— 换成 core.auth 的装饰器
    就等于换掉那句话。
  · ``POST /orders``（建单）对**已登录用户不看开放时间**，只拦匿名提交。
  · raw_docs 的读操作只要 ``permission_required_any``，写操作却额外叠了
    ``@login_required``。多余（permission_required_any 内部已经先判登录），
    但照搬 —— 叠了不改变任何可观察行为。
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, Query, Request

from backend.api.fahui.downloads import send_file
from backend.api.fahui.uploads import form_and_files
from backend.core.auth import current_user, login_required, permission_required_any
from backend.core.config import settings
from backend.core.responses import json_response

from ..common import open_window as open_window_services
from ..common.access import (
    FAHUI_READ_PERMISSION_NAMES,
    can_access_phone_records,
    has_fahui_read,
    owner_or_reader_denied,
)
from ..common.session_state import open_session, persist_session
from .services import (
    create_order_shell,
    get_order_detail,
    get_orders_by_phone,
    get_version_event_binding,
    list_available_versions,
    list_version_event_bindings,
    set_version_event_binding,
    list_orders_for_export,
    search_orders,
)
from .export_pdf import build_orders_pdf
from .raw_docs import (
    link_raw_docs_to_orders,
    list_raw_docs,
    raw_doc_file_response,
    save_uploaded_raw_docs,
    set_raw_doc_flag_resolved,
    suggest_old_orders,
    sync_raw_docs_from_disk,
    update_raw_doc_link,
)
from .share_link import get_or_create_share_token, grant_session_phone, resolve_share_token

# prefix 用 settings.api_prefix 拼而不是写死 "/fahui_router"：api_prefix 今天是空串，
# 留着是为了需要时能整体把 /api 加回来 —— 写死的话那次改配置只会改到一半。
router = APIRouter(prefix=f"{settings.api_prefix}/fahui_router", tags=["fahui"])

# 对应 Flask 的 ``request.get_json(silent=True) or {}``（原文件里的 ``_json_payload()``）。
# 不带 embed，前端发什么形状进来就是什么形状；没有 body / body 是 null 时落到 None，
# 路由里 ``payload or {}`` 补成空字典。
_JSON_BODY = Body(default=None)


def _int_arg(raw, default=None):
    """对应 Flask 的 ``request.args.get(k, default, type=int)``。

    关键是「转不动就当没传」：空串、``abc``、``12.5`` 全部静默回 default。
    ``"0"`` 要转成 0 而不是 default —— 那样 ``?page=0`` 拿到的就是 0，
    和 Flask 一致（search_orders 里再 ``max(1, ...)`` 兜回第 1 页）。
    """
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


# --------------------------------------------------------------------------- #
# 订单搜索 / 导出
# --------------------------------------------------------------------------- #
@router.get("/orders/search")
@router.get("/search")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def search_orders_route(
    version: Optional[str] = None,
    value: str = "",
    page: str = "",
    per_page: str = "",
    sort: Optional[str] = None,
    # Flask 那边这个参数叫 ``dir``；用 alias 保住查询串里的名字，
    # 同时避免在函数里定义一个叫 dir 的局部变量遮住内建函数。
    direction: Optional[str] = Query(default=None, alias="dir"),
):
    page_num = _int_arg(page, 1)
    per_page_num = _int_arg(per_page, 20)

    # ``version is None`` 而不是 ``not version``：``?version=`` （空串）要能走进
    # search_orders，由它的 normalize_version 判成空再抛 ValueError → 同一句 400。
    # 两条路最终文案相同，但状态码来源不同，照搬原写法。
    if version is None:
        return json_response({"status": "error", "message": "version is required"}, 400)

    try:
        result = search_orders(
            version=version,
            value=value,
            page_num=page_num,
            per_page=per_page_num,
            sort=sort,
            direction=direction,
        )
    except ValueError as exc:
        return json_response({"status": "error", "message": str(exc)}, 400)

    return json_response({"status": "success", "data": result})


@router.get("/orders/export")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def export_orders_route(version: Optional[str] = None, value: str = ""):
    if version is None:
        return json_response({"status": "error", "message": "version is required"}, 400)
    try:
        result = list_orders_for_export(version=version, value=value)
    except ValueError as exc:
        return json_response({"status": "error", "message": str(exc)}, 400)
    return json_response({"status": "success", "data": result})


@router.post("/orders/export-pdf")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def export_orders_pdf_route(payload: Optional[dict] = _JSON_BODY):
    """牌位清单 PDF：和 /orders/export 同一份数据，只是排成按类型分段的表格。

    order_ids 为空 = 整个版本（配合搜索条件），传了就只印这几张单，
    对上列表页「勾选几条 / 全选所有页」两种选法。
    """
    payload = payload or {}
    version = payload.get("version")
    if version is None:
        return json_response({"status": "error", "message": "version is required"}, 400)

    try:
        result = list_orders_for_export(version=version, value=str(payload.get("value") or ""))
    except ValueError as exc:
        return json_response({"status": "error", "message": str(exc)}, 400)

    orders = result.get("items") or []
    wanted = {int(oid) for oid in (payload.get("order_ids") or []) if str(oid).isdigit()}
    if wanted:
        orders = [order for order in orders if order.get("id") in wanted]

    version_label = str(version)
    output = build_orders_pdf(orders, version=version_label)
    # ★ 文件名带中文。downloads.send_file 会按 werkzeug 的规则拼出
    #   ``attachment; filename=_2024_YLP.pdf; filename*=UTF-8''%E7%89%8C…``
    #   —— 两段都要有，少了 filename* 那一段浏览器存下来就是 ``_2024_YLP.pdf``。
    return send_file(
        output,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"牌位清单_{version_label}.pdf",
    )


# --------------------------------------------------------------------------- #
# 分享链接
# --------------------------------------------------------------------------- #
@router.post("/orders/{order_id:int}/share-link")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def create_share_link_route(order_id: int):
    from backend.models.fahui import FahuiOrder

    if FahuiOrder.query.get(order_id) is None:
        return json_response({"status": "error", "message": "order not found"}, 404)

    token, expires_in = get_or_create_share_token(order_id)
    return json_response({"status": "success", "token": token, "expires_in": expires_in})


@router.get("/orders/shared")
def shared_order_route(token: str = ""):
    # 公开只读入口：token 有效即放行（同时给 session 授已验证手机号，
    # 让后续的牌位预览等接口也能按订单主人访问）。
    order_id = resolve_share_token(token)
    if not order_id:
        return json_response(
            {"status": "error", "message": "链接不存在或已过期，请联系工作人员重新获取"}, 404
        )

    from backend.models.fahui import FahuiOrder

    order = FahuiOrder.query.get(order_id)
    if order is None:
        return json_response({"status": "error", "message": "订单不存在"}, 404)

    # ★ 这两行是 Flask 的 ``session[...] = ...`` + 响应时自动回写 Cookie 在 FastAPI
    #   下的等价物。少了 persist_session，访客点开分享链接当场能看、一刷新又变成
    #   「请先完成手机验证」—— 详见 common/session_state.py 的模块头。
    #   快照要在 grant 之前取，否则比出来永远「没变」。
    session, snapshot = open_session()
    grant_session_phone(order.phone)
    payload, status_code = get_order_detail(order_id)
    return persist_session(json_response(payload, status_code), session, snapshot)


# --------------------------------------------------------------------------- #
# 订单详情 / 按手机号查单 / 建单
# --------------------------------------------------------------------------- #
def _order_detail_response(order_id):
    """``get_order_detail_route`` 的函数体，两条路由共用（见下面那条注释）。"""
    if not order_id:
        return json_response({"status": "error", "message": "order_id is required"}, 400)

    # 管理权限放行；公开访客只能读「已验证手机号」名下的订单。
    if not has_fahui_read():
        from backend.models.fahui import FahuiOrder

        order = FahuiOrder.query.get(order_id)
        if order is None:
            return json_response({"status": "error", "message": "order not found"}, 404)
        if not can_access_phone_records(order.phone):
            return owner_or_reader_denied()

    payload, status_code = get_order_detail(order_id)
    return json_response(payload, status_code)


# ★ Flask 那边是**一个**视图函数挂了两条规则（``/orders/<int:order_id>`` 和
#   ``/get_order_by_id``），靠 ``order_id or request.args.get(...)`` 兼顾两种取法。
#   FastAPI 里两条路由的参数签名不一样（一个有路径参数、一个没有），没法叠在
#   同一个函数上，所以拆成两条、共用上面那个 ``_order_detail_response``。
#   **那句 ``or`` 的语义原样保留**：路径参数为 0 时（``/orders/0``，``<int:>`` 是
#   认这个值的）会继续往下看查询参数 —— 看着像 bug，但它就是原行为。
@router.get("/orders/{order_id:int}")
def get_order_detail_route(
    order_id: int,
    order_id_arg: Optional[str] = Query(default=None, alias="order_id"),
    id_arg: Optional[str] = Query(default=None, alias="id"),
):
    resolved = order_id or _int_arg(order_id_arg) or _int_arg(id_arg)
    return _order_detail_response(resolved)


@router.get("/get_order_by_id")
def get_order_by_id_route(
    order_id_arg: Optional[str] = Query(default=None, alias="order_id"),
    id_arg: Optional[str] = Query(default=None, alias="id"),
):
    resolved = _int_arg(order_id_arg) or _int_arg(id_arg)
    return _order_detail_response(resolved)


@router.get("/orders/by-phone")
@router.get("/get_orders_by_phone")
def list_orders_by_phone_route(phone: str = ""):
    if not can_access_phone_records(phone):
        return owner_or_reader_denied()
    payload, status_code = get_orders_by_phone(phone)
    return json_response(payload, status_code)


@router.post("/orders")
@router.post("/new_customer")
def create_order_route(payload: Optional[dict] = _JSON_BODY):
    # 开放时间之外拒绝公开报名；已登录用户（CRM 后台）不受限制。
    if not current_user.is_authenticated and not open_window_services.is_open("ylp"):
        return json_response({"status": "error", "message": "盂兰盆法会牌位登记目前未开放"}, 403)
    body, status_code = create_order_shell(payload or {})
    return json_response(body, status_code)


# --------------------------------------------------------------------------- #
# 报名开放时间
# --------------------------------------------------------------------------- #
@router.get("/open_windows")
def list_open_windows_route(key: str = ""):
    try:
        # 不带 key 时返回全部法会的开放状态（公开页用来找「当前开放的法会」）。
        result = open_window_services.list_windows(key) if key else open_window_services.list_all_status()
    except ValueError as exc:
        return json_response({"status": "error", "message": str(exc)}, 400)
    return json_response({"status": "success", "data": result})


@router.post("/open_windows")
@permission_required_any("account_edit")
def create_open_window_route(payload: Optional[dict] = _JSON_BODY):
    try:
        result = open_window_services.create_window(payload or {})
    except ValueError as exc:
        return json_response({"status": "error", "message": str(exc)}, 400)
    return json_response({"status": "success", "data": result})


@router.delete("/open_windows/{window_id:int}")
@permission_required_any("account_edit")
def delete_open_window_route(window_id: int):
    try:
        open_window_services.delete_window(window_id)
    except ValueError as exc:
        return json_response({"status": "error", "message": str(exc)}, 400)
    return json_response({"status": "success"})


# --------------------------------------------------------------------------- #
# 版本清单
# --------------------------------------------------------------------------- #
@router.get("/versions")
@router.get("/get_versions")
def list_versions_route():
    # 完全公开（route_contracts.py 的匿名自检里写着 ylp_versions → 200）。
    return json_response({"status": "success", "data": list_available_versions()})


# --------------------------------------------------------------------------- #
# 原始单据（手写登记单的存档图）
# --------------------------------------------------------------------------- #
@router.get("/raw_docs")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_raw_docs_route():
    return json_response({"status": "success", "data": list_raw_docs()})


@router.get("/raw_docs/file/{filename:path}")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def raw_doc_file_route(filename: str, request: Request):
    # 单据上有姓名与电话，不走公开的 /media_file，这里带权限地送出去
    # （request 只是拿来判 304，见 raw_docs.py 的模块头）。
    response = raw_doc_file_response(filename, request=request)
    if response is None:
        return json_response({"status": "error", "message": "文件不存在"}, 404)
    return response


@router.post("/raw_docs/{doc_id:int}/link")
@login_required
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def update_raw_doc_link_route(doc_id: int, payload: Optional[dict] = _JSON_BODY):
    body = payload or {}
    try:
        data = update_raw_doc_link(doc_id, body.get("order_id"), (body.get("action") or "").strip())
    except ValueError as exc:
        return json_response({"status": "error", "message": str(exc)}, 400)
    if data is None:
        return json_response({"status": "error", "message": "单据不存在"}, 404)
    return json_response({"status": "success", "data": data})


@router.post("/raw_docs/{doc_id:int}/flag")
@login_required
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def update_raw_doc_flag_route(doc_id: int, payload: Optional[dict] = _JSON_BODY):
    body = payload or {}
    try:
        data = set_raw_doc_flag_resolved(
            doc_id, body.get("flag_id"), bool(body.get("resolved")), current_user
        )
    except ValueError as exc:
        return json_response({"status": "error", "message": str(exc)}, 400)
    if data is None:
        return json_response({"status": "error", "message": "单据不存在"}, 404)
    return json_response({"status": "success", "data": data})


@router.post("/raw_docs/{doc_id:int}/suggest_old")
@login_required
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def suggest_old_orders_route(doc_id: int, payload: Optional[dict] = _JSON_BODY):
    body = payload or {}
    use_ocr = body.get("use_ocr")
    # 缺这个键 = 默认跑 OCR；显式给了才按它的真值走。``None`` 与 ``false`` 不等价。
    data = suggest_old_orders(doc_id, use_ocr=True if use_ocr is None else bool(use_ocr))
    if data is None:
        return json_response({"status": "error", "message": "单据不存在"}, 404)
    return json_response({"status": "success", "data": data})


@router.post("/raw_docs/upload")
@login_required
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def upload_raw_docs_route(parsed=Depends(form_and_files)):
    _form, files = parsed
    # 两个字段名都认（前端历史上两种都发过）。``or`` 的语义照搬：
    # files 字段**存在但为空**时才退到 file 字段。
    uploads = files.getlist("files") or files.getlist("file")
    if not uploads:
        return json_response({"status": "error", "message": "没有收到文件"}, 400)
    return json_response({"status": "success", "data": save_uploaded_raw_docs(uploads)})


@router.post("/raw_docs/sync")
@login_required
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def sync_raw_docs_route(payload: Optional[dict] = _JSON_BODY):
    """重新扫描存档目录并重算与订单的对应（手动挂的关联不会被覆盖）。"""
    body = payload or {}
    version = (body.get("version") or "").strip() or f"{datetime.now().year}_YLP"
    synced = sync_raw_docs_from_disk()
    linked = link_raw_docs_to_orders(version)
    return json_response(
        {"status": "success", "data": {"synced": synced, "linked": linked, "version": version}}
    )


# --------------------------------------------------------------------------- #
# 版本 ↔ 活动绑定
# --------------------------------------------------------------------------- #
@router.get("/versions/bindings")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_version_bindings_route(workspace: str = "ylp"):
    return json_response({"status": "success", "data": list_version_event_bindings(workspace)})


@router.get("/versions/{version:path}/event")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def get_version_event_route(version: str, workspace: str = "ylp"):
    return json_response({"status": "success", "data": get_version_event_binding(version, workspace)})


@router.put("/versions/{version:path}/event")
@router.post("/versions/{version:path}/event")
@login_required
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def set_version_event_route(version: str, payload: Optional[dict] = _JSON_BODY):
    body = payload or {}
    workspace = body.get("workspace") or "ylp"
    try:
        data = set_version_event_binding(version, body.get("event_id"), workspace)
    except ValueError as exc:
        return json_response({"status": "error", "message": str(exc)}, 400)
    return json_response({"status": "success", "data": data})
