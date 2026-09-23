"""点灯法会登记（原 backend/app/fahui/lamp/routes.py 的 Flask Blueprint
``lampRegistration_API``，见 backend/app/blueprints.py 最后一行）。

只做框架适配：装饰器、参数提取、响应构造。校验顺序、状态码、中文文案、响应体的
键名与嵌套形状全部逐字照搬 —— 公开登记页和 CRM 的点灯工作台都在按这些键分支。

★ **前缀是 ``/lampRegistration_API``，驼峰 + 下划线混写，照抄不要「规范化」。**
  前端（以及可能存在的外部调用方）按这个字符串拼 URL，改成 lamp_registration 或
  lamp-registration 都等于把线上接口全改名。

── URL 对照（旧 → 新）────────────────────────────────────────────────
``/api`` 这一段整体去掉了（BASE_PATH 已经区分项目，见 docs/flask_to_fastAPI/11），
其余路径一个字符没动：

    /api/lampRegistration_API/ping | /health                → /lampRegistration_API/…
    /api/lampRegistration_API/registrations  （POST）        → /registrations
    /api/lampRegistration_API/register       （POST）        → /register
    /api/lampRegistration_API/registrations  （GET）         → /registrations
    /api/lampRegistration_API/get_all_register               → /get_all_register
    /api/lampRegistration_API/registrations/query|by-ids     → 同名
    /api/lampRegistration_API/get_by_ids                     → /get_by_ids
    /api/lampRegistration_API/registrations/<id>（PATCH/DELETE）→ /registrations/{registration_id:int}
    /api/lampRegistration_API/registrations/update|delete    → 同名
    /api/lampRegistration_API/edit | /delete                 → 同名
    /api/lampRegistration_API/payments/review                → /payments/review
    /api/lampRegistration_API/payments      （GET/POST）      → /payments
    /api/lampRegistration_API/get_all_register_by_payment    → 同名
    /api/lampRegistration_API/make_payment                   → /make_payment
    /api/lampRegistration_API/payments/<id> （DELETE）        → /payments/{payment_id:int}
    /api/lampRegistration_API/payments/delete|remove_payment → 同名
    /api/lampRegistration_API/payments/<id>/file             → /payments/{payment_id:int}/file
    /api/lampRegistration_API/payment_file/<id>              → /payment_file/{payment_id:int}
    /api/lampRegistration_API/payments/<id>/approve|revoke   → /payments/{payment_id:int}/…
    /api/lampRegistration_API/payments/approve|revoke        → 同名
    /api/lampRegistration_API/approve_payment                → /approve_payment

30 条注册，与 Flask 侧一一对应（每个视图函数挂 2~3 个路径，新老两套并存是原样保留的，
route_contracts.py 里那份清单两边都列着）。

── 四条搬迁硬约束（违反会启动即失败或线上事故）────────────────────────

  ① 本文件**不能写 ``from __future__ import annotations``**。core.auth 的装饰器用
     functools.wraps 包过，FastAPI 求值注解时用的是 core/auth.py 的命名空间，
     开了这一行会在那里找不到 ``Optional`` 而**启动即 NameError**。

  ② 路由函数一律 ``def``（同步）。底下全是同步 SQLAlchemy + 文件 IO，写成 async def
     会把 worker 的事件循环焊死。FastAPI 会自动把 def 丢进线程池。

  ③ ``@router.xxx(...)`` 在上、``@permission_required_any(...)`` 在下，与 Flask 的
     装饰器顺序一致。反过来装饰器就跑不到（路由拿到的是没包权限检查的原函数）。

  ④ 路径参数写 ``{xxx:int}``（Starlette 转换器），不是只靠 ``: int`` 注解。
     Flask 的 ``<int:xxx>`` 在参数不是整数时是**不匹配** → 404；只靠注解会先匹配上
     再校验失败 → 422，前端的 404 分支会失效。这里还兼职分家：带转换器之后
     ``/registrations/query`` 不可能被 ``/registrations/{registration_id:int}`` 吃掉。

── 为什么「带 id 的路径」要单独写一个函数 ─────────────────────────────
Flask 那边是一个视图函数挂三条路径（``/registrations/<int:id>`` + ``/registrations/update``
+ ``/edit``），靠 ``registration_id=None`` 的默认值区分。FastAPI **不能这么照搬**：
函数签名里的 ``registration_id`` 对那两条不含 ``{registration_id}`` 的路径来说会变成一个
**查询参数** —— 于是 ``POST /edit?registration_id=7`` 会凭空多出一条能覆盖请求体 id 的
输入通道，而 Flask 只认路径参数。所以带 id 的那条单独成函数，**行为与 Flask 一致**：

    带 id 的路径：payload["id"] = 路径里的 id（覆盖请求体里的 id，与原实现相同）
    不带 id 的路径：payload 原样，id 从请求体里取

其中 delete / approve / revoke 三组的「带 id」版本连请求体都不解析了：它们的 service
只读 ``data["id"]``，请求体的其余键是**读都不读的**。不声明 Body 参数还顺手保住了一条
行为 —— Flask 的 ``get_json(silent=True)`` 对畸形 JSON 是静默当空字典，而 FastAPI 一旦
声明了 Body 就会先回 422。``PATCH /registrations/{id}`` 要读请求体，所以那条仍然声明。

── 请求体 / 表单的取法 ───────────────────────────────────────────────
``request.get_json(silent=True) or {}`` → ``Optional[dict] = Body(default=None)`` + ``payload or {}``。
已知差异只在畸形请求上：body 不是合法 JSON 时 Flask 当 ``{}`` 继续走（落到「缺少 id」这类
400），这里是 FastAPI 的 422。没有调用方在这么发。

``request.form`` / ``request.files`` → ``Form(default=None)`` / ``File(default=None)``。
全部带默认值（不是必填）：必填会让缺字段的请求回 422，而原来是 400「缺少 registration_ids」
/「缺少 amount」，前端在按文案弹提示。starlette 的 ``request.form()`` 对非表单请求
返回空表单且不读 body，所以一个 JSON 发到 /make_payment 仍然会落到那句 400，与 Flask 一致。
⚠️ 一处不可避免的细微差异：同名字段重复出现时 werkzeug 取**第一个**、starlette 取
**最后一个**。前端不会发重名字段。
"""

