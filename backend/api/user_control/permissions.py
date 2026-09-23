"""user_control 的五组「任一即可」权限名（原 backend/app/user_control/routes.py 顶部常量）。

⚠️ 与 core/permissions.py 不是一回事：core 那份是全项目的权限名**清单**，
这里是「本模块哪几条路由认哪几个名字」的分组。集合里的每个名字都必须在
core.permissions.permission_names 里存在，否则就是一条永远不可能满足的权限。

★ 判定函数本身**不在这里**：core/auth.py 的
``current_user_permission_names`` / ``current_user_has_any_permission`` /
``permission_denied_response`` 与原文件里的 ``_current_user_permission_names`` /
``_current_user_has_any_permission`` / ``_permission_denied_response`` 逐字等价
（同样的 ``bool(perms & set(names))``、同样的
``f"缺少权限，需要以下任一权限：{' / '.join(sorted(...))}"`` + 403），
所以直接用 core 那三个，不在本模块再抄一份 —— 抄第二份的唯一结局是某天
两边的文案漂移，而漂移的那一侧静默不弹提示。

★ 注意这五组走的是「函数体内判定」，不是 @permission_required 装饰器。
  原因见下面每组的注释：它们的拒绝文案是「缺少权限，需要以下任一权限：…」，
  而 @permission_required 的 403 文案是「用户 X 没有权限: Y」，两者不是一套。
  用 @permission_required_any 倒是同一套文案，但**未登录时的出口不同**
  （装饰器走 401 unauthorized，而这里是先过 @login_required 再判），
  所以照搬原结构最稳：@login_required 挂在路由上，权限在函数体第一行判。
"""

# 完整用户资料的读权限。没有它时 get_all_user_data / get_user_detail /
# departments/<id>/users 仍然返回数据，只是缩成 {id, username, display_name}。
FULL_USER_READ_PERMISSION_NAMES = {"member", "member_edit"}

# 完整部门对象（含成员与权限）的读权限。没有它时 /departments 缩成 {id, name}，
# 而 /departments/<id>/users 直接 403。
FULL_DEPARTMENT_READ_PERMISSION_NAMES = {
    "department",
    "department_edit",
    "permission",
    "permission_edit",
    "member",
    "member_edit",
}

# 会员管理后台的**读**权限：申请列表、名册、费用设置(GET)、续费记录(GET)、批量签名 URL。
# ⚠️ 这一组里有 council_approve，而下面的写权限组里没有 ——
#    理事只能看、不能改财政状态，这是有意的，别为了"对称"把它加到写权限里。
MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES = {"member", "member_edit", "account_edit", "council_approve"}

# 会员管理后台的**写**权限：改费用设置、改付款状态、改/移除申请、增删续费记录。
MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES = {"member_edit", "account_edit"}

# 工作台内直接理事会签名。只有 council_approve 一个名字，但仍然写成集合 ——
# 它走的是同一套「缺少权限，需要以下任一权限：…」的文案，换成
# @permission_required("council_approve") 会把文案变成「用户 X 没有权限: council_approve」。
MEMBERSHIP_COUNCIL_PERMISSION_NAMES = {"council_approve"}
