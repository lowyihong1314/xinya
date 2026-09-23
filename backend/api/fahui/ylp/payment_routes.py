"""YLP 订单相关的付款接口，挂在 ``/payment/*``（和 common 那套审核接口同前缀）。

原 backend/app/fahui/YLP/payment_routes.py（Flask Blueprint ``payment_bp``，
挂在 ``{API_PREFIX}/payment``）。只做框架适配：装饰器、参数提取、响应构造。
校验顺序、状态码、中文文案、响应体的键名全部逐字照搬。

── URL 对照（旧 → 新）────────────────────────────────────────────────
``/api`` 这一段整体去掉了，其余路径一个字符没动（规范路径 + 旧别名一起搬，
见 app/fahui/route_contracts.py 的 ylp_order_payments 组）：

    /api/payment/orders/<id>/payments        (POST) → /payment/orders/{order_id:int}/payments
    /api/payment/make_payment/<id>           (POST) → /payment/make_payment/{order_id:int}
    /api/payment/orders/group-payment        (POST) → /payment/orders/group-payment
    /api/payment/orders/<id>/payments         (GET) → /payment/orders/{order_id:int}/payments
    /api/payment/get_payment_data/<id>        (GET) → /payment/get_payment_data/{order_id:int}
    /api/payment/orders/<id>/amount           (GET) → /payment/orders/{order_id:int}/amount
    /api/payment/calculate_amount/<id>        (GET) → /payment/calculate_amount/{order_id:int}
    /api/payment/orders/<id>/quotation        (GET) → /payment/orders/{order_id:int}/quotation
    /api/payment/download_quotation/<id>      (GET) → /payment/download_quotation/{order_id:int}
    /api/payment/download_quotiton/<id>       (GET) → /payment/download_quotiton/{order_id:int}
    /api/payment/orders/<id>/receipt         (POST) → /payment/orders/{order_id:int}/receipt
    /api/payment/print_receipt/<id>          (POST) → /payment/print_receipt/{order_id:int}
    /api/payment/orders/<id>/receipt-image    (GET) → /payment/orders/{order_id:int}/receipt-image

★ ``download_quotiton`` 那个拼写错误是**线上真实存在的旧别名**，不要顺手改对 ——
  旧版 APK 还在请求它。route_contracts.py 里也把它列成了 legacy。

★ **本 router 和 common/payment_routes.py 共用 ``/payment`` 前缀**，原来靠 Flask 的
  注册顺序（common 先、YLP 后）共存。搬过来必须保持同样的 include 顺序，
  理由写在 backend/api/fahui/__init__.py 里。
  实际上两边的路径没有一条重叠（common 全在 ``/payments`` ``/review``
  ``/get_payment_*`` ``/update_payment_status`` 下，这边全在 ``/orders``
  ``/make_payment`` ``/get_payment_data`` ``/calculate_amount`` ``/download_*``
  ``/print_receipt`` 下），顺序目前只是保险。

★ ``POST /orders/group-payment`` 与 ``POST /orders/{order_id:int}/payments``
  **不会**互相抢：``{order_id:int}`` 在匹配阶段就只认数字，"group-payment" 不是数字。
  这条比声明顺序更可靠，别把 ``:int`` 删掉。

── 三条搬迁硬约束 ────────────────────────────────────────────────────
  ① 本文件**不能写 ``from __future__ import annotations``**（core.auth 的装饰器
     用 functools.wraps 包过，FastAPI 会去 core/auth.py 的命名空间求值注解）。
  ② 路由函数一律 ``def``（同步）：底下是同步 ORM + reportlab 画 PDF + 往打印机
     开 socket，写成 async def 会把 worker 的事件循环焊死。
  ③ 路径参数写 ``{order_id:int}``，不是只靠 ``: int`` 注解 —— Flask 的
     ``<int:order_id>`` 不匹配时是 404，只靠注解会变 422。

── 鉴权的形状：为什么大多数路由上没有装饰器 ──────────────────────────
这一组接口**公开页也在用**（访客用 OTP 验证过手机号之后自己交付款凭证），
所以除了「打印收据」那条要 account_read/account_edit 之外，其余都是在**函数体里**
调 ``_order_read_denied`` —— 管理权限或「订单手机号已验证」二选一。
照搬，不要换成装饰器：装饰器的拒绝出口是 core.auth 写死的那串文案，
而这里的 403 文案含「手机验证」四个字，公开页前端靠它识别并重新弹验证框。
"""

