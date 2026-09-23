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
