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
