"""法会付款审核（lamp + YLP 统一的那套），挂在 ``/payment/*``。

原 backend/app/fahui/common/payment_routes.py（Flask Blueprint ``fahui_payment_bp``，
挂在 ``{API_PREFIX}/payment``）。只做框架适配：装饰器、参数提取、响应构造。
校验顺序、状态码、中文文案、响应体的键名与嵌套形状全部逐字照搬 ——
财政审核页在按 ``success`` / ``status`` / ``payment`` 这几个键分支。

── URL 对照（旧 → 新）────────────────────────────────────────────────
``/api`` 这一段整体去掉了（BASE_PATH 已经区分项目），``/payment`` 保持不变。
每条路由的「规范路径 + 旧别名」一起搬，一个都不能少 —— 旧别名还有 APK 和
若干书签在用（见 app/fahui/route_contracts.py 的 fahui_payment_review 组）：

    /api/payment/payments                     （GET） → /payment/payments
    /api/payment/review                       （GET） → /payment/review
    /api/payment/get_all_payment_data         （GET） → /payment/get_all_payment_data
    /api/payment/payments/<id>/status        （POST） → /payment/payments/{payment_id:int}/status
    /api/payment/update_payment_status/<id>  （POST） → /payment/update_payment_status/{payment_id:int}
    /api/payment/review/<id>/approve         （POST） → /payment/review/{payment_id:int}/approve
    /api/payment/review/<id>/revoke          （POST） → /payment/review/{payment_id:int}/revoke
    /api/payment/review/<id>/withdraw        （POST） → /payment/review/{payment_id:int}/withdraw
    /api/payment/payments/<id>/withdraw      （POST） → /payment/payments/{payment_id:int}/withdraw
    /api/payment/review/<id>               （DELETE） → /payment/review/{payment_id:int}
    /api/payment/payments/<id>                （GET） → /payment/payments/{payment_id:int}
    /api/payment/get_payment_detail/<id>      （GET） → /payment/get_payment_detail/{payment_id:int}
    /api/payment/payments/<id>/document       （GET） → /payment/payments/{payment_id:int}/document
    /api/payment/get_payment_image/<id>       （GET） → /payment/get_payment_image/{payment_id:int}

★ **本 router 和 ylp/payment_routes.py 挂在同一个前缀 ``/payment`` 下**，
  原来靠 Flask 的注册顺序（common 先、YLP 后）共存。搬过来必须保持同样的
  include 顺序，理由写在 backend/api/fahui/__init__.py 里，那边是唯一的真相源。

── 三条搬迁硬约束 ────────────────────────────────────────────────────
  ① 本文件**不能写 ``from __future__ import annotations``**。core.auth 的装饰器用
     functools.wraps 包过，FastAPI 求值注解时用的是 core/auth.py 的命名空间，
     开了这一行会在那里找不到名字而**启动即 NameError**。
  ② 路由函数一律 ``def``（同步）。底下是同步 ORM + 文件 IO，写成 async def 会把
     worker 的事件循环焊死。FastAPI 会自动把 def 丢线程池。
  ③ 路径参数写 ``{payment_id:int}``（Starlette 转换器），不是只靠 ``: int`` 注解。
     Flask 的 ``<int:payment_id>`` 在参数不是整数时是**不匹配** → 404；
     只靠注解会先匹配上再校验失败 → 422，前端的 404 分支会失效。

★ 一个**故意保留**的不对称：``/review/<id>/withdraw`` 与 ``/payments/<id>/withdraw``
  走的是 ``sync_owner_status=False``（只把这条付款标成「已拒绝」，订单状态不动），
  而 ``/review/<id>/revoke`` 是 ``status="pending"`` 且**会**联动订单状态。
  两条看着像同一件事，其实不是，别合并。
"""

from typing import Optional

from fastapi import APIRouter, Body

from backend.core.auth import permission_required_any
from backend.core.config import settings

from .payment_review import (
    delete_payment_record,
    get_payment_detail,
    get_payment_document,
    list_review_payments,
    update_payment_review,
)

# prefix 用 settings.api_prefix 拼而不是写死 "/payment"：api_prefix 今天是空串
# （BASE_PATH 已经区分了项目），配置项留着是为了需要时还能整体把 /api 加回来 ——
# 写死的话那次改配置只会改到一半。
router = APIRouter(prefix=f"{settings.api_prefix}/payment", tags=["fahui-payment"])

# 对应 Flask 的 ``request.get_json(silent=True) or {}``。不带 embed，
# 前端发什么形状进来就是什么形状；没有 body / body 是 null 时落到 None，
# 路由里 ``payload or {}`` 补成空字典 —— 与 silent=True 时一致。
_JSON_BODY = Body(default=None)


@router.get("/payments")
@router.get("/review")
@router.get("/get_all_payment_data")
@permission_required_any("account_read", "account_edit")
def list_payment_reviews():
    return list_review_payments()


@router.post("/payments/{payment_id:int}/status")
@router.post("/update_payment_status/{payment_id:int}")
@permission_required_any("account_edit")
def update_payment_status(payment_id: int, payload: Optional[dict] = _JSON_BODY):
    # status 缺失时传的是 None，服务层 normalize 成 "pending"（default），
    # 所以「不带 body 地 POST」等于把它改回待审核 —— 原行为，照搬。
    data = payload or {}
    return update_payment_review(payment_id, status=data.get("status"))


@router.post("/review/{payment_id:int}/approve")
@permission_required_any("account_edit")
def approve_payment(payment_id: int):
    return update_payment_review(payment_id, status="approved")


@router.post("/review/{payment_id:int}/revoke")
@permission_required_any("account_edit")
def revoke_payment(payment_id: int):
    return update_payment_review(payment_id, status="pending")


@router.post("/review/{payment_id:int}/withdraw")
@router.post("/payments/{payment_id:int}/withdraw")
@permission_required_any("account_edit")
def withdraw_payment(payment_id: int):
    """撤回一条付款：只把这条记录标成「已拒绝」，订单状态保持原样。"""
    return update_payment_review(payment_id, status="rejected", sync_owner_status=False)


@router.delete("/review/{payment_id:int}")
@permission_required_any("account_edit")
def delete_payment(payment_id: int):
    return delete_payment_record(payment_id)


@router.get("/payments/{payment_id:int}")
@router.get("/get_payment_detail/{payment_id:int}")
@permission_required_any("account_read", "account_edit")
def payment_detail(payment_id: int):
    return get_payment_detail(payment_id)


@router.get("/payments/{payment_id:int}/document")
@router.get("/get_payment_image/{payment_id:int}")
@permission_required_any("account_read", "account_edit")
def payment_document(payment_id: int):
    return get_payment_document(payment_id)
