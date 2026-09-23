"""报名表：公开报名页 / CRM 工作台 / 收费 / 分组 / 点名 / 成员终端 / 青少年佛学班。

原 backend/app/form/routes.py（Flask Blueprint ``form_bp``，挂在 ``{API_PREFIX}/form``，
76 条路由 —— 整个项目里最大的单体模块）。本文件只做框架适配：装饰器、参数提取、
响应构造。校验顺序、状态码、中文文案、响应体的键名与嵌套形状全部逐字照搬 ——
公开报名页、付款页、CRM 报名表工作台、成员终端、青少年佛学班工作台五处前端
都在按这些键和 message 分支。

── URL 对照（旧 → 新）────────────────────────────────────────────────
``/api`` 这一段整体去掉了（BASE_PATH 已经区分项目，见 docs/flask_to_fastAPI/11），
``/form`` 保持不变，其余路径一个字符没动。挑几条会踩坑的列在这里，
完整清单就是下面的路由表：

    /api/form/index/<form_id>                     → /form/index/{form_id}        ← **字符串**，不是 int
    /api/form/pay_register/<form_id>              → /form/pay_register/{form_id} ← 同上
    /api/form/event_poster/<int:form_id>/<type>   → /form/event_poster/{form_id:int}/{poster_type}
    /api/form/score_panel/<token>[/data|/adjust]  → /form/score_panel/{token}[...]
    /api/form/payment/<int:payment_id>   (DELETE) → /form/payment/{payment_id:int}
    /api/form/youth-class-registration/...        → /form/youth-class-registration/...

★ ``/index/<form_id>`` 和 ``/pay_register/<form_id>`` 在 Flask 里就**没有** ``int:``
  转换器（是 ``<form_id>``，即 string 转换器）。这里照抄成 ``{form_id}``，
  **不要顺手加 ``:int``** —— 加了之后「非整数 id」会从「进函数体 → get_or_404 →
  PostgreSQL DataError → 500」变成「路由不匹配 → 落到 web 模块的 SPA catch-all →
  返回一坨 HTML」，而调用方会把那坨 HTML 当 JSON 解析。
  （那个 500 是既有行为，Flask + PG 也是它，已实测；详见 service.py 模块头
   「看着像 bug、故意保留」第一条。真要改成 404 是另一件事，别顺手做。）

── 五条搬迁硬约束（违反会启动即失败或线上事故）────────────────────────

  ① 本文件**不能写 ``from __future__ import annotations``**。core.auth 的装饰器用
     functools.wraps 包过，FastAPI 求值注解时用的是 core/auth.py 的命名空间，
     开了这一行会在那里找不到 ``Optional`` 而**启动即 NameError**。

  ② 路由函数一律 ``def``（同步）。底下全是同步 ORM / 文件 IO / Redis / weasyprint /
     subprocess，写成 async def 会把 worker 的事件循环焊死。FastAPI 会自动把 def
     丢线程池。

  ③ 装饰器顺序：``@router.xxx(...)`` 在上、``@login_required`` /
     ``@permission_required_any(...)`` 在下。反过来挂的是一个没被 FastAPI 认出来的
     函数，路由表里会少一条。

  ④ 路径参数写 ``{xxx:int}``（Starlette 转换器），不是只靠 ``: int`` 注解。
     Flask 的 ``<int:xxx>`` 在参数不是整数时是**不匹配** → 404；只靠注解会先匹配
     上再校验失败 → 422，前端的 404 分支会失效。
     这里还额外**靠它分家**（Starlette 先注册先匹配、不回溯）：
       · ``PUT /youth-class-registration/settings`` vs
         ``PUT /youth-class-registration/{entry_id:int}``
       · ``POST /youth-class-registration/council-sign/batch-url`` vs
         ``POST /youth-class-registration/{entry_id:int}/council-sign``
     两对都是「字面量 vs ``\\d+``」，谁先注册都不会互相抢。即便如此，下面仍把
     **字面量那条写在前面**当第二道保险 —— 谁以后把 ``:int`` 删了也不会立刻出事。

  ⑤ prefix 用 ``f"{settings.api_prefix}/form"`` 拼，不写死。

── 权限：为什么不用 core.auth 的 @permission_required ─────────────────
本模块 55 条受保护路由走的全是 ``@permission_required_any(*一组名字)``：
403 文案是「缺少权限，需要以下任一权限：a / b」，**未登录是 401 unauthorized**。
``@permission_required``（单数）的 403 文案是「用户 X 没有权限: Y」、**未登录是 500**
（core.auth 契约 2）。两套不是一回事，换过去就是行为变更。
权限名分组见 permissions.py；判定函数本体在 core.auth（与原实现逐字等价）。

★ ``POST /member/score_panel/{form_id:int}`` 只有 ``@login_required``，没有权限组
  —— 授权在 ``service.create_member_score_panel`` 里判「当前用户是不是该活动的
  组织者」，拒绝时回 403「仅活动组织者可开启积分面板」。不是漏挂。

── 请求体：``request.get_json()`` 有两种写法，行为差异记在这里 ─────────
原文件里 9 条路由写的是 ``request.get_json() or {}``（**不带 silent**），
其余写的是 ``request.get_json(silent=True) or {}``。两者只在**畸形请求**上有区别：
不带 silent 时，Content-Type 不是 JSON → 415，body 不是合法 JSON → 400。
这里统一用 ``Optional[dict] = Body(default=None)`` + ``payload or {}``：
  · 没有 body / body 是 ``null``：两种写法在 Flask 下都落到 ``{}``，这里也是 ``{}``。✅
  · body 是合法 JSON 但不是对象（``[1,2]``）：Flask 走到 ``data.get(...)`` → 500；
    这里 FastAPI 回 422。都是失败。
  · body 不是合法 JSON / Content-Type 不对：Flask 是 400（silent=True 时是 ``{}``
    再走业务校验）/ 415，这里一律 422。**这是本次搬迁唯一的可见差异**，
    没有调用方在这么发。

── 上传：五条 multipart 路由走 uploads.form_and_files 依赖 ──────────────
不用 ``= Form(...)`` / ``= File(...)`` 参数声明，是为了守住 Flask 的既有分支：
那边 ``request.form`` / ``request.files`` 对一个非表单 body 就是两个空映射，
请求会一路走到业务校验的 **400**（「缺少 nric」/「请上传付款截图」）。
声明成 Form/File 参数的话 FastAPI 会在进路由之前判 **422**，那些 400 分支就没了。
见 uploads.py 的模块头。

── 「看着像 bug、故意保留」────────────────────────────────────────────
  · ``/get_form/{id}`` 与 ``/get_all_form`` 的响应体是**本文件内联**拼的
    （``_serialize_form_detail`` / ``_serialize_form_list_item``），
    而 service.py 里还各有一个同名函数 ``get_form_detail`` / ``get_all_form``
    没有任何调用方。两边形状不一样（内联这份多了 member_count / payments）。
    照搬，别合并也别删 —— 删掉 service 里那两个等于赌没有别的模块在 import 它们。
  · ``/parental_sign``、``/index/<id>``、``/pay_register/<id>``、``/member``、
    ``/score_panel/<token>`` 五条返回的是 **HTML**，不是 JSON。
  · ``/score_panel/<token>`` 三条**完全公开**（token 即鉴权），见 score_panel.py。
  · ``/register/<id>``、``/parental/complete/<id>``、``/payment_quote/<id>``、
    ``/payment/create/<id>``、``/html_to_pdf``、``/youth-class-registration/submit``、
    ``/youth-class-registration/nric-check``、``/youth-class-registration/payment/<token>*``
    也都是公开的 —— 它们是报名者本人用的入口。
  · ``/group/ai_chat/<id>`` 要的是 **member_detail** 一组，而落地用的
    ``/group/apply_plan/<id>`` 要 **form_edit**。读得了不一定写得了，是有意的。
  · ``/attendance/delete/<id>`` 要 form_edit，而同一组的另外五条点名路由只要
    member_detail。删除比修改严，照搬。
"""

