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
