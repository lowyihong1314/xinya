"""lamp 与 YLP 共用的部分：付款上传/审核、访问控制、电话归一、开放时间、会话。

原 backend/app/fahui/common/。付款审核那套路由在 payment_routes.py
（``router``，挂 ``/payment``），由包顶层的 __init__.py 以
``common_payment_router`` 的名字导出 —— 顺序上它必须排在 ylp 那个同前缀的
router 之前，理由写在 backend/api/fahui/__init__.py 里。
"""

__all__ = ["payment", "payment_review", "payment_routes", "session_state", "ylp_storage"]
