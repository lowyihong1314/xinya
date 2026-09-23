"""公共只读接口（原 app/public_api/routes.py）。

这个模块是历史上的「杂物抽屉」：几个不值得单独开包的公开读接口。搬过来时
**只改框架适配，业务逻辑逐行照抄**。

── URL 对照（旧 → 新）────────────────────────────────────────────────
    /api/api/ping                  →  /ping
    /api/api/get_event/<id>        →  /event_data/{event_id}     ★ 改名了
    /api/api/get_file_data/<id>    →  /get_file_data/{file_id}
    /api/api/forms                 →  /forms
    /api/api/members               →  /members
    /api/api/payments              →  /payments

旧路径里那个 ``/api/api`` 是撞出来的：全局 ``API_PREFIX="/api"`` 再加上蓝图自己
注册时的 ``url_prefix="/api"``（见 app/blueprints.py 第 10 行）。v3 里 BASE_PATH
（/UTBA_DEMO）已经把项目区分开了，``/api`` 这一段不带任何信息量，所以两段一起去掉，
本路由器**不设 prefix**。

get_event 顺手改名成 ``/event_data/{id}``：它读的就是 EventData，和 app/event 那个
``/event_data/*`` 模块是同一份数据，放在一起比留个 ``/get_event`` 在根目录合理。
⚠️ 前端有两处调用点要跟着改（迁移收口时一起做，不在本文件范围内）：
    frontend/src/event/shared/api.ts:38        /api/api/get_event/${eventId}
    frontend/src/router/appRouter.tsx:78       /api/api/get_file_data/${imageId}

── 为什么路径参数写成 ``{event_id:int}`` 而不是靠类型注解 ──────────────────
两个原因，都是行为问题不是风格问题：
  ① Flask 的 ``<int:event_id>`` 在参数不是整数时是**不匹配**（→ 404）；
     FastAPI 靠注解转换的话非整数会变成 **422**，前端的 404 分支会失效。
  ② ``/event_data/{event_id}`` 和 app/event 的 ``/event_data/get_all_event`` 这类
     具名路径同处一个命名空间。用 ``:int`` 转换器时 Starlette 在**路由匹配**阶段就
     只认数字，两边谁先注册都不会抢走对方的请求（已实测）；写成注解转换的话，
     本路由器只要先注册，``/event_data/get_all_event`` 就会被吃掉并回 422。
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from starlette.responses import PlainTextResponse

from core.auth import current_user, permission_required
from core.responses import json_response
from models.event_data import AlbumFiles, EventData
from models.form import NRIC_Asset, RegisForm, RegisPayment

# prefix 为空：见模块头「/api/api 是撞出来的」。
# 路由函数一律 def（同步）—— 里面全是同步 ORM 查询，写成 async 会堵死 worker 的事件循环，
# FastAPI 会自动把 def 路由丢进线程池。
router = APIRouter(tags=["public_api"])


@router.get("/ping")
def ping():
    """存活探针（比 /healthz 早，前端/运维可能还在打它）。

    ⚠️ 与 Flask 的一处差异：Flask 里 ``return "pong"`` 发的是
    ``text/html; charset=utf-8``，这里是 ``text/plain``。正文一个字节没变。
    不用 return "pong"：那样 FastAPI 会序列化成 JSON 字符串 ``"pong"``（带引号）。
    """
    return PlainTextResponse("pong")


@router.get("/event_data/{event_id:int}")
def get_event(event_id: int, request: Request):
    """活动详情（公开页 / 分享页在用）。

    参数取用方式与 Flask 版逐字对应：``request.args.get`` → ``request.query_params.get``
    （两者都是「同名参数取第一个」，语义一致）。visitor_token 不声明成 Query 参数，
    是因为它要和 X-Visitor-Token 请求头走同一套 strip/截断逻辑，拆成两处反而容易漂移。
    """
    event = EventData.query.get_or_404(event_id)
    # 未公开的活动对访客等于不存在（回 404 而不是 403：别让链接本身泄露有这么个活动）
    if not event.is_public and not current_user.is_authenticated:
        # 原来是 `return jsonify(...), 404` 的元组写法，FastAPI 不认元组，改成显式造响应。
        # 响应体一字未动 —— 前端在按 message 分支。
        return json_response({"status": "error", "message": "活动不存在"}, status_code=404)

    # 访客的爱心认浏览器里的 visitor_token，登录的认账号
    viewer_user_id = getattr(current_user, "id", None) if current_user.is_authenticated else None
    viewer_token = None
    if not viewer_user_id:
        viewer_token = (
            request.query_params.get("visitor_token")
            or request.headers.get("X-Visitor-Token")
            or ""
        ).strip()[:64] or None
    data = event.to_dict_full(viewer_user_id=viewer_user_id, viewer_token=viewer_token)
    # 公开接口：非登陆用户隐藏「仅登陆可见」的环节。
    if not current_user.is_authenticated:
        data["event_flows"] = [f for f in (data.get("event_flows") or []) if not f.get("login_only")]
    data["login"] = current_user.is_authenticated
    data["fahui_registration"] = _fahui_registration_for(event)
    return json_response({"status": "success", "data": data})


# 法会工作区 → 公开登记页
_FAHUI_REGISTRATION_ROUTES = {"ylp": "/ylp-registration", "lamp": "/lamp-registration"}
_FAHUI_REGISTRATION_LABELS = {"ylp": "盂兰盆法会 · 牌位登记", "lamp": "点灯法会 · 供灯登记"}


def _fahui_registration_for(event):
    """活动绑定了某个法会版本时，给活动页一个「去登记」的入口。

    绑定关系就是 CRM 法会工作区那条「绑定活动」（fahui_version_event），
    收入也是靠它进活动预算的，这里顺带拿来在活动页挂报名入口。

    （这段原本就住在 app/public_api/routes.py 里 —— 它是路由私有的辅助函数，
      不是 services 层，所以跟着路由一起搬过来，没有可复用的现成模块可以 import。）
    """
    # 保持函数内 import：``app.fahui.common`` 的父包 app/fahui/__init__.py 会去 import
    # YLP 那一堆 Flask 蓝图。提到模块顶层等于让 FastAPI 一启动就把整棵 Flask 路由树拉起来。
    # ⚠️ 也就是说这条路径**现在还依赖 flask 装在环境里**；等 app/fahui 搬完，
    #    这个 import 会自然变干净（open_window 本身只依赖 models，不碰 flask）。
    from app.fahui.common import open_window
    from models.fahui import FahuiVersionEvent

    binding = (
        FahuiVersionEvent.query.filter_by(event_id=event.id)
        .order_by(FahuiVersionEvent.id.desc())
        .first()
    )
    if not binding:
        return None

    workspace = str(binding.workspace or "").strip() or "ylp"
    path = _FAHUI_REGISTRATION_ROUTES.get(workspace)
    if not path:
        return None

    # 登记页永远只写当年，所以往年的活动（例：2025 那场绑的是 2025_YLP）不给入口，
    # 免得访客从旧活动点进去、结果报了今年的名。
    if workspace == "ylp":
        from app.fahui.YLP.shared import active_order_version

        if str(binding.version or "") != active_order_version():
            return None

    try:
        is_open = open_window.is_open(workspace)
    except Exception:  # noqa: BLE001
        is_open = False

    # TODO(迁移后): path 是给前端 SPA 用的裸路径，带 BASE_PATH 的场景应该过一遍
    # core.urls.public_url()。现在不改：前端自己也在拼前缀，两边同时改才不会双重前缀。
    return {
        "workspace": workspace,
        "version": binding.version,
        "path": path,
        "label": _FAHUI_REGISTRATION_LABELS.get(workspace, "法会登记"),
        "is_open": bool(is_open),
    }


@router.get("/get_file_data/{file_id:int}")
def get_file_data(file_id: int):
    """相册单图详情（APK 的旧图片路由会重定向到它）。"""
    file = AlbumFiles.query.get_or_404(file_id)
    event = EventData.query.get(file.event_id) if file.event_id else None

    file_data = file.to_dict()
    file_data["login"] = current_user.is_authenticated
    event_data = event.to_dict() if event else None

    return json_response(
        {
            "status": "success",
            "data": {"file": file_data, "event": event_data},
        }
    )


@router.get("/forms")
@permission_required("member_edit")
def get_forms():
    """报名表格全量导出。

    ★ 用 core.auth 的 ``permission_required``（不是 ``require_permission`` 依赖）：
      这条路由**没有**垫 login_required，所以未登录时的正确行为是 **500**
      + 「无法验证用户权限，请联系管理员。」，不是 401。core/auth.py 契约 2 点名的
      6 条「能真的触发 500 分支」的路由里，public_api 那一条就是它。换成依赖注入
      会把状态码悄悄改成 401，前端分支随之失效。

    TODO(坏代码，本次不改): ``RegisForm.to_dict()`` 的签名是 ``(self, is_public=False)``
      （models/form.py:144），压根没有 ``with_child`` 这个参数 —— 也就是说这条接口
      今天一调用就 TypeError → 500。照搬不重构：先原样搬过来保证行为不变，
      要修得单独一次改动（确认是改成 to_dict(is_public=False) 还是别的意思）。
    """
    forms = RegisForm.query.all()
    return json_response([form.to_dict(with_child=True) for form in forms])


@router.get("/members")
def get_members():
    """会员（NRIC 资产）全量导出。

    TODO(安全，本次不改): 这条和下面的 /payments 都是**不鉴权**的全量导出，
      身份证号、付款记录直接对匿名可见。原样搬过来是为了行为不变，
      加权限要单独评估（谁在调、加了会不会打断现有页面）。
    """
    members = NRIC_Asset.query.all()
    return json_response([member.to_dict() for member in members])


@router.get("/payments")
def get_payments():
    payments = RegisPayment.query.all()
    return json_response([payment.to_dict() for payment in payments])


# ── 接线（由后面的接线 agent 做，本文件不碰 asgi.py）──────────────────────
# asgi.py 里：
#     from api import public_api
#     app.include_router(public_api.router)
#
# 注册顺序与 app/event（/event_data/*）之间**没有**先后要求：本文件的
# /event_data/{event_id:int} 走 Starlette 的 int 转换器，路由匹配阶段就只认数字，
# 不会抢走 /event_data/get_all_event 这类具名路径（已实测）。
