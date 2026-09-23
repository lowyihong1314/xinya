"""资产模块**自己**的权限判定（原 backend/app/asset/permissions.py）。

⚠️ 与 core/permissions.py 不是一回事，别混：core 那份是全项目的权限名清单，
这里是「资产这几条路由该不该放行」的判定 + 拒绝时抛什么异常。

★ 为什么不用 core.auth 的 @login_required / @permission_required 装饰器：
  那两个装饰器的拒绝出口是 core/auth.py 里写死的响应体，而本模块所有出口都长成
  ``{"status": "error", "message": "..."}``，且文案是中文的具体句子
  （「请先登录」/「没有资产读取权限」/「没有资产编辑权限」）。
  换成装饰器就等于把这三句话换掉 —— 前端资产页面在按 message 弹提示。
  所以保持原样：路由里显式调用，异常在 router.py 统一转成响应。

★ 权限名（见 README）：MVP 阶段**借用会计模块**的权限，同时认自己的两个 ——
    读 = asset_read | asset_edit | account_read | account_edit
    写 = asset_edit | account_edit
  注意读权限的集合里包含了两个写权限名：有 *_edit 的人自然也能读，别「去重」成只留 *_read。

★ resolve_user_permissions 把**任何**异常（包括 DB 连不上）都转成 403「无法读取资产模块权限」，
  而不是让它冒成 500。看着像吞异常，但这是原行为：前端按 403 走「没权限」提示。
  TODO(资产): 真要区分「没权限」和「查权限时出错」，得先给前端加一条新分支，不能在这里改。
"""

# 两处 import 换了来源，函数体一个字没动：
#   flask_login.current_user → core.auth.current_user（ContextVar 代理，同接口）
#   get_current_user_permissions 本来就已经指向 core.auth（迁移期改过一次），原样保留。
# 不从 app.auth 取：那个模块顶上还 import 着 flask / flask_login / app.extensions，
# 一行 import 会把整个 Flask 栈拖进 FastAPI 进程。
from backend.core.auth import current_user, get_current_user_permissions

from backend.api.asset.exceptions import AuthenticationRequired, PermissionDenied


def require_authenticated_user():
    if not current_user.is_authenticated:
        raise AuthenticationRequired()
    return current_user


def resolve_user_permissions(user):
    try:
        return get_current_user_permissions(user)
    except Exception as exc:
        raise PermissionDenied("无法读取资产模块权限") from exc


def user_can_read_assets(user):
    permissions = resolve_user_permissions(user)
    return any(
        permission in permissions
        for permission in {
            "asset_read",
            "asset_edit",
            "account_read",
            "account_edit",
        }
    )


def user_can_edit_assets(user):
    permissions = resolve_user_permissions(user)
    return any(permission in permissions for permission in {"asset_edit", "account_edit"})


def require_asset_read_permission():
    user = require_authenticated_user()
    if not user_can_read_assets(user):
        raise PermissionDenied("没有资产读取权限")
    return user


def require_asset_edit_permission():
    user = require_authenticated_user()
    if not user_can_edit_assets(user):
        raise PermissionDenied("没有资产编辑权限")
    return user
