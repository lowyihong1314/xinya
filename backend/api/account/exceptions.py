"""报销 / 财政模块的异常 → HTTP 状态码映射（原 backend/app/account/exceptions.py，一字未改）。

这张表就是本模块对前端的**状态码契约**，每个默认文案都会原样出现在用户屏幕上：

    AccountError           400  （无默认文案，必须显式传 message）
    AuthenticationRequired 401  未登录
    PermissionDenied       403  没有权限
    NotFound               404  找不到申请
    ValidationError        400  （无默认文案）

★ 注意 ValidationError 是 **400**，不是 422 —— 和已经搬好的 api/gl 相反。
  两边各自照抄各自的原版，**不要为了「统一」把它对齐到 422**：
  报销前端按 400 分支做表单红框，总账前端按 422 分支做，改哪一边都是线上故障。

★ ``AccountError.__init__`` 的 ``message`` 是**位置必填**参数（gl 那份有默认值）。
  也就是说 ``raise AccountError()`` 在本模块会 TypeError。照搬，别加默认值 ——
  加了之后漏传文案的地方会静默返回一句空 message，比当场报错难查得多。

router.py 把 AccountError 及其子类统一转成 ``{"status": "error", "message": ...}``
+ status_code；其余异常由各路由自己的 ``except Exception`` 兜成 500（多数还会
``db.session.rollback()``），与 Flask 时代一致。
"""


class AccountError(Exception):
    status_code = 400

    def __init__(self, message, status_code=None):
        super().__init__(message)
        self.message = message
        if status_code is not None:
            self.status_code = status_code


class AuthenticationRequired(AccountError):
    def __init__(self, message="未登录"):
        super().__init__(message, status_code=401)


class PermissionDenied(AccountError):
    def __init__(self, message="没有权限"):
        super().__init__(message, status_code=403)


class NotFound(AccountError):
    def __init__(self, message="找不到申请"):
        super().__init__(message, status_code=404)


class ValidationError(AccountError):
    def __init__(self, message):
        super().__init__(message, status_code=400)
