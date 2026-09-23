"""权限管理（原 app/permission_mgmt/routes.py 的 Flask Blueprint）。

只做框架适配：装饰器、参数提取、响应构造。校验顺序、状态码、文案、响应体形状
全部逐字照搬 —— 前端 frontend/src/CRM/user_control/react/api.ts 的
fetchAllPermissions / addPermissionToDepartment / removePermissionFromDepartment
还在按这些键分支，改一个键就是行为变更。

URL 变化（BASE_PATH 由 nginx 剥掉，应用内部一律写裸路径）：

    /api/permission/get_all_permission            → /permission/get_all_permission
    /api/permission/add_permission_to_department  → /permission/add_permission_to_department
    /api/permission/remove_permission_from_department
                                                  → /permission/remove_permission_from_department

★ 两个坑，后面搬别的模块的人先看一眼：

  ① **本文件不能写 ``from __future__ import annotations``。**
     core.auth.login_required 用 functools.wraps 包了一层；FastAPI 取签名时
     ``inspect.signature`` 会穿透 ``__wrapped__`` 拿到原函数的参数，但求值注解用的是
     **包装函数的 ``__globals__``**，也就是 core/auth.py 的模块命名空间。
     开了 future annotations 之后注解全变成字符串，FastAPI 就会跑去 core.auth 里
     找 ``Optional`` —— 那里没有这个名字，**启动即 NameError**。
     不开这一行，注解在 def 的那一刻就求好了值，穿不穿透都无所谓。

  ② 路由函数一律 ``def``（同步）。下面的 DB 查询和 commit 都是同步阻塞调用，
     写成 ``async def`` 会把整个 worker 的事件循环焊死。FastAPI 会自动把 def 路由
     丢进线程池，core/db.py 的作用域按 ContextVar 分，线程池复用也不会串场。
"""

from typing import Optional

from fastapi import APIRouter, Body

# 权限清单是**代码的一部分**（DB 只存「部门 ↔ 权限名」的分配关系），
# 原样从 app/auth.py 取，不在这里抄第二份 —— 抄了就会与那边漂移，
# 表现是「权限管理界面里有这个权限，装饰器却认不得」。
# ⚠️ 代价：app/auth.py 顶上还 import 着 flask / flask_login / app.extensions，
#    于是这一行会把 Flask 那几个包拖进 FastAPI 进程（只是 import，没有副作用）。
#    TODO(迁移): app/auth.py 退役时，把 permission_names / permission_descriptions
#    挪进一个不依赖 Flask 的模块（如 core/permissions.py），这里改一行 import 即可。
# 从 core.permissions 取而不是 app.auth：后者会连锁拖进整个 Flask 栈
# （app/__init__ → app.extensions → flask_socketio → eventlet，实测 122 个模块）。
from backend.core.permissions import permission_descriptions as PERMISSION_DESCRIPTIONS
from backend.core.permissions import permission_names as PERMISSION_CATALOG
from backend.core.auth import login_required
from backend.core.config import settings
from backend.core.responses import json_response
from backend.models.user_data import Department, DepartmentPermission, db

# prefix 用 settings.api_prefix 拼而不是写死 "/permission"：api_prefix 今天是空串
# （BASE_PATH 已经区分了项目，再套一层 /api 不带信息量，见 11-BASE_PATH.md），
# 但配置项留着就是为了需要时还能整体加回来 —— 写死的话那次改配置只会改到一半。
# 与 backend/main.py 里 make_realtime_router(prefix=settings.api_prefix) 的写法保持一致。
router = APIRouter(prefix=f"{settings.api_prefix}/permission", tags=["permission"])


def _catalog_entry(name):
    return {
        "id": name,
        "name": name,
        "ref": name,
        "description": PERMISSION_DESCRIPTIONS.get(name, ""),
    }


def _resolve_permission_name(data):
    """兼容旧字段名：permission_id 现在就是权限名字符串。"""
    raw = data.get("permission_name") or data.get("permission_id")
    name = str(raw or "").strip()
    return name if name in PERMISSION_CATALOG else None


# 请求体的取法对应 Flask 的 ``request.get_json() or {}``：
#   · ``Optional[dict]`` + ``Body(default=None)`` = 「整个 JSON 体就是这个参数」，
#     不带 embed，所以前端发的 {"department_id": 1, "permission_id": "cctv"} 原样进来。
#   · 没有 body 时落到 None，路由里 ``payload or {}`` 补成空字典，
#     后面的校验分支自然会回 400，与 Flask 时代一致。
#   · body 不是合法 JSON / Content-Type 不对时，FastAPI 回 422（形状见 backend/main.py 的
#     _validation_error_handler）。Flask 那边这种请求返回的是 400/415 的 **HTML 错误页**，
#     前端一样解析不了，所以这处差异不算行为变更。
_JSON_BODY = Body(default=None)


@router.get("/get_all_permission")
@login_required
def get_all_permission():
    permissions = [_catalog_entry(name) for name in PERMISSION_CATALOG]
    return json_response({"permissions": permissions, "count": len(permissions)}, status_code=200)


@router.post("/add_permission_to_department")
@login_required
def add_permission_to_department(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    department = Department.query.get(data.get("department_id"))
    name = _resolve_permission_name(data)
    if not department or not name:
        return json_response({"error": "Invalid department_id or permission_id"}, status_code=400)

    # 已经有了就当成功（幂等），前端点两次不会看见报错 —— 注意这里是 200 不是 201，
    # 两个码前端分得出来，别合并。
    if any(p.name == name for p in department.permissions):
        return json_response({"message": "Permission already assigned to department"}, status_code=200)

    department.permissions.append(DepartmentPermission(name=name))
    db.session.commit()
    return json_response(
        {"message": f"Permission '{name}' added to Department '{department.name}' successfully."},
        status_code=201,
    )


@router.post("/remove_permission_from_department")
@login_required
def remove_permission_from_department(payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    department = Department.query.get(data.get("department_id"))
    # ★ 删除这一侧**故意不过 PERMISSION_CATALOG 校验**（与新增那侧不对称）：
    #   权限清单是代码里的常量，某个权限被从清单里删掉之后，DB 里那条分配关系还在。
    #   这里要是也卡清单，那条残留就再也删不掉了。
    raw = str(data.get("permission_name") or data.get("permission_id") or "").strip()
    if not department or not raw:
        return json_response({"error": "Invalid department_id or permission_id"}, status_code=400)

    target = next((p for p in department.permissions if p.name == raw), None)
    if target is None:
        return json_response({"message": "Permission not found in department"}, status_code=404)

    department.permissions.remove(target)
    db.session.commit()
    return json_response(
        {"message": f"Permission '{raw}' removed from Department '{department.name}' successfully."},
        status_code=200,
    )


# 注册在 backend/api/router.py（已完成）：
#     from backend.api import permission_mgmt
#     app.include_router(permission_mgmt.router)
# 同时把 app/blueprints.py 里的 ("backend.app.permission_mgmt", "permission_bp", "/permission", "api")
# 摘掉，并把 app/permission_mgmt/ 整个目录删掉 —— 两边同时在跑会让人分不清改哪份。
# 前端 frontend/src/CRM/user_control/react/api.ts 那三处还写着 /api/permission/...，
# 要跟着去掉 /api 这一段（不是本文件的活，交接给前端接线那步）。
