"""form 模块的八组「任一即可」权限名（原 backend/app/form/permissions.py）。

⚠️ 与 core/permissions.py 不是一回事：core 那份是全项目的权限名**清单**，
这里是「本模块哪几条路由认哪几个名字」的分组。集合里的每个名字都必须在
``core.permissions.permission_names`` 里存在，否则就是一条永远不可能满足的权限。

★ **判定逻辑与装饰器本体不在这里了。** 原文件自带一份
``current_user_permission_names`` / ``current_user_has_any_permission`` /
``permission_denied_response`` / ``permission_required_any``，
而 core/auth.py 里那四个与它**逐字等价**：

    · 同样的 ``set(get_current_user_permissions(current_user))``
    · 同样的 ``bool(perms & set(names))``
    · 同样的 ``f"缺少权限，需要以下任一权限：{' / '.join(sorted(set(names)))}"`` + 403
      （分隔符是「空格 / 空格」、按字母序、冒号是**全角**「：」）
    · 同样的「内层先过 login_required」→ 未登录是 **401 unauthorized**，不是 403

抄第二份的唯一结局是某天两边的文案漂移，而漂移的那一侧静默不弹提示。
所以下面直接从 core.auth 转出来。

★ 为什么还要**转出**而不是让调用方自己去 core.auth 取：
  ``backend/api/fahui/*`` 和 ``backend/app/fahui/*`` 共 8 个文件写着
  ``from backend.app.form.permissions import permission_required_any``
  —— 那是本模块历史上的对外出口。保留同名转出，fahui 那边搬迁时只要把
  ``app`` 改成 ``api`` 就能跑，不用连带改函数名。
  （新写的代码请直接用 ``backend.core.auth``，别再经过这里。）

★ 原文件顶部的 ``from flask import jsonify`` / ``from flask_login import
  current_user, login_required`` 全部消失 —— 那三行是本文件脱离 Flask 的全部改动来源。
"""

from backend.core.auth import (
    current_user_has_any_permission,
    current_user_permission_names,
    permission_denied_response,
    permission_required_any,
)

__all__ = [
    "FORM_READ_PERMISSION_NAMES",
    "FORM_EDIT_PERMISSION_NAMES",
    "FORM_MEMBER_DETAIL_PERMISSION_NAMES",
    "FORM_LIST_PERMISSION_NAMES",
    "FORM_PAYMENT_READ_PERMISSION_NAMES",
    "FORM_PAYMENT_EDIT_PERMISSION_NAMES",
    "YOUTH_CLASS_READ_PERMISSION_NAMES",
    "YOUTH_CLASS_EDIT_PERMISSION_NAMES",
    "YOUTH_CLASS_COUNCIL_PERMISSION_NAMES",
    # 下面四个是从 core.auth 原样转出的，见模块头。
    "current_user_permission_names",
    "current_user_has_any_permission",
    "permission_denied_response",
    "permission_required_any",
]

# 报名表工作台的读权限。注意集合里带着两个写权限名（form_edit / member_detail）——
# 有写权限的人自然也能读，别「去重」成只留 form_read。
FORM_READ_PERMISSION_NAMES = {"form_read", "form_edit", "member_detail"}

# 建表 / 改表 / 改成员 / 配报名费。只有一个名字，但仍然写成集合：
# 换成 @permission_required("form_edit") 会把 403 文案从「缺少权限，需要以下任一权限：…」
# 变成「用户 X 没有权限: form_edit」，那是另一套文案。
FORM_EDIT_PERMISSION_NAMES = {"form_edit"}

# 成员敏感资料（含家长同意书、付款记录、点名名单、分组积分日志）。
FORM_MEMBER_DETAIL_PERMISSION_NAMES = {"member_detail", "form_edit"}

# ``/get_all_form`` 的读权限：在报名表读权限之外**额外**放行财政
# —— 财政要在收款审核里按表分组看收入。
FORM_LIST_PERMISSION_NAMES = FORM_READ_PERMISSION_NAMES | {"account_read", "account_edit"}

# 付款截图的**读**权限 = 成员敏感资料的人 + 财政。
FORM_PAYMENT_READ_PERMISSION_NAMES = FORM_MEMBER_DETAIL_PERMISSION_NAMES | {"account_read", "account_edit"}

# 付款的**写**权限只认财政的 account_edit —— form_edit 改不了付款状态。
# ⚠️ 这是有意的不对称（报名表管理员不能自己把自己的付款点成「已确认」），别为了对称加 form_edit。
FORM_PAYMENT_EDIT_PERMISSION_NAMES = {"account_edit"}

# 青少年佛学班工作台的读权限。里面有 council_approve（理事只能看、不能改），
# 而下面的写权限组里没有 —— 同样是有意的不对称。
YOUTH_CLASS_READ_PERMISSION_NAMES = {"youth_class_read", "youth_class_edit", "council_approve"}

YOUTH_CLASS_EDIT_PERMISSION_NAMES = {"youth_class_edit"}

# 理事会签名。写成集合的理由同 FORM_EDIT_PERMISSION_NAMES。
YOUTH_CLASS_COUNCIL_PERMISSION_NAMES = {"council_approve"}
