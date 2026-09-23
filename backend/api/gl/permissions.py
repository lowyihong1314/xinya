"""总账模块**自己**的权限判定（原 backend/app/gl/permissions.py）。

⚠️ 与 core/permissions.py 不是一回事，别混：core 那份是全项目的权限名清单，
这里是「总账这几条路由该不该放行」的判定 + 拒绝时抛什么异常。

★ 为什么不用 core.auth 的 @login_required / @permission_required 装饰器：
  那两个装饰器的拒绝出口是 core/auth.py 里写死的响应体，而本模块所有出口都长成
  ``{"status": "error", "message": "..."}``，且文案是中文的具体句子
  （「请先登录」/「没有总账读取权限」/「没有 account_edit 权限」）。
  换成装饰器就等于把这三句话换掉 —— 前端 GL 页面在按 message 弹提示。
  所以保持原样：路由里显式调用，异常在 router.py 统一转成响应。

读权限 = account_read **或** account_edit；写权限 = account_edit。
（总账没有自己的权限名，整个模块借用会计模块那两个，见 README。）
"""

# 两处 import 换了来源，函数体一个字没动：
#   flask_login.current_user      → core.auth.current_user（ContextVar 代理，同接口）
#   app.auth.get_current_user_permissions → core.auth 的同名函数（core 那份是照搬过去的，
#       走 user.departments → dept.permissions 的 lazy 关系，行为一致）。
# 不从 app.auth 取：那个模块顶上还 import 着 flask / flask_login / app.extensions，
# 一行 import 会把整个 Flask 栈拖进 FastAPI 进程。
from backend.core.auth import current_user, get_current_user_permissions

from backend.api.gl.exceptions import AuthenticationRequired, PermissionDenied


def require_authenticated_user():
    if not current_user.is_authenticated:
        raise AuthenticationRequired()
    return current_user


def resolve_user_permissions(user):
    try:
        return get_current_user_permissions(user)
    except Exception as exc:
        raise PermissionDenied("无法读取总账模块权限") from exc


def user_can_read_gl(user):
    permissions = resolve_user_permissions(user)
    return any(permission in permissions for permission in {"account_read", "account_edit"})


def user_can_edit_gl(user):
    return "account_edit" in resolve_user_permissions(user)


def require_gl_read_permission():
    user = require_authenticated_user()
    if not user_can_read_gl(user):
        raise PermissionDenied("没有总账读取权限")
    return user


def require_gl_edit_permission():
    user = require_authenticated_user()
    if not user_can_edit_gl(user):
        raise PermissionDenied("没有 account_edit 权限")
    return user