from typing import Optional

from fastapi import APIRouter, Body, Depends

from backend.core import council_sign
from backend.core.auth import login_required, permission_required_any
from backend.core.config import settings
from backend.api.form import realtime
from backend.core.responses import json_response
from backend.models.form import RegisForm

from . import ai_grouping, form_agent, score_panel, service
from .permissions import (
    FORM_EDIT_PERMISSION_NAMES,
    FORM_LIST_PERMISSION_NAMES,
    FORM_MEMBER_DETAIL_PERMISSION_NAMES,
    FORM_PAYMENT_EDIT_PERMISSION_NAMES,
    FORM_PAYMENT_READ_PERMISSION_NAMES,
    FORM_READ_PERMISSION_NAMES,
    YOUTH_CLASS_COUNCIL_PERMISSION_NAMES,
    YOUTH_CLASS_EDIT_PERMISSION_NAMES,
    YOUTH_CLASS_READ_PERMISSION_NAMES,
    current_user_has_any_permission,
)
from .uploads import form_and_files

# prefix 用 settings.api_prefix 拼而不是写死 "/form"：api_prefix 今天是空串
# （BASE_PATH 已经区分了项目），但配置项留着是为了需要时还能整体把 /api 加回来 ——
# 写死的话那次改配置只会改到一半。
router = APIRouter(prefix=f"{settings.api_prefix}/form", tags=["form"])