from fastapi import APIRouter, Depends

from backend.core.uploads import form_files_and_json
from backend.core.auth import permission_required_any
from backend.core.config import settings

from ..common.access import can_access_phone_records, owner_or_reader_denied
from .payment_services import (
    calculate_order_amount,
    create_group_payment,
    create_payment_record,
    download_order_quotation,
    download_receipt_image,
    list_order_payment_data,
    print_receipt,
)

# prefix 用 settings.api_prefix 拼而不是写死 "/payment"，理由同其它模块：
# api_prefix 今天是空串，留着是为了需要时能整体把 /api 加回来。
router = APIRouter(prefix=f"{settings.api_prefix}/payment", tags=["fahui-payment"])


def _order_read_denied(order_id):
    """读取订单相关数据：管理权限或订单手机号已验证。返回 None 表示放行。"""
    from backend.models.fahui import FahuiOrder

    order = FahuiOrder.query.get(order_id)
    if order is not None and can_access_phone_records(order.phone):
        return None
    return owner_or_reader_denied()


def _payload_and_upload(parsed):
    """还原 Flask 那句
    ``payload = request.form if request.form else (request.get_json(silent=True) or {})``
    加 ``upload = request.files.get("file")``。

    ★ 顺序不能反：表单**非空**时用表单，空表单（含「只有文件、没有文本字段」
      和「根本不是表单请求」两种）才退回 JSON。原行为如此，连
      「multipart 里只传了文件 → payload 是空字典 → 400 缺少 payment_mode」
      这条冷门分支都要保住。
    """
    form, files, json_payload = parsed
    return (form if form else json_payload), files.get("file")


@router.post("/orders/{order_id:int}/payments")
@router.post("/make_payment/{order_id:int}")
def create_order_payment_route(order_id: int, parsed=Depends(form_files_and_json)):
    payload, upload = _payload_and_upload(parsed)
    return create_payment_record(order_id, payload, upload)


@router.post("/orders/group-payment")
def create_group_payment_route(parsed=Depends(form_files_and_json)):
    payload, upload = _payload_and_upload(parsed)
    return create_group_payment(payload, upload)


@router.get("/orders/{order_id:int}/payments")
@router.get("/get_payment_data/{order_id:int}")
def list_order_payments_route(order_id: int):
    denied = _order_read_denied(order_id)
    if denied is not None:
        return denied
    return list_order_payment_data(order_id)


@router.get("/orders/{order_id:int}/amount")
@router.get("/calculate_amount/{order_id:int}")
def get_order_amount_route(order_id: int):
    denied = _order_read_denied(order_id)
    if denied is not None:
        return denied
    return calculate_order_amount(order_id)


@router.get("/orders/{order_id:int}/quotation")
@router.get("/download_quotation/{order_id:int}")
@router.get("/download_quotiton/{order_id:int}")
def download_order_quotation_route(order_id: int):
    denied = _order_read_denied(order_id)
    if denied is not None:
        return denied
    return download_order_quotation(order_id)


@router.post("/orders/{order_id:int}/receipt")
@router.post("/print_receipt/{order_id:int}")
@permission_required_any("account_read", "account_edit")
def print_order_receipt_route(order_id: int):
    return print_receipt(order_id)


@router.get("/orders/{order_id:int}/receipt-image")
def download_receipt_image_route(order_id: int):
    # 管理端或订单手机号已验证（公开链接 token 授权）都可下载；服务层再校验付款已审核。
    denied = _order_read_denied(order_id)
    if denied is not None:
        return denied
    return download_receipt_image(order_id)
