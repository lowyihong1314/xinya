"""资产模块的异常 → HTTP 状态码映射（原 backend/app/asset/exceptions.py，一字未改）。

这张表就是本模块对前端的**状态码契约**，每个默认文案都是会出现在用户屏幕上的句子：

    AssetError             400  （没有默认文案，message 必填）
    AuthenticationRequired 401  请先登录
    PermissionDenied       403  没有权限访问资产模块
    NotFound               404  找不到数据
    ValidationError        400  提交数据有误

★ 注意 ValidationError 是 **400**，不是 422 —— 与隔壁 gl 模块**故意不一样**。
  资产前端（库存 / 单据页）按 400 分支弹错误提示，改成 422 会让那些提示消失
  （422 会被前端当成「框架层校验失败」而不是业务错误）。别为了两个模块「统一」去动它。

★ AssetError 的 message 是**必填位置参数**（gl 那边有默认值）。同样照搬：
  全项目没有一处裸 ``raise AssetError()``，给它补默认值只会掩盖将来的笔误。

router.py 把 AssetError 及其子类统一转成 ``{"status": "error", "message": ...}`` + status_code；
其余异常（DB 错误等）被路由里的 ``except Exception`` 接住 → rollback + 500，与 Flask 时代一致。
"""


class AssetError(Exception):
    status_code = 400

    def __init__(self, message, status_code=None):
        super().__init__(message)
        self.message = message
        if status_code is not None:
            self.status_code = status_code


class AuthenticationRequired(AssetError):
    def __init__(self, message="请先登录"):
        super().__init__(message, status_code=401)


class PermissionDenied(AssetError):
    def __init__(self, message="没有权限访问资产模块"):
        super().__init__(message, status_code=403)


class NotFound(AssetError):
    def __init__(self, message="找不到数据"):
        super().__init__(message, status_code=404)


class ValidationError(AssetError):
    def __init__(self, message="提交数据有误"):
        super().__init__(message, status_code=400)