# 对应 Flask 的 ``request.get_json(silent=True) or {}`` / ``request.get_json() or {}``
# 中**可达**的那一支，见模块头。不带 embed，前端发什么形状进来就是什么形状。
_JSON_BODY = Body(default=None)


def _int_arg(raw, default=None):
    """对应 Flask 的 ``request.args.get(k, default, type=int)``。

    关键是「转不动就当没传」：空串、``abc``、``12.5`` 全部静默回 default。
    本模块只有 ``/member/detail?form_id=`` 一处用到 —— 但那一处很要紧：
    声明成 ``int`` 的话 ``?form_id=abc`` 会从「403 该 NRIC 未报名此活动。」
    变成 422，成员终端的错误提示就空了。
    """
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


# --------------------------------------------------------------------------- #
# 列表 / 详情的内联序列化器（原 routes.py 顶部，不在 services.py 里）
# --------------------------------------------------------------------------- #
def _serialize_form_base(form):
    data = form.to_dict_event(is_public=True)
    data["member_count"] = len(form.members or [])
    return data


def _serialize_form_list_item(form, include_payments=False):
    data = _serialize_form_base(form)
    if include_payments:
        data["payments"] = [payment.to_dict() for payment in form.payments]
    return data


def _serialize_form_detail(form, include_members=False):
    data = _serialize_form_base(form)
    data["members"] = [member.to_dict(form_id=form.id) for member in form.members] if include_members else []
    return data


# --------------------------------------------------------------------------- #
# 公开页面（HTML）
# --------------------------------------------------------------------------- #
# ★ ``{form_id}`` 是字符串，不是 ``{form_id:int}``，见模块头。
@router.get("/index/{form_id}")
def form_index(form_id: str, force: Optional[str] = None):
    # force 原来是 service 里现读的 ``request.args.get("force")``，缺参数是 None。
    # 不能声明成 bool —— ``_is_truthy`` 只认 {"1","true","yes","on"}（不区分大小写），
    # 而 FastAPI 的 bool 解析还认 "y"/"on"/"" 之外的一串值，两套规则不一样。
    return service.form_index_response(form_id, force)


# -------- 成员通道 Portal（公开）--------
@router.get("/member")
def member_portal_page():
    return service.member_portal_page()


@router.get("/member/participated")
def member_portal_participated(nric: Optional[str] = None):
    # ``args.get("nric")`` 缺参数是 None、``?nric=`` 是空串；两者在
    # ``_normalize_member_nric`` 里都走「NRIC 不能为空」的 400。声明成 Optional 即可。
    return service.member_portal_participated(nric)


@router.get("/member/detail")
def member_portal_detail(nric: Optional[str] = None, form_id: Optional[str] = None):
    # ``args.get("form_id", type=int)`` 是「转不动就当没传」（静默回 None）：
    # ``?form_id=abc`` 在 Flask 下拿到的是 None → service 里 ``if form_id`` 假 →
    # 403「该 NRIC 未报名此活动。」。声明成 int 会让它变成 422，那条分支就没了。
    return service.member_portal_detail(nric, _int_arg(form_id))