from typing import Optional

from fastapi import APIRouter, Body, File, Form, UploadFile
from starlette.responses import PlainTextResponse

from backend.api.lamp import service
from backend.api.lamp.fahui_common import FAHUI_READ_PERMISSION_NAMES, has_fahui_read
from backend.api.lamp.uploads import wrap_upload
from backend.core.auth import permission_required_any
from backend.core.config import settings

# prefix 用 settings.api_prefix 拼而不是写死：api_prefix 今天是空串，但配置项留着是为了
# 需要时还能整体把前缀加回来 —— 写死的话那次改配置只会改到一半。
router = APIRouter(prefix=f"{settings.api_prefix}/lampRegistration_API", tags=["lamp"])

# 对应 Flask 的 ``_json_payload()``：``request.get_json(silent=True) or {}``。
# 不带 embed，前端发什么形状进来就是什么形状。
_JSON_BODY = Body(default=None)


def _payload_with_id(payload, record_id):
    """对应 Flask 的 ``_payload_with_optional_id``：路径里的 id **覆盖**请求体里的 id。

    原实现是就地改那个解析出来的字典（``payload["id"] = record_id``），这里照做。
    """
    data = payload or {}
    data["id"] = record_id
    return data


# --------------------------------------------------------------------------- #
# 健康检查
# --------------------------------------------------------------------------- #
@router.get("/ping")
@router.get("/health")
def healthcheck_route():
    """存活探针。route_contracts.py 把 ``/health`` 列成「匿名可访问且回 200」的用例。

    ⚠️ 与 Flask 的一处差异：Flask 里 ``return "pong"`` 发的是 ``text/html; charset=utf-8``，
    这里是 ``text/plain``。正文一个字节没变。不写 ``return "pong"``：那样 FastAPI 会把它
    序列化成 JSON 字符串 ``"pong"``（带引号）。与 api/public_api 的 /ping 同样处理。
    """
    return PlainTextResponse(service.ping())


# --------------------------------------------------------------------------- #
# 登记
# --------------------------------------------------------------------------- #
@router.post("/registrations")
@router.post("/register")
def create_registration_route(payload: Optional[dict] = _JSON_BODY):
    """公开登记入口：**没有任何权限装饰器**，开放与否由 service 里的开放时间窗口决定
    （且只挡未登录请求）。不是漏写。"""
    return service.create_registration(payload or {})


# 具名路径写在带 ``{registration_id:int}`` 的路由之前 —— ``:int`` 转换器在匹配阶段就只认
# 数字，本来不会撞；这是第二道保险，谁以后把转换器删了也不至于立刻出事（同 api/gl）。
@router.get("/registrations")
@router.get("/get_all_register")
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_registrations_route():
    """全量登记列表。读权限比别处宽（fahui_read 也算），常量从 fahui 那边复制而来。"""
    return service.list_registrations()


