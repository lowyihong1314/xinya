"""报销模块**自己**的权限判定（原 backend/app/account/permissions.py）。

⚠️ 与 core/permissions.py 不是一回事，别混：core 那份是全项目的权限名清单，
这里是「报销这几条路由该不该放行」的判定 + 拒绝时抛什么异常。

★ 为什么不用 core.auth 的 @login_required / @permission_required 装饰器：
  那两个装饰器的拒绝出口是 core/auth.py 里写死的响应体，而本模块所有出口都长成
  ``{"status": "error", "message": "..."}``，文案是中文的具体句子
  （「未登录」/「没有 account_submit_claim 权限」/「没有查看报销单权限」/
    「没有 account_edit 权限」）。换成装饰器就等于把这几句话换掉 ——
  前端报销页在按 message 弹提示。所以保持原样：路由**函数体第一行**显式调用，
  抛出的 AccountError 由 router.py 统一转成响应。
  ⚠️ 后果是「权限检查在路由体内」—— 请求会先被 FastAPI 解析完 body/表单才被拒。
     Flask 时代同样如此（装饰器也在视图内部调），不算行为变更。

★ 三个权限名是**分开**的，别合并（README 里那句「legacy account / account_submit
  不再使用」就是上一次合并留下的教训）：
    account_submit_claim  提交报销
    account_read          查看全部报销（只读）
    account_edit          审批 / 编辑 / 删除报销

搬迁只改了一行 import：``flask_login.current_user`` → ``core.auth.current_user``
（ContextVar 代理，同接口 .is_authenticated / .id）。函数体一个字没动。
不从 app.auth 取 get_current_user_permissions：那个模块顶上还 import 着
flask / flask_login / app.extensions，一行 import 会把整个 Flask 栈拖进进程。
"""

from backend.core.auth import current_user, get_current_user_permissions

from backend.api.account.exceptions import AuthenticationRequired, PermissionDenied


def require_authenticated_user():
    if not current_user.is_authenticated:
        raise AuthenticationRequired()
    return current_user


def resolve_user_permissions(user):
    try:
        return get_current_user_permissions(user)
    except Exception as exc:
        raise PermissionDenied("无法读取权限") from exc


def user_can_submit_claims(user):
    return "account_submit_claim" in resolve_user_permissions(user)


def user_can_read_all_claims(user):
    permissions = resolve_user_permissions(user)
    return "account_read" in permissions or "account_edit" in permissions


def user_can_list_claims(user):
    permissions = resolve_user_permissions(user)
    return any(permission in permissions for permission in {"account_submit_claim", "account_read", "account_edit"})


def user_can_manage_claims(user):
    return "account_edit" in resolve_user_permissions(user)


def require_claim_submit_permission():
    user = require_authenticated_user()
    if not user_can_submit_claims(user):
        raise PermissionDenied("没有 account_submit_claim 权限")
    return user


def require_claim_list_permission():
    user = require_authenticated_user()
    if not user_can_list_claims(user):
        raise PermissionDenied("没有查看报销单权限")
    return user


def require_claim_edit_permission():
    user = require_authenticated_user()
    if not user_can_manage_claims(user):
        raise PermissionDenied("没有 account_edit 权限")
    return user