@router.post("/member/score_panel/{form_id:int}")
@login_required
def member_score_panel(form_id: int):
    # 只有 login_required：是不是组织者由 service 判，见模块头 ★。
    return service.create_member_score_panel(form_id)


@router.get("/pay_register/{form_id}")
def pay_register_page(form_id: str):
    return service.pay_register_page_response(form_id)


@router.get("/parental_sign")
def parental_sign_page(
    # Flask 那边是 ``request.args.get("t"/"form"/"payload"/"parent"/"room")``，
    # 五个都是「缺了就是 None」。t 有值走 Redis 分享上下文，否则退回
    # 「三段 base64 塞在 URL 里」的老链接形态。
    t: Optional[str] = None,
    form: Optional[str] = None,
    payload: Optional[str] = None,
    parent: Optional[str] = None,
    room: Optional[str] = None,
):
    return service.parental_sign_page(t, form, payload, parent, room)


@router.post("/parental_sign_share")
def parental_sign_share(payload: Optional[dict] = _JSON_BODY):
    return service.create_parental_sign_share(payload or {})


# 原来是 ``/event_poster/<int:form_id>/<type>``。第二段在视图里被 ``del type`` 直接丢掉
# （它只是给前端加缓存标记用的，调用方传的是 "cache"）。这里改名成 poster_type
# 只为不在函数签名里遮蔽内置 ``type`` —— **URL 一个字符没变**，占位符名字不参与匹配。
@router.get("/event_poster/{form_id:int}/{poster_type}")
def event_poster(form_id: int, poster_type: str):
    del poster_type
    return service.event_poster_response(form_id)


# --------------------------------------------------------------------------- #
# 报名表本体
# --------------------------------------------------------------------------- #
@router.post("/create")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def create_form(payload: Optional[dict] = _JSON_BODY):
    return service.create_form(payload or {})


@router.post("/remove_form")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def remove_form(payload: Optional[dict] = _JSON_BODY):
    return service.remove_form(payload or {})


@router.post("/register/{form_id:int}")
def register_member(form_id: int, payload: Optional[dict] = _JSON_BODY):
    # 公开：报名者本人提交。截止/满员判定在 service 里（force 链接可绕过）。
    return service.register_member(form_id, payload or {})


@router.post("/parental/complete/{form_id:int}")
def complete_parental_consent(form_id: int, payload: Optional[dict] = _JSON_BODY):
    # 公开：凭 NRIC 给「已报名但家长同意书待完成」的登记补签。
    return service.complete_parental_consent(form_id, payload or {})


@router.get("/get_form/{form_id:int}")
@permission_required_any(*FORM_READ_PERMISSION_NAMES)
def get_form_detail(form_id: int):
    # ⚠️ 这里**不是**调 service.get_form_detail —— 那个函数没有调用方且形状不同，
    #    见模块头「故意保留」。逐字照搬 routes.py 的内联实现。
    form = RegisForm.query.get_or_404(form_id)
    include_members = current_user_has_any_permission(FORM_MEMBER_DETAIL_PERMISSION_NAMES)
    return json_response({"status": "success", "form": _serialize_form_detail(form, include_members=include_members)})


@router.get("/get_all_form")
@permission_required_any(*FORM_LIST_PERMISSION_NAMES)
def get_all_form():
    # 同上：内联实现，不是 service.get_all_form。
    forms = RegisForm.query.order_by(RegisForm.created_at.desc()).all()
    # 只有财政能看到每张表下的付款记录；报名表管理员看不到。
    include_payments = current_user_has_any_permission({"account_read", "account_edit"})
    return json_response(
        {
            "status": "success",
            "forms": [
                _serialize_form_list_item(form, include_payments=include_payments)
                for form in forms
            ],
        }
    )