@router.post("/registrations/query")
@router.post("/registrations/by-ids")
@router.post("/get_by_ids")
def list_registrations_by_ids_route(payload: Optional[dict] = _JSON_BODY):
    """按 id 批量取登记。**公开接口**，靠下面这行限权，不是靠装饰器。"""
    # 管理权限可查全部；公开访客只返回「已验证手机号」名下的记录。
    return service.get_registrations_by_ids(
        payload or {},
        restrict_to_verified_phone=not has_fahui_read(),
    )


@router.post("/registrations/update")
@router.post("/edit")
@permission_required_any("account_edit")
def update_registration_route(payload: Optional[dict] = _JSON_BODY):
    return service.update_registration(payload or {})


@router.patch("/registrations/{registration_id:int}")
@permission_required_any("account_edit")
def update_registration_by_id_route(
    registration_id: int, payload: Optional[dict] = _JSON_BODY
):
    return service.update_registration(_payload_with_id(payload, registration_id))


@router.post("/registrations/delete")
@router.post("/delete")
@permission_required_any("account_edit")
def delete_registration_route(payload: Optional[dict] = _JSON_BODY):
    return service.delete_registration(payload or {})


@router.delete("/registrations/{registration_id:int}")
@permission_required_any("account_edit")
def delete_registration_by_id_route(registration_id: int):
    # service 只读 data["id"]，请求体的其余键读都不读 —— 见模块头「为什么单独写一个函数」。
    return service.delete_registration({"id": registration_id})


# --------------------------------------------------------------------------- #
# 付款（审核层与 YLP 共用，见 fahui_common.py）
# --------------------------------------------------------------------------- #
@router.get("/payments/review")
@router.get("/payments")
@router.get("/get_all_register_by_payment")
@permission_required_any("account_read", "account_edit")
def list_payment_reviews_route():
    return service.list_payments_with_registrations()


@router.post("/payments")
@router.post("/make_payment")
def create_payment_route(
    # 六个文本字段 + 一个文件，对应 Flask 的 ``request.form`` / ``request.files``。
    # 全部 ``Optional[str]`` + 默认 None：缺字段时 werkzeug 的 ``form.get(k)`` 也是 None，
    # 两边对上了，校验一律由 service 做（400 而不是 422）。
    registration_ids: Optional[str] = Form(default=None),
    amount: Optional[str] = Form(default=None),
    payer_name: Optional[str] = Form(default=None),
    phone: Optional[str] = Form(default=None),
    method: Optional[str] = Form(default=None),
    note: Optional[str] = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
):
    """公开的付款提交入口（访客交了钱上传凭证），**没有权限装饰器**，与原来一致。"""
    return service.create_payment(
        # service 只做 ``form.get(key)``（没有 ``type=`` 转换），普通字典就够。
        {
            "registration_ids": registration_ids,
            "amount": amount,
            "payer_name": payer_name,
            "phone": phone,
            "method": method,
            "note": note,
        },
        # 同理，service 只做 ``files.get("file")``；值包成 FileStorage 的替身（见 uploads.py）。
        {"file": wrap_upload(file)},
    )


@router.post("/payments/delete")
@router.post("/remove_payment")
@permission_required_any("account_edit")
def delete_payment_route(payload: Optional[dict] = _JSON_BODY):
    return service.delete_payment(payload or {})


@router.delete("/payments/{payment_id:int}")
@permission_required_any("account_edit")
def delete_payment_by_id_route(payment_id: int):
    return service.delete_payment({"id": payment_id})


@router.get("/payments/{payment_id:int}/file")
@router.get("/payment_file/{payment_id:int}")
@permission_required_any("account_read", "account_edit")
def get_payment_file_route(payment_id: int):
    """付款凭证下载。文件响应由 fahui 那边造（找不到记录/文件时在那边抛 404）。"""
    return service.get_payment_file(payment_id)


@router.post("/payments/approve")
@router.post("/approve_payment")
@permission_required_any("account_edit")
def approve_payment_route(payload: Optional[dict] = _JSON_BODY):
    return service.approve_payment_record(payload or {})


@router.post("/payments/{payment_id:int}/approve")
@permission_required_any("account_edit")
def approve_payment_by_id_route(payment_id: int):
    return service.approve_payment_record({"id": payment_id})


# 撤回只有两条路径（没有 ``/revoke_payment`` 这个老别名），与 Flask 一致，不是漏抄。
@router.post("/payments/revoke")
@permission_required_any("account_edit")
def revoke_payment_route(payload: Optional[dict] = _JSON_BODY):
    return service.revoke_payment_record(payload or {})


@router.post("/payments/{payment_id:int}/revoke")
@permission_required_any("account_edit")
def revoke_payment_by_id_route(payment_id: int):
    return service.revoke_payment_record({"id": payment_id})
