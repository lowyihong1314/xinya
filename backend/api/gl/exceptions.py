"""总账模块的异常 → HTTP 状态码映射（原 backend/app/gl/exceptions.py，一字未改）。

这张表就是本模块对前端的**状态码契约**，每个默认文案都是会出现在用户屏幕上的句子：

    GLError                400  总账操作失败
    AuthenticationRequired 401  请先登录
    PermissionDenied       403  没有总账模块权限
    NotFound               404  找不到记录
    ValidationError        422  数据校验失败

★ 注意 ValidationError 是 **422**，不是 400。FastAPI 自己的请求体校验失败也是 422，
  两者会在前端混在一起 —— 区分办法是本模块的 422 一定带 ``{"status": "error"}``。
  别为了「跟框架区分开」把它改成 400：GL 前端按 422 分支在做表单红框提示。

router.py 把 GLError 及其子类统一转成 ``{"status": "error", "message": ...}`` + status_code；
其余异常（DB 错误等）照原样冒泡成 500，与 Flask 时代一致。
"""

class GLError(Exception):
    """Base error for the general-ledger module."""

    status_code = 400

    def __init__(self, message="总账操作失败", status_code=None):
        super().__init__(message)
        self.message = message
        if status_code is not None:
            self.status_code = status_code


class AuthenticationRequired(GLError):
    def __init__(self, message="请先登录"):
        super().__init__(message, status_code=401)


class PermissionDenied(GLError):
    def __init__(self, message="没有总账模块权限"):
        super().__init__(message, status_code=403)


class NotFound(GLError):
    def __init__(self, message="找不到记录"):
        super().__init__(message, status_code=404)


class ValidationError(GLError):
    def __init__(self, message="数据校验失败"):
        super().__init__(message, status_code=422)