@router.post("/edit_form/{form_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def edit_form(form_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.edit_form(form_id, payload or {})


# --------------------------------------------------------------------------- #
# 报名费与付款（收款审核那一侧认的是**财政**权限，见 permissions.py）
# --------------------------------------------------------------------------- #
@router.get("/payment_quote/{form_id:int}")
def get_payment_quote(form_id: int, nric: Optional[str] = None):
    # 公开：付款页据 NRIC 算年龄 → 挑出本表单里符合年龄的收费项。
    return service.get_payment_quote(form_id, nric)


@router.post("/payment/create/{form_id:int}")
def create_payment(form_id: int, parsed=Depends(form_and_files)):
    # 公开：报名者上传付款截图。原来是
    # ``services.create_payment(form_id, request.form, request.files.get("proof_image"))``。
    fields, files = parsed
    return service.create_payment(form_id, fields, files.get("proof_image"))


@router.get("/payment/proof_image/{payment_id:int}")
@permission_required_any(*FORM_PAYMENT_READ_PERMISSION_NAMES)
def get_payment_proof_image(payment_id: int):
    return service.get_payment_proof_image(payment_id)


@router.post("/payment/update_status/{payment_id:int}")
@permission_required_any(*FORM_PAYMENT_EDIT_PERMISSION_NAMES)
def update_payment_status(payment_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.update_payment_status(payment_id, payload or {})


@router.post("/payment/proof_image/{payment_id:int}/replace")
@permission_required_any(*FORM_PAYMENT_EDIT_PERMISSION_NAMES)
def replace_payment_proof_image(payment_id: int, parsed=Depends(form_and_files)):
    _, files = parsed
    return service.replace_payment_proof_image(payment_id, files.get("proof_image"))


@router.delete("/payment/{payment_id:int}")
@permission_required_any(*FORM_PAYMENT_EDIT_PERMISSION_NAMES)
def delete_payment_record(payment_id: int):
    return service.delete_payment_record(payment_id)


# --------------------------------------------------------------------------- #
# 额外字段（报名表自定义栏位）
# --------------------------------------------------------------------------- #
@router.post("/extra_field/add/{form_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def add_extra_field(form_id: int, payload: Optional[dict] = _JSON_BODY):
    # 原来是 ``request.get_json() or {}``（不带 silent），差异见模块头。
    return service.add_extra_field(form_id, payload or {})


@router.put("/extra_field/edit/{field_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def edit_extra_field(field_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.edit_extra_field(field_id, payload or {})


@router.delete("/extra_field/delete/{field_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def delete_extra_field(field_id: int):
    return service.delete_extra_field(field_id)


@router.get("/extra_field/list/{form_id:int}")
@permission_required_any(*FORM_READ_PERMISSION_NAMES)
def list_extra_fields(form_id: int):
    return service.list_extra_fields(form_id)


# --------------------------------------------------------------------------- #
# 收费项
# --------------------------------------------------------------------------- #
@router.post("/fee/add/{form_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def add_fee(form_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.add_fee(form_id, payload or {})


@router.post("/fee/upload_image")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def upload_fee_image(parsed=Depends(form_and_files)):
    _, files = parsed
    # ``files.get("image")`` 在「没选文件」时返回一个 filename 为空的假值对象，
    # service 里 ``if not file_storage or not …filename`` 命中 → 400「请选择图片文件」。
    # 这条靠 UploadedFile.__bool__（照抄 werkzeug FileStorage），见 uploads.py ③。
    return service.upload_fee_image(files.get("image"))


@router.put("/fee/edit/{fee_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def edit_fee(fee_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.edit_fee(fee_id, payload or {})


@router.delete("/fee/delete/{fee_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def delete_fee(fee_id: int):
    return service.delete_fee(fee_id)


@router.get("/fee/list/{form_id:int}")
@permission_required_any(*FORM_READ_PERMISSION_NAMES)
def list_fees(form_id: int):
    return service.list_fees(form_id)


# --------------------------------------------------------------------------- #
# 关联活动 / 成员
# --------------------------------------------------------------------------- #
@router.post("/add_event/{form_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def add_event_to_form(form_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.add_event_to_form(form_id, payload or {})


# ⚠️ DELETE 带 JSON body（event_id 在体里，不在路径里）。Flask 允许，FastAPI 也允许，
#    但有些 HTTP 客户端默认不发 DELETE 的 body —— 这是既有接口形状，照搬。
@router.delete("/remove_event/{form_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def remove_event_from_form(form_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.remove_event_from_form(form_id, payload or {})


@router.post("/remove_regis_form_member")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def remove_regis_form_member(payload: Optional[dict] = _JSON_BODY):
    return service.remove_regis_form_member(payload or {})


@router.post("/edit_member")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def edit_member(payload: Optional[dict] = _JSON_BODY):
    return service.edit_member(payload or {})


@router.post("/preview_member_nric_change")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def preview_member_nric_change(payload: Optional[dict] = _JSON_BODY):
    return service.preview_member_nric_change(payload or {})


@router.get("/get_nric_detail")
@permission_required_any(*FORM_MEMBER_DETAIL_PERMISSION_NAMES)
def get_nric_detail(nric: Optional[str] = None):
    return service.get_nric_detail(nric)


# --------------------------------------------------------------------------- #
# 报名成员分组（小组）
# --------------------------------------------------------------------------- #
@router.get("/group/list/{form_id:int}")
@permission_required_any(*FORM_READ_PERMISSION_NAMES)
def list_form_groups(form_id: int):
    return service.list_form_groups(form_id)


@router.post("/group/create/{form_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def create_form_group(form_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.create_form_group(form_id, payload or {})


@router.put("/group/rename/{group_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def rename_form_group(group_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.rename_form_group(group_id, payload or {})


@router.delete("/group/delete/{group_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def delete_form_group(group_id: int):
    return service.delete_form_group(group_id)


@router.post("/group/assign")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def assign_member_group(payload: Optional[dict] = _JSON_BODY):
    return service.assign_member_group(payload or {})


# ⚠️ 加减分走的是 score_panel.admin_adjust_score（**写积分日志 + 广播**），
#    不是 service.adjust_form_group_score（不写日志）。后者没有调用方，照搬留着。
@router.post("/group/score/{group_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def adjust_form_group_score(group_id: int, payload: Optional[dict] = _JSON_BODY):
    return score_panel.admin_adjust_score(group_id, payload or {})


@router.post("/group/color/{group_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def set_form_group_color(group_id: int, payload: Optional[dict] = _JSON_BODY):
    return score_panel.set_group_color(group_id, payload or {})


@router.post("/group/leader/{group_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def set_form_group_leader(group_id: int, payload: Optional[dict] = _JSON_BODY):
    return score_panel.set_group_leader(group_id, payload or {})


@router.get("/group/score_log/{group_id:int}")
@permission_required_any(*FORM_MEMBER_DETAIL_PERMISSION_NAMES)
def form_group_score_log(group_id: int):
    return score_panel.group_score_log(group_id)


@router.post("/group/score_panel/create/{form_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def create_score_panel(form_id: int):
    return score_panel.create_score_panel(form_id)


# -------- 公开积分面板（token 鉴权，无需登录）--------
@router.get("/score_panel/{token}")
def score_panel_page(token: str):
    return score_panel.score_panel_page(token)


@router.get("/score_panel/{token}/data")
def score_panel_data(token: str):
    return score_panel.score_panel_data(token)


@router.post("/score_panel/{token}/adjust")
def score_panel_adjust(token: str, payload: Optional[dict] = _JSON_BODY):
    return score_panel.score_panel_adjust(token, payload or {})


# --------------------------------------------------------------------------- #
# AI 分组 / 报名表 AI Agent（都是「起子进程 → 立刻回 job_id + room」）
# --------------------------------------------------------------------------- #
@router.post("/group/ai_chat/{form_id:int}")
@permission_required_any(*FORM_MEMBER_DETAIL_PERMISSION_NAMES)
def group_ai_chat(form_id: int, payload: Optional[dict] = _JSON_BODY):
    # 只读权限就能问（见模块头「故意保留」）：问答不落地，落地的是下面那条。
    return ai_grouping.ai_group_chat(form_id, payload or {})


@router.post("/group/apply_plan/{form_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def group_apply_plan(form_id: int, payload: Optional[dict] = _JSON_BODY):
    return ai_grouping.apply_group_plan(form_id, payload or {})


@router.post("/agent/chat/{form_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def form_agent_chat(form_id: int, payload: Optional[dict] = _JSON_BODY):
    return form_agent.form_agent_chat(form_id, payload or {})


@router.post("/agent/apply/{form_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def form_agent_apply(form_id: int, payload: Optional[dict] = _JSON_BODY):
    return form_agent.apply_form_agent_plan(form_id, payload or {})


# --------------------------------------------------------------------------- #
# 点名（出席快照）
# --------------------------------------------------------------------------- #
@router.get("/attendance/list/{form_id:int}")
@permission_required_any(*FORM_MEMBER_DETAIL_PERMISSION_NAMES)
def list_form_attendances(form_id: int):
    return service.list_form_attendances(form_id)


@router.get("/attendance/get/{attendance_id:int}")
@permission_required_any(*FORM_MEMBER_DETAIL_PERMISSION_NAMES)
def get_form_attendance(attendance_id: int):
    return service.get_form_attendance(attendance_id)


@router.post("/attendance/create/{form_id:int}")
@permission_required_any(*FORM_MEMBER_DETAIL_PERMISSION_NAMES)
def create_form_attendance(form_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.create_form_attendance(form_id, payload or {})


@router.post("/attendance/update/{attendance_id:int}")
@permission_required_any(*FORM_MEMBER_DETAIL_PERMISSION_NAMES)
def update_form_attendance(attendance_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.update_form_attendance(attendance_id, payload or {})


@router.post("/attendance/mark/{attendance_id:int}")
@permission_required_any(*FORM_MEMBER_DETAIL_PERMISSION_NAMES)
def mark_form_attendance_member(attendance_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.mark_form_attendance_member(attendance_id, payload or {})


# ⚠️ 删除要 form_edit，其余五条只要 member_detail（见模块头「故意保留」）。
@router.delete("/attendance/delete/{attendance_id:int}")
@permission_required_any(*FORM_EDIT_PERMISSION_NAMES)
def delete_form_attendance(attendance_id: int):
    return service.delete_form_attendance(attendance_id)


# --------------------------------------------------------------------------- #
# HTML → PDF 导出（公开，没有任何权限装饰器 —— 原样保留）
# --------------------------------------------------------------------------- #
@router.post("/html_to_pdf")
def html_to_pdf(parsed=Depends(form_and_files)):
    # 原来是 ``services.html_to_pdf()``，里面现读 request.files/form。
    # 没有文件时 pdf.py 回 ``{"error": "no html files uploaded"}, 400``。
    fields, files = parsed
    return service.html_to_pdf(files.getlist("files"), fields.get("filename"))


# --------------------------------------------------------------------------- #
# 青少年佛学班报名
# --------------------------------------------------------------------------- #
@router.post("/youth-class-registration/submit")
def submit_youth_class_registration_route(payload: Optional[dict] = _JSON_BODY):
    # 公开：报名者本人提交。
    return service.submit_youth_class_registration(payload or {})


@router.get("/youth-class-registration/entries")
@permission_required_any(*YOUTH_CLASS_READ_PERMISSION_NAMES)
def get_youth_class_registration_entries():
    return service.get_youth_class_registrations()


# ★ 这两条 ``/settings`` 必须排在带 ``{entry_id:int}`` 的路由**之前**，见模块头 ④。
@router.get("/youth-class-registration/settings")
@permission_required_any(*YOUTH_CLASS_READ_PERMISSION_NAMES)
def get_youth_class_registration_settings():
    return service.get_youth_class_payment_settings()


@router.put("/youth-class-registration/settings")
@permission_required_any(*YOUTH_CLASS_EDIT_PERMISSION_NAMES)
def update_youth_class_registration_settings(payload: Optional[dict] = _JSON_BODY):
    return service.update_youth_class_payment_settings(payload or {})


@router.post("/youth-class-registration/entries/{entry_id:int}/status")
@permission_required_any(*YOUTH_CLASS_EDIT_PERMISSION_NAMES)
def update_youth_class_registration_status_route(entry_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.update_youth_class_registration_status(entry_id, payload or {})


@router.get("/youth-class-registration/nric-check")
def get_youth_class_nric_check_route(nric: Optional[str] = None):
    # 公开：报名页填完 NRIC 就实时告诉对方「符不符合年龄」。
    return service.get_youth_class_nric_check(nric)


# -------- 付款（公开链接，token 即凭据）--------
# ★ ``payment/proof_image/{id}`` 是 4 段、``payment/{token}`` 是 3 段，Starlette 按整条
#   路径匹配，两者不会互相吃。仍然把具名的那条写在前面（同模块头 ④ 的理由）。
@router.get("/youth-class-registration/payment/proof_image/{payment_id:int}")
@permission_required_any(*YOUTH_CLASS_READ_PERMISSION_NAMES)
def get_youth_class_payment_proof_image_route(payment_id: int):
    return service.get_youth_class_payment_proof_image(payment_id)


@router.get("/youth-class-registration/payment/{token}")
def get_youth_class_payment_context_route(token: str):
    return service.get_youth_class_payment_context(token)


@router.post("/youth-class-registration/payment/{token}/submit")
def submit_youth_class_payment_route(token: str, parsed=Depends(form_and_files)):
    # 原来是 ``services.submit_youth_class_payment(token, request.form, request.files.get("proof_image"))``。
    fields, files = parsed
    return service.submit_youth_class_payment(token, fields, files.get("proof_image"))


@router.post("/youth-class-registration/payment/{payment_id:int}/status")
@permission_required_any(*YOUTH_CLASS_EDIT_PERMISSION_NAMES)
def update_youth_class_payment_status_route(payment_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.update_youth_class_payment_status(payment_id, payload or {})


# -------- 理事会签名 --------
# ★ ``/council-sign/batch-url`` 必须排在 ``{entry_id:int}/council-sign`` **之前**，见模块头 ④。
@router.post("/youth-class-registration/council-sign/batch-url")
@permission_required_any(*YOUTH_CLASS_READ_PERMISSION_NAMES)
def create_youth_class_council_batch_url(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    # 注意传的是 ``data.get("registration_ids")``：缺字段 → None →
    # council_sign 回 400「请选择要签名的申请。」，不是 422。
    return council_sign.batch_sign_url_response("youth_class", data.get("registration_ids"))


@router.post("/youth-class-registration/{entry_id:int}/council-sign")
@permission_required_any(*YOUTH_CLASS_COUNCIL_PERMISSION_NAMES)
def add_youth_class_council_signature_route(entry_id: int, payload: Optional[dict] = _JSON_BODY):
    # youth_class 这个 scope 由 service.py 在 **import 期**注册到 core.council_sign
    # （``council_sign.register_scope(CouncilScope(scope="youth_class", …))``）。
    # 本文件顶上 ``from . import service`` 保证了它一定已经注册过。
    return council_sign.add_council_signature("youth_class", entry_id, payload or {})


# -------- 单条报名的增删改 --------
@router.put("/youth-class-registration/{entry_id:int}")
@permission_required_any(*YOUTH_CLASS_EDIT_PERMISSION_NAMES)
def update_youth_class_registration_fields_route(entry_id: int, payload: Optional[dict] = _JSON_BODY):
    return service.update_youth_class_registration_fields(entry_id, payload or {})


@router.post("/youth-class-registration/{entry_id:int}/remove")
@permission_required_any(*YOUTH_CLASS_EDIT_PERMISSION_NAMES)
def remove_youth_class_registration_route(entry_id: int):
    return service.remove_youth_class_registration(entry_id)


@router.post("/youth-class-registration/{entry_id:int}/upgrade-to-membership")
@permission_required_any(*YOUTH_CLASS_EDIT_PERMISSION_NAMES)
def upgrade_youth_to_membership_route(entry_id: int):
    return service.upgrade_youth_to_membership(entry_id)


# ═══════════════ 入向动作（原 Socket.IO 事件）═══════════════
#
# form 模块只有一个：parental_sign_sync（家长签名页的实时同步）。
# 它在第一轮搬迁里被漏掉了 —— 当时判断"本模块没有入向事件"，
# 而那个 handler 注册在 backend/app/socket_events.py 里、不在 form 包内，
# 所以按模块目录搜是搜不到的。


@router.post("/parental_sign/sync")
def sync_parental_sign(payload: Optional[dict] = _JSON_BODY):
    """家长在手机上签完 → 电脑端的表单页立刻看到笔画，不用刷新。

    **不要求登录**：签名链接是发给家长的，家长多数没有账号
    （原 socket 事件同样不校验身份，房间 token 本身就是凭据）。
    """
    return realtime.sync_parental_sign(payload)
