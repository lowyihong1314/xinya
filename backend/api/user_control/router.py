"""用户与权限中枢：登录/登出、当前用户、用户 CRUD、部门、会员流程、理事会签名、头像。

原 backend/app/user_control/routes.py（Flask Blueprint，挂在 /api/user_control）。
48 条路由。只做框架适配 —— 校验顺序、状态码、中文文案、响应体的键名与嵌套形状逐字照搬。

★★ 这是整套前端的**会话来源**：``POST /login`` / ``GET /logout`` / ``GET /get_user_data``
   三条决定了「刷新页面还在不在登录态」。写错的典型表现是「登录成功但一刷新就掉线」，
   所以下面登录链路那一段的注释写得比别处细。

── URL 对照（旧 → 新）────────────────────────────────────────────────
``/api`` 这一段整体去掉（BASE_PATH 已经区分项目，见 docs/flask_to_fastAPI/11），
其余路径一个字符没动。``<int:x>`` → ``{x:int}``，``<x>`` → ``{x}``：

  当前用户 / 足迹
    /api/user_control/get_user_data                 → /user_control/get_user_data
    /api/user_control/my_footprints                 → /user_control/my_footprints
  会员流程（自助）
    /membership/context | public-context | registration-route
    /membership/upgrade | public-upgrade | renew
    /membership/payment/<token>                     → /membership/payment/{token}
    /membership/payment/<token>/submit              → /membership/payment/{token}/submit
  会员流程（后台）
    /membership/settings（GET/PUT）| entries | roster
    /membership/payment/proof_image/<int:id>        → …/proof_image/{payment_id:int}
    /membership/payment/<int:id>/status             → …/{payment_id:int}/status
    /membership/<int:id>（PUT）| <int:id>/remove | <int:id>/council-sign
    /membership/council-sign/batch-url
  理事会签名（会员 + 青少年班共用，scope 由 token 决定）
    /council-sign/mobile（GET/POST）| /council-sign/batch（GET/POST）
  用户
    /get_all_user_data | /get_user_detail/<int:id> | /edit_user_data | /register
    /login | /logout | /change_password | /reset_password/<int:id>
    /edit_reject_local/<edit_type> | /update_user/<int:id> | /delete_user/<int:id>
  部门
    /departments（GET/POST）| /departments/<int:id>（PUT/DELETE）
    /departments/<int:id>/add_user | /remove_user | /users
  会员续费记录
    /member_renewal/<int:user_id>（GET/POST）| /member_renewal/<int:renewal_id>（DELETE）
  头像
    /upload_profile_image | /get_profile_image/<username>[/<size>]

── 四条搬迁时必须这么写的事 ─────────────────────────────────────────

① **本文件不能写 ``from __future__ import annotations``。**
   core.auth 的装饰器用 functools.wraps 包过，FastAPI 求值注解时用的是
   core/auth.py 的命名空间；开了这行注解全变字符串，会跑去那边找 ``Optional``
   而 NameError（启动即挂）。

② **路由函数一律 ``def``（同步），不写 async def。**
   底下全是同步 SQLAlchemy 查询 + commit + PIL 读写盘，写成 async 会把 worker 的
   事件循环焊死。FastAPI 会自动把 def 路由丢进线程池。
   （只有解析 multipart 的 ``_multipart_form`` 是 async 依赖 —— 读 body 必须 await，
     它跑在事件循环里，不阻塞。）

③ **路径参数写 ``{user_id:int}``（Starlette 转换器），不是只靠 ``: int`` 注解。**
   行为问题不是风格问题：Flask 的 ``<int:user_id>`` 在参数不是整数时是**不匹配**
   → 404；只靠注解的话 FastAPI 会先匹配上再校验失败 → **422**，前端的 404 分支会失效。
   带上转换器还顺便保证 ``/membership/settings`` 不会被 ``/membership/{id:int}`` 吃掉。

④ **装饰器顺序保持 Flask 原样：``@login_required`` 在外、``@permission_required`` 在内。**
   顺序反过来会把「未登录」的响应从 401（unauthorized）变成 permission_required 的
   500（「无法验证用户权限，请联系管理员。」），前端的重新登录跳转就不触发了。

── 路由注册顺序 ────────────────────────────────────────────────────
Starlette 是**先注册先匹配、不回溯**。``{x:int}`` 转换器已经保证了
``/membership/settings`` 之类的具名路径不会被数字路由抢走，但下面仍然把
**所有具名路径排在带 {id:int} 的路由之前**，作为第二道保险 ——
谁以后把转换器删了也不会当场出事。

── 与 Flask 的已知差异（都不构成前端可见的业务行为变更）──────────────
· 用 ``request.get_json()``（**没有** silent=True）的那 8 条路由，Flask 在 body 不是
  合法 JSON / Content-Type 不对时抛 400 或 415 的 **HTML 错误页**（其中 5 条还被外层
  try 吞成 500 + 中文「更新失败: 400 Bad Request…」）；这里统一落到 FastAPI 的 422 JSON。
  两边前端都解析不出业务字段，等价。
· ``get_profile_image`` 的兜底图 ``user.jpg`` 本身不存在时：Flask 的 send_file 抛
  NotFound → 404，starlette 的 FileResponse 在发送阶段抛 RuntimeError → 500。
  只在部署漏了这张图时才看得到，TODO 记在那条路由上。
· ``first_or_404`` 的 404 响应体从 werkzeug 的 HTML 页变成 ``{"detail": …}``，
  这是 core/db.py 已登记的框架级差异（影响 /membership/payment/**/status 与 proof_image）。

── ⚠️ ``/logout`` 只认 GET（已核过，不是漏了）──────────────────────
原 Flask 里它就只注册了 GET（``@user_control_bp.get("/logout")``），这里逐字照搬。
搬迁时发现新前端 ``frontend/src/shared/auth/api.ts:logout()`` 当时发的是 **POST**，
也就是挂上去之后登出会 405 —— 而 AuthProvider 的 finally 照样会清空本地会话，
于是表现成「点退出看着成功了，但服务端会话还在」，换个标签页刷新又是登录状态。
**已经从前端那一侧改回 GET**（见 commit「user_control 搬到 FastAPI」）。
所以：要加 POST 之前先想清楚 —— 现在两边是对齐的，加一条 POST 只会让下一个人
再猜一次哪个才是正路。
"""

import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Body, Depends
from PIL import Image
from sqlalchemy.exc import IntegrityError
from starlette.datastructures import FormData, UploadFile
from starlette.requests import Request
from starlette.responses import FileResponse

from backend.api.user_control import form_services, membership, service
from backend.api.user_control.permissions import (
    FULL_DEPARTMENT_READ_PERMISSION_NAMES,
    FULL_USER_READ_PERMISSION_NAMES,
    MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES,
    MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES,
    MEMBERSHIP_COUNCIL_PERMISSION_NAMES,
)
from backend.api.user_control.utils import PROFILE_PATH, generate_resized_image
from backend.core import council_sign
from backend.core.auth import (
    clear_login_cookies,
    current_user,
    current_user_has_any_permission,
    get_current_user_permissions,
    login_required,
    permission_denied_response,
    permission_required,
    set_login_cookies,
)
from backend.core.config import settings
from backend.core.db import db
from backend.core.responses import json_response
from backend.models.file_manager import FilePermission
from backend.models.user_data import Department, MemberRenewal, User

# prefix 用 settings.api_prefix 拼而不是写死 "/user_control"：api_prefix 今天是空串
# （BASE_PATH 已经区分了项目，再套一层 /api 不带信息量），但配置项留着是为了需要时
# 还能整体把前缀加回来 —— 写死的话那次改配置只会改到一半。
router = APIRouter(prefix=f"{settings.api_prefix}/user_control", tags=["user_control"])

# 对应 Flask 的 ``request.get_json(silent=True) or {}`` / ``request.get_json() or {}``：
#   · ``Optional[dict]`` + ``Body(default=None)`` = 「整个 JSON 体就是这个参数」，
#     不带 embed，前端发什么形状进来就是什么形状。
#   · 没有 body / body 是 null 时落到 None，路由里 ``payload or {}`` 补成空字典，
#     后面的校验分支自然走「字段为空」那一支 —— 与 silent=True 时一致。
#   · body 不是合法 JSON 时 FastAPI 回 422（见模块头「已知差异」）。
_JSON_BODY = Body(default=None)


# ─────────────────────────── multipart 适配 ───────────────────────────


async def _multipart_form(request: Request):
    """Flask 的 ``request.form`` / ``request.files`` 的等价物。

    写成 async 依赖：读 body 必须 await，而路由本体要保持同步（见模块头 ②）。
    依赖跑在事件循环里，不阻塞；``yield`` 之后的清理在响应生成之后执行，
    所以路由函数运行期间文件句柄一定还开着。

    畸形 multipart 时给一个**空表单**而不是抛：werkzeug 默认就是静默给空表单，
    照着来 —— 往下走会自然落到「没有文件」那一支。不照办的话 starlette 的
    MultiPartException 会冒成 500。
    """
    try:
        form = await request.form()
    except Exception:
        yield FormData()
        return
    try:
        yield form
    finally:
        # 手工解析的表单要手工关：不关的话 spooled 临时文件要等 GC 才释放。
        await form.close()


def _form_to_dict(form):
    """multipart 表单 → 纯文本字段的普通字典，对齐 Flask 的 ``request.form``。

    两处必须自己动手，否则与 Flask 有细微出入：
      · 文件部分在 Flask 里只出现在 request.files，不在 request.form；
        starlette 的 FormData 把两者混在一起。
      · 同名字段重复出现时 werkzeug 的 MultiDict.get 取**第一个**，
        starlette 的 ImmutableMultiDict.get 取**最后一个**。
    """
    data = {}
    for key, value in form.multi_items():
        if isinstance(value, UploadFile):
            continue
        if key not in data:
            data[key] = value
    return data


def _first_file(form, field):
    """取第一个同名的**文件**部分，对齐 ``request.files.get(field)``。

    ⚠️ 不能写成 ``form.get(field)``：客户端把 "proof" 发成普通文本字段时那样会拿到
    一个 str，后面 ``.filename`` 就 AttributeError 500 了。
    Flask 那边这种请求 files.get() 是 None，走的是「没传文件」分支。
    """
    for key, value in form.multi_items():
        if key == field and isinstance(value, UploadFile):
            return value
    return None


# ─────────────────────────── 当前用户 / 足迹 ───────────────────────────


@router.get("/get_user_data")
@login_required
def get_user_data():
    """前端判断「我是谁 / 我有什么权限」的唯一入口。

    ⚠️ 返回的是 ``User.to_dict()`` 平铺在**顶层**（没有 ``user`` 外壳），
    而且**没有顶层 ``permissions`` 键** —— 权限要从 ``departments[].permissions``
    自己摊平。新前端 shared/auth/api.ts 两种形状都认下来了，别为了"更规整"
    加一层 user 包装：那会让还没改的调用点静默读到 undefined。
    """
    return json_response(current_user.to_dict())


@router.get("/my_footprints")
@login_required
def get_my_footprints():
    member = current_user.nric_asset
    if not member:
        # 没绑 NRIC 的账号返回一个**结构完整的空壳**（summary 五个计数都是 0），
        # 而不是 404 或 member:null 就完事 —— 前端不用为这种情况写第二套渲染分支。
        return json_response(
            {
                "status": "success",
                "member": None,
                "summary": {
                    "registration_form_count": 0,
                    "event_count": 0,
                    "youth_class_count": 0,
                    "payment_count": 0,
                    "total_count": 0,
                },
                "registrations": [],
                "youth_class_registrations": [],
            }
        )

    return json_response({"status": "success", **service._build_profile_footprints(member)})


# ─────────────────────────── 会员流程（自助）───────────────────────────


@router.get("/membership/context")
@login_required
def get_membership_context():
    return membership.get_membership_context()


@router.get("/membership/public-context")
def get_membership_public_context():
    """**公开**（登录与否都能调）。登录了就带上当前账号的信息，没登录就给空壳。"""
    return membership.get_public_membership_context()


@router.get("/membership/registration-route")
def get_membership_registration_route(nric: Optional[str] = None):
    # ``nric: Optional[str] = None`` 对齐 ``request.args.get("nric")``：
    # 缺参数时是 None，membership 里 ``_clean_text(None)`` → None → 400「缺少 NRIC」。
    # 声明成必填会让缺参数变成 422，那条 400 分支就没了。
    return membership.get_long_open_registration_route(nric)


@router.post("/membership/upgrade")
@login_required
def submit_membership_upgrade(payload: Optional[dict] = _JSON_BODY):
    return membership.submit_membership_upgrade(payload or {})


@router.post("/membership/public-upgrade")
def submit_membership_public_upgrade(payload: Optional[dict] = _JSON_BODY):
    return membership.submit_public_membership_upgrade(payload or {})


@router.post("/membership/renew")
@login_required
def start_membership_renewal():
    return membership.start_membership_renewal()


# ─────────────────────── 会员流程（后台，具名路径先注册）───────────────────────


@router.get("/membership/settings")
@login_required
def get_membership_settings():
    if not current_user_has_any_permission(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES):
        return permission_denied_response(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES)
    return membership.get_membership_payment_settings()


@router.put("/membership/settings")
@login_required
def update_membership_settings(payload: Optional[dict] = _JSON_BODY):
    if not current_user_has_any_permission(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES):
        return permission_denied_response(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES)
    return membership.update_membership_payment_settings(payload or {})


@router.get("/membership/entries")
@login_required
def get_membership_entries():
    if not current_user_has_any_permission(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES):
        return permission_denied_response(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES)
    return membership.get_membership_registrations()


@router.get("/membership/roster")
@login_required
def get_membership_roster():
    if not current_user_has_any_permission(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES):
        return permission_denied_response(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES)
    return membership.get_membership_roster()


# 会员工作台生成批量理事会审核 URL（选中的会员申请）。
# 排在 ``/membership/{registration_id:int}/council-sign`` 之前，见模块头「路由注册顺序」。
@router.post("/membership/council-sign/batch-url")
@login_required
def create_membership_council_batch_url(payload: Optional[dict] = _JSON_BODY):
    if not current_user_has_any_permission(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES):
        return permission_denied_response(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES)
    data = payload or {}
    return council_sign.batch_sign_url_response("membership", data.get("registration_ids"))


# ⚠️ proof_image 这条必须排在 ``/membership/payment/{token}`` 之前：``{token}`` 是 str
#    转换器（不吃 "/"），所以三段路径本来就不会被它匹配上 —— 但顺序是第二道保险。
@router.get("/membership/payment/proof_image/{payment_id:int}")
@login_required
def get_membership_payment_proof_image(payment_id: int):
    return membership.get_membership_payment_proof_image(payment_id)


@router.get("/membership/payment/{token}")
def get_membership_payment_context(token: str):
    """**公开**：付款链接是发给申请人（未必有账号）的，加登录门槛等于没人能付款。"""
    return membership.get_membership_payment_context(token)


@router.post("/membership/payment/{token}/submit")
def submit_membership_payment(token: str, form=Depends(_multipart_form)):
    """**公开**，multipart：文本字段 + 一张付款截图 ``proof_image``。

    原式是 ``membership.submit_membership_payment(token, request.form, request.files.get("proof_image"))``。
    两个入参各自对齐：
      · ``request.form``  → ``_form_to_dict(form)``（membership 里只 ``.get("payment_mode")``）
      · ``request.files.get(...)`` → ``_first_file(...)``，拿到了再包成 FileStorage 的样子。
    没传文件时**传 None**（不是包一个空壳）：``_save_register_payment_proof`` 的
    ``if not file_storage`` 那一支才会走进去，回 400「请上传付款截图」。
    """
    upload = _first_file(form, "proof_image")
    proof_image = form_services.UploadFileStorage(upload) if upload is not None else None
    return membership.submit_membership_payment(token, _form_to_dict(form), proof_image)


@router.post("/membership/payment/{payment_id:int}/status")
@login_required
def update_membership_payment_status(payment_id: int, payload: Optional[dict] = _JSON_BODY):
    if not current_user_has_any_permission(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES):
        return permission_denied_response(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES)
    return membership.update_membership_payment_status(payment_id, payload or {})


@router.post("/membership/{registration_id:int}/council-sign")
@login_required
def add_membership_council_signature(registration_id: int, payload: Optional[dict] = _JSON_BODY):
    if not current_user_has_any_permission(MEMBERSHIP_COUNCIL_PERMISSION_NAMES):
        return permission_denied_response(MEMBERSHIP_COUNCIL_PERMISSION_NAMES)
    return membership.add_membership_council_signature(registration_id, payload or {})


@router.put("/membership/{registration_id:int}")
@login_required
def update_membership_registration_fields(
    registration_id: int, payload: Optional[dict] = _JSON_BODY
):
    if not current_user_has_any_permission(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES):
        return permission_denied_response(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES)
    # 这里传的是 ``payload or {}``，而 membership 里有一支
    # ``if not isinstance(data, dict): return 400 请求格式错误`` ——
    # body 发成数组/字符串时会走到那一支（Body(default=None) 不强制类型）。
    return membership.update_membership_registration_fields(registration_id, payload or {})


@router.post("/membership/{registration_id:int}/remove")
@login_required
def remove_membership_registration(registration_id: int):
    if not current_user_has_any_permission(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES):
        return permission_denied_response(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES)
    return membership.remove_membership_registration(registration_id)


# ─────────────────── 理事会签名（会员 + 青少年班共用，scope 由 token 决定）───────────────────
#
# 这四条只是 core/council_sign.py 的搬运工。token 里带着 {scope, registration_id}，
# 所以同一条 URL 既服务会员申请也服务青少年班报名。
# ⚠️ youth_class 那个 scope 由 app/form/services.py 在 import 期注册 —— form 还没搬，
#    所以现在带 youth_class token 打进来会回「未知的签名类型。」。见 membership.py 里的 TODO。


@router.get("/council-sign/mobile")
@login_required
def get_council_sign_mobile_context(t: Optional[str] = None):
    return council_sign.get_sign_mobile_context(t)


@router.post("/council-sign/mobile")
@login_required
def submit_council_sign_mobile(t: Optional[str] = None, payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    # token 优先取 body 里的 t，没有才回落到 query 的 t —— 与原式
    # ``payload.get("t") or request.args.get("t")`` 顺序一致（别反过来）。
    return council_sign.submit_sign_mobile(data.get("t") or t, data)


@router.get("/council-sign/batch")
@login_required
def get_council_sign_batch_context(t: Optional[str] = None):
    return council_sign.get_batch_sign_context(t)


@router.post("/council-sign/batch")
@login_required
def submit_council_sign_batch(t: Optional[str] = None, payload: Optional[dict] = _JSON_BODY):
    data = payload or {}
    return council_sign.submit_batch_sign(data.get("t") or t, data)


# ─────────────────────────── 用户 ───────────────────────────


@router.post("/edit_reject_local/{edit_type}")
@login_required
@permission_required("member_edit")
def edit_reject_local(edit_type: str):
    """「今天不接受本地捐款」开关。

    ★ 注意这条改的是**调用者自己**（current_user），不是某个目标用户 ——
      路径里那个 edit_type 只是 approve/reject 两个动作名。
    ★ ``current_user.reject_local = True`` 是**给代理对象赋值**：
      core/auth.py 的 _CurrentUserProxy 把 __setattr__ 透传到真正的 ORM 对象上，
      所以这两行照搬即可（不透传的话会静默失效 —— 改了没保存）。
    ★ ``reject_date`` 用 ``datetime.utcnow()``；User.to_dict() 里有一段「跨天自动失效」
      的逻辑靠它比日期。别换成 malaysia_now()，两边时区必须是同一套。
    """
    if edit_type not in ["approve", "reject"]:
        return json_response({"error": "invalid edit_type"}, 400)

    if edit_type == "approve":
        current_user.reject_local = True
        current_user.reject_date = datetime.utcnow()
    else:
        current_user.reject_local = False
        current_user.reject_date = None

    db.session.commit()
    return json_response(
        {
            "id": current_user.id,
            "reject_local": current_user.reject_local,
            "reject_date": current_user.reject_date.isoformat()
            if current_user.reject_date
            else None,
        }
    )


@router.get("/get_all_user_data")
def get_all_user_data():
    """**公开**，但按身份分三档返回（前端靠返回的 ``login`` 字段知道自己在哪一档）：

      · 有 member/member_edit → 全量 user.to_dict() + age + xin_ya，login=True
      · 登录但没那两个权限   → 全部用户，只给 {id, username, display_name, is_member}，login=True
      · 未登录               → **只有 display=true 的用户**，且不带 is_member，login=False

    第三档的 display 过滤是唯一的隐私闸门，别为了"统一"把它去掉。
    """
    if current_user.is_authenticated and current_user_has_any_permission(FULL_USER_READ_PERMISSION_NAMES):
        users = User.query.all()
        user_data = service._serialize_users_with_xin_ya(users)
        login = True
    elif current_user.is_authenticated:
        users = User.query.all()
        user_data = [service._serialize_basic_user(user, include_membership=True) for user in users]
        login = True
    else:
        users = User.query.filter_by(display=True).all()
        user_data = [service._serialize_basic_user(user) for user in users]
        login = False

    return json_response({"login": login, "data": user_data})


@router.get("/get_user_detail/{user_id:int}")
@login_required
def get_user_detail(user_id: int):
    user = User.query.get(user_id)
    if not user:
        return json_response({"status": "error", "message": "用户不存在"}, 404)
    data = service._serialize_user_for_request(user)
    # ``"is_member" in data`` 在问「刚才给的是不是全量」——精简版里没有这个键。
    # 是巧合不是标志位（见 service.py 模块头），别给精简版加 is_member。
    if "is_member" in data:
        paid_user_ids, paid_member_ids = service._paid_youth_index()
        age = service._user_nric_age(user)
        data["age"] = age
        data["xin_ya"] = service._is_xin_ya(user, paid_user_ids, paid_member_ids, age=age)
    return json_response(data)


@router.post("/edit_user_data")
@login_required
@permission_required("member_edit")
def edit_user_data(payload: Optional[dict] = _JSON_BODY):
    try:
        data = payload or {}
        # 不传 user_id 就是改自己。注意用的是 ``or``：user_id=0 也会落到 current_user，
        # 而 0 本来就不是合法主键，行为一致。
        target_user_id = data.get("user_id") or current_user.id
        user = User.query.get(target_user_id)
        if not user:
            return json_response({"status": "error", "message": "用户不存在"}, 404)

        # 带 member_edit 的人在这条路由上拿到全部可编辑字段（含 is_member）。
        service._save_user_updates(
            user,
            data,
            allowed_fields=service.SELF_EDITABLE_USER_FIELDS | service.ADMIN_EXTRA_EDITABLE_USER_FIELDS,
        )
        return json_response({"status": "success", "message": "用户信息更新成功"})
    except ValueError as exc:
        # ValueError 是**业务校验**的出口（「username 不能包含空格」等），文案直接给用户看。
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 400)
    except IntegrityError:
        db.session.rollback()
        return json_response(
            {"status": "error", "message": "资料更新失败，可能是用户名、Email 或 Phone 已重复"}, 400
        )
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": f"更新失败: {str(exc)}"}, 500)


@router.post("/register")
@login_required
@permission_required("member_edit")
def register(payload: Optional[dict] = _JSON_BODY):
    """管理员**替人建号**（不是公开注册入口）。成功回 201。

    ⚠️ 这里不校验密码强度，也不发验证邮件 —— 建完就是能登录的账号。
    ``phone`` 允许为空，``username`` / ``password`` / ``email`` 三个必填。
    """
    data = payload or {}
    username = data.get("username")
    password = data.get("password")
    phone = data.get("phone")
    email = data.get("email")

    if not username or not password or not email:
        return json_response({"error": "username, password 和 email 都是必填的"}, 400)

    if User.query.filter((User.username == username) | (User.email == email)).first():
        return json_response({"error": "用户名或邮箱已存在"}, 409)

    try:
        user = User(
            username=username,
            email=email,
            phone=phone,
            created_by=current_user.id,
        )
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        return json_response({"success": True, "user": user.to_dict()}, 201)
    except Exception as exc:
        db.session.rollback()
        return json_response({"error": f"注册失败: {str(exc)}"}, 500)


# ─────────────────────────── 登录链路（★ 全站会话的来源）───────────────────────────


@router.get("/logout")
@login_required
def logout():
    """``logout_user()`` → ``core.auth.clear_login_cookies(response)``。

    clear_login_cookies 做的三件事都不能省：
      ① 会话 Cookie 不是简单删掉，而是写一个带 ``_remember="clear"`` 的空会话 ——
         这样即使浏览器因为 Path/Domain 的历史遗留没删掉 remember_token，
         也不会被它自动登回去（「登出了又自动登回去」就是漏了这一步）。
      ② 删掉当前 path 下的 remember_token。
      ③ 顺手对 path=/ 发一条删除，清掉改 Cookie Path 之前留下的同名残留。

    ⚠️ 只注册了 GET —— 与 Flask 原样一致。新前端发的是 POST，见模块头的「待拍板」。
    """
    response = json_response({"status": "success"}, 200)
    clear_login_cookies(response)
    return response


@router.post("/login")
def login(payload: Optional[dict] = _JSON_BODY):
    """用户名 + 密码 → 下发会话 Cookie。**公开**。

    原式三行：
        session.permanent = True
        login_user(user, remember=True, duration=timedelta(days=7))
        session["login_version"] = user.login_version
    ``core.auth.set_login_cookies`` 把这三件事一次做完，且字节级对齐 flask_login：
      · 会话 Cookie 的 payload 里 ``_permanent=True``（= session.permanent）、
        ``_user_id`` 是**字符串**、``_id`` 是 flask_login 那套 sha512 指纹、
        ``login_version`` 照旧写入（虽然全项目零处读它，见 core/auth.py 的说明）。
      · remember=True + duration=7 天 → remember_token Cookie 的 max_age。
      · 顺手删掉 path=/ 的同名旧 Cookie（不删的话会「随机掉线」）。
    ⚠️ 必须把 Cookie 设在**这个 response 对象**上再 return 它。
       先 return 再想办法补 Cookie 是做不到的，表现就是「登录 200 但刷新还是未登录」。

    ★ 失败一律回 401 +「用户名或密码错误」，**不区分**「用户不存在」和「密码错」——
      区分开等于送一个用户名枚举接口。
    """
    data = payload or {}
    username = data.get("username")
    password = data.get("password")

    if not username or not password:
        return json_response({"error": "用户名和密码不能为空"}, 400)

    user = User.query.filter_by(username=username).first()
    if user and user.check_password(password):
        response = json_response({"success": True})
        set_login_cookies(response, user, remember=True, duration=timedelta(days=7))
        return response

    return json_response({"error": "用户名或密码错误"}, 401)


@router.post("/change_password")
@login_required
def change_password(payload: Optional[dict] = _JSON_BODY):
    """改密码 / 首次设密码（OAuth 建的号没有 password_hash，走「设置」那一支）。

    校验顺序照搬，一步都不能挪：
      新密码非空 → 长度 ≥6 →（本来有密码时）旧密码非空 → 旧密码正确 → 新密码不等于旧密码。
    ``当前密码错误`` 是 **403** 不是 401（401 会触发前端的重新登录跳转，
    而这时候用户明明是登录着的）。

    ★ 最后那行 ``session["login_version"] = current_user.login_version`` 的等价物：
      重新下发一次会话 Cookie，让 Cookie 里的 login_version 跟上刚 +1 的值。
      用 ``remember=False`` —— Flask 那边也只是改了 session，**没有**重签 remember_token。
      ⚠️ 传进去的必须是 ``_get_current_object()`` 拿到的**真身**，不能是代理：
         set_login_cookies 末尾会 ``set_current_user(user)``，把代理再塞回 ContextVar
         会让下一次 ``current_user.x`` 无限递归。
      （顺带一提：全项目**没有**任何地方读 Cookie 里的 login_version，
        所以「改密码踢掉其它设备」今天只对 Bearer 那条路生效。这是既有缺口，
        core/auth.py 已记在案，本次不改。）
    """
    data = payload or {}
    old_password = data.get("old_password")
    new_password = data.get("new_password")
    has_password = bool(current_user.password_hash)

    if not isinstance(new_password, str) or not new_password.strip():
        return json_response({"status": "error", "message": "新密码不能为空"}, 400)
    if len(new_password) < 6:
        return json_response({"status": "error", "message": "新密码至少需要 6 位"}, 400)

    if has_password:
        if not old_password:
            return json_response({"status": "error", "message": "请输入当前密码"}, 400)
        if not current_user.check_password(old_password):
            return json_response({"status": "error", "message": "当前密码错误"}, 403)
        if current_user.check_password(new_password):
            return json_response({"status": "error", "message": "新密码不能与当前密码相同"}, 400)

    current_user.set_password(new_password)
    current_user.increment_login_version()
    db.session.commit()

    response = json_response(
        {"status": "success", "message": "密码修改成功" if has_password else "密码设置成功"}, 200
    )
    set_login_cookies(response, current_user._get_current_object(), remember=False)
    return response


@router.get("/reset_password/{user_id:int}")
@login_required
@permission_required("member_edit")
def reset_password(user_id: int):
    """管理员把某人密码重置成 ``123456``。

    ⚠️ 是 **GET** 且密码写死在文案里 —— 都是原样保留。
    TODO(安全): GET 意味着浏览器预取/日志里都会留下这次重置；
    固定弱口令意味着「重置了但本人还没改」的窗口期里任何人都能登进去。
    要改的话得连前端一起改（现在前端是直接开这个链接）。
    """
    user = User.query.get(user_id)
    if not user:
        return json_response({"status": "error", "message": "用户不存在"}, 404)

    user.set_password("123456")
    user.increment_login_version()
    db.session.commit()
    return json_response({"status": "success", "message": "密码已重置为 123456"}, 200)


# ─────────────────────────── 部门 ───────────────────────────


@router.get("/departments")
@login_required
def list_departments():
    """登录即可读，但**内容分两档**：有部门/成员/权限任一读权限给全量对象，
    其余只给 ``{id, name}``（见 service._serialize_department_for_request）。"""
    departments = Department.query.order_by(Department.name.asc(), Department.id.asc()).all()
    return json_response(
        [service._serialize_department_for_request(department) for department in departments]
    )


@router.post("/departments")
@login_required
@permission_required("department_edit")
def create_department(payload: Optional[dict] = _JSON_BODY):
    try:
        data = payload or {}
        name = str(data.get("name") or "").strip()
        if not name:
            return json_response({"status": "error", "message": "部门名称不能为空"}, 400)
        if Department.query.filter_by(name=name).first():
            return json_response({"status": "error", "message": "部门已存在"}, 400)

        department = Department(name=name)
        db.session.add(department)
        db.session.commit()
        return json_response({"status": "success", "message": "部门创建成功", "id": department.id})
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": f"创建失败: {str(exc)}"}, 500)


@router.put("/departments/{dept_id:int}")
@login_required
@permission_required("department_edit")
def rename_department(dept_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        department = Department.query.get(dept_id)
        if not department:
            return json_response({"status": "error", "message": "部门不存在"}, 404)

        data = payload or {}
        name = str(data.get("name") or "").strip()
        if not name:
            return json_response({"status": "error", "message": "部门名称不能为空"}, 400)

        existing = Department.query.filter(Department.name == name, Department.id != dept_id).first()
        if existing:
            return json_response({"status": "error", "message": "部门已存在"}, 400)

        department.name = name
        db.session.commit()
        return json_response(
            {
                "status": "success",
                "message": "部门名称已更新",
                "data": department.to_dict(),
            }
        )
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": f"更新失败: {str(exc)}"}, 500)


@router.delete("/departments/{dept_id:int}")
@login_required
@permission_required("department_edit")
def delete_department(dept_id: int):
    """删部门。删之前先把三类关联**主动清掉**（成员、权限、文件权限），
    还撞上外键就翻译成中文回 409（见 service._format_department_delete_integrity_error）。"""
    try:
        if dept_id == 1:
            # 1 号群是系统默认部门，delete_user 还靠「在不在 1 号群」判管理员身份。
            return json_response({"status": "error", "message": "不能删除默认部门（1号群）"}, 403)

        department = Department.query.get(dept_id)
        if not department:
            return json_response({"status": "error", "message": "部门不存在"}, 404)

        department.users.clear()
        department.permissions.clear()
        FilePermission.query.filter_by(department_id=dept_id).delete(synchronize_session=False)
        db.session.flush()
        db.session.delete(department)
        db.session.commit()
        return json_response({"status": "success", "message": "部门删除成功"})
    except IntegrityError as exc:
        db.session.rollback()
        return json_response(
            {"status": "error", "message": service._format_department_delete_integrity_error(exc)}, 409
        )
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": f"删除失败: {str(exc)}"}, 500)


@router.post("/departments/{dept_id:int}/add_user")
@login_required
@permission_required("department_edit")
def add_user_to_department(dept_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        data = payload or {}
        # ``User.query.get(None)`` 返回 None → 落到下面的 404，与 Flask 一致。
        user = User.query.get(data.get("user_id"))
        department = Department.query.get(dept_id)
        if not user or not department:
            return json_response({"status": "error", "message": "用户或部门不存在"}, 404)
        if department in user.departments:
            return json_response({"status": "error", "message": "用户已在该部门"}, 400)

        user.departments.append(department)
        db.session.commit()
        return json_response({"status": "success", "message": "用户加入部门成功"})
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": f"加入失败: {str(exc)}"}, 500)


@router.post("/departments/{dept_id:int}/remove_user")
@login_required
@permission_required("department_edit")
def remove_user_from_department(dept_id: int, payload: Optional[dict] = _JSON_BODY):
    try:
        data = payload or {}
        user = User.query.get(data.get("user_id"))
        department = Department.query.get(dept_id)
        if not user or not department:
            return json_response({"status": "error", "message": "用户或部门不存在"}, 404)
        if user.id == 1 and department.id == 1:
            # 把 1 号用户移出 1 号群 = 全站没人有 department_edit 了，救不回来。
            return json_response({"status": "error", "message": "不能将系统管理员移出科技组"}, 403)
        if department not in user.departments:
            return json_response({"status": "error", "message": "用户不在该部门"}, 400)

        user.departments.remove(department)
        db.session.commit()
        return json_response({"status": "success", "message": "用户移出部门成功"})
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": f"移出失败: {str(exc)}"}, 500)


@router.get("/departments/{dept_id:int}/users")
@login_required
def get_department_users(dept_id: int):
    if not current_user_has_any_permission(FULL_DEPARTMENT_READ_PERMISSION_NAMES):
        return permission_denied_response(FULL_DEPARTMENT_READ_PERMISSION_NAMES)

    department = Department.query.get(dept_id)
    if not department:
        return json_response({"status": "error", "message": "部门不存在"}, 404)

    users = department.users
    # 两档：能读全量用户资料的给 to_dict()+心芽标记，其余只给四个字段。
    if current_user_has_any_permission(FULL_USER_READ_PERMISSION_NAMES):
        user_data = service._serialize_users_with_xin_ya(users)
    else:
        user_data = [service._serialize_basic_user(user, include_membership=True) for user in users]

    return json_response(
        {
            "id": department.id,
            "name": department.name,
            # login 恒为 True（这条路由挂着 @login_required），但键要在 ——
            # 前端复用了 get_all_user_data 那套渲染逻辑，它会读这个字段。
            "login": True,
            "users": user_data,
        }
    )


# ─────────────────────────── 会员续费记录 ───────────────────────────


@router.get("/member_renewal/{user_id:int}")
@login_required
def get_member_renewals(user_id: int):
    if not current_user_has_any_permission(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES):
        return permission_denied_response(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES)
    user = User.query.get(user_id)
    if not user:
        return json_response({"status": "error", "message": "用户不存在"}, 404)
    return json_response(
        {"status": "success", "data": [item.to_dict() for item in user.member_renewals]}
    )


@router.post("/member_renewal/{user_id:int}")
@login_required
def create_member_renewal(
    user_id: int,
    form=Depends(_multipart_form),
    # ★ 原式是 ``request.form.get(k) or request.values.get(k)``。``request.values`` 是
    #   CombinedMultiDict([args, form])，所以整体等价于「先看表单，再看 query」。
    #   这两个 query 参数就是那个回落；声明成带默认值的 Optional 才不会在缺参数时变 422。
    renewal_date: Optional[str] = None,
    note: Optional[str] = None,
):
    """手工补一条会员续费记录（可选附一张凭证图）。multipart。"""
    if not current_user_has_any_permission(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES):
        return permission_denied_response(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES)
    user = User.query.get(user_id)
    if not user:
        return json_response({"status": "error", "message": "用户不存在"}, 404)

    try:
        form_data = _form_to_dict(form)
        renewal_date_raw = form_data.get("renewal_date") or renewal_date
        if not renewal_date_raw:
            return json_response({"status": "error", "message": "续费日期不能为空"}, 400)
        # 格式不对时 strptime 抛 ValueError，被下面那个 except ValueError 接成 400。
        renewal_date_value = datetime.strptime(renewal_date_raw, "%Y-%m-%d").date()
        # 两个字段名都认：前端历史上用过 proof，也用过 file。
        upload = _first_file(form, "proof") or _first_file(form, "file")
        saved = service._save_member_renewal_proof(user, upload) or {}

        record = MemberRenewal(
            user_id=user.id,
            renewal_date=renewal_date_value,
            note=(form_data.get("note") or note or "").strip() or None,
            proof_path=saved.get("proof_path"),
            proof_name=saved.get("proof_name"),
            proof_mime=saved.get("proof_mime"),
            created_by=current_user.id,
        )
        db.session.add(record)
        db.session.commit()
        return json_response(
            {"status": "success", "message": "会员续费已保存", "data": record.to_dict()}
        )
    except ValueError:
        db.session.rollback()
        return json_response({"status": "error", "message": "续费日期格式无效"}, 400)
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": f"保存失败: {str(exc)}"}, 500)


@router.delete("/member_renewal/{renewal_id:int}")
@login_required
def delete_member_renewal(renewal_id: int):
    if not current_user_has_any_permission(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES):
        return permission_denied_response(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES)
    record = MemberRenewal.query.get(renewal_id)
    if not record:
        return json_response({"status": "error", "message": "续费记录不存在"}, 404)
    proof_path = record.proof_path
    try:
        db.session.delete(record)
        db.session.commit()
        # 先提交再删文件：反过来的话事务回滚会留下「记录还在但凭证没了」。
        if proof_path:
            full_path = os.path.join(service.DATA_PATH, proof_path)
            if os.path.isfile(full_path):
                os.remove(full_path)
        return json_response({"status": "success", "message": "续费记录已删除"})
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": f"删除失败: {str(exc)}"}, 500)


# ─────────────────────────── 删用户 ───────────────────────────


@router.delete("/delete_user/{user_id:int}")
@login_required
@permission_required("member_edit")
def delete_user(user_id: int):
    """删用户。member_edit **不够**，还必须在 1 号群里 —— 这是全项目最后一道人工闸。"""
    if not any(department.id == 1 for department in current_user.departments):
        return json_response({"status": "error", "message": "无权限删除用户"}, 403)
    if user_id == 1:
        return json_response({"status": "error", "message": "不能删除系统管理员用户"}, 403)

    user = User.query.get(user_id)
    if not user:
        return json_response({"status": "error", "message": "用户不存在"}, 404)

    try:
        db.session.delete(user)
        db.session.commit()
        return json_response({"status": "success", "message": "用户删除成功"})
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": f"删除失败: {str(exc)}"}, 500)


# ─────────────────────────── 头像 ───────────────────────────


@router.post("/upload_profile_image")
@login_required
def upload_profile_image(form=Depends(_multipart_form)):
    """上传头像，一张图落成三个尺寸（S 600/q50、M 900/q80、L 1200/q100）。

    ★ 三条出错分支都回 **200**（只是 body 里 success=false）—— 原样保留，
      前端就是按 ``success`` 字段判断的，改成 4xx 会让它走到通用错误弹窗。
    ★ 文件名是 ``<username>_profile_image[_s|_l].jpg`` —— 用户名就是主键，
      所以改用户名时要同步改文件名（service._move_profile_images）。
    ★ 最后那句 ``File upload failed`` 是**死代码**：werkzeug 的 FileStorage
      ``__bool__`` 就是 ``bool(self.filename)``，而上一行刚判过 filename 非空。
      TODO(行为): 照搬不动；想删的话先确认没有前端在匹配这串文案。
    """
    file = _first_file(form, "image")
    # ``"image" not in request.files`` 的等价物：只看**文件**部分，
    # 客户端把 image 发成普通文本字段时 Flask 那边也是「No file part」。
    if file is None:
        return json_response({"success": False, "error": "No file part"})

    if (file.filename or "") == "":
        return json_response({"success": False, "error": "No selected file"})

    if file:
        # ``file.stream`` → starlette 的 ``file.file``。游标理论上在 0，
        # 显式回零更稳（spooled 文件不支持 seek 时忽略）。
        source = file.file
        try:
            source.seek(0)
        except (OSError, ValueError):
            pass
        img = Image.open(source).convert("RGB")
        generate_resized_image(
            img,
            os.path.join(PROFILE_PATH, f"{current_user.username}_profile_image_s.jpg"),
            (600, 600),
            50,
        )
        generate_resized_image(
            img,
            os.path.join(PROFILE_PATH, f"{current_user.username}_profile_image.jpg"),
            (900, 900),
            80,
        )
        generate_resized_image(
            img,
            os.path.join(PROFILE_PATH, f"{current_user.username}_profile_image_l.jpg"),
            (1200, 1200),
            100,
        )
        return json_response({"success": True})

    return json_response({"success": False, "error": "File upload failed"})


# 对应 Flask 的两个 @route 叠加（``/<username>`` 与 ``/<username>/<size>``）。
# **公开**：头像要能出现在未登录可见的名单页上。
#
# ★ 为什么拆成两个路由函数、而不是一个带 ``size: str = "M"`` 默认值的：
#   FastAPI 里「名字不在 path 里的带默认值参数」会变成**query 参数**，于是
#   ``/get_profile_image/bob?size=L`` 会真的返回 L 尺寸 —— 而 Flask 那边 query 被忽略、
#   永远是 M。今天没有调用点传 ?size（已 grep，只有 ?t= 缓存刷新参数），
#   但这是一条凭空多出来的入口，不留。两个函数共用下面的 _profile_image_response。


def _profile_image_response(username, size):
    """按用户名（或数字 id）取头像，找不到一律回落到 ``user.jpg``。

    ★ ``username.isdigit()`` 那一支是给「只知道 id」的调用点用的：
      查不到用户时**直接回默认头像**，不是 404 —— 名单页不该因为一个脏 id 就裂开。
    ★ size 只认 S/M/L 三个**大写**字面量，其余回 400（"s" 也算非法）。照搬，别放宽。
    ⚠️ send_file → FileResponse：兜底图 user.jpg 本身不存在时，Flask 是 404，
      这里会变成 500（FileResponse 在发送阶段抛 RuntimeError）。
      只在部署漏了这张图时才看得到。TODO(可选): 要对齐就先 os.path.exists 再决定。
    """
    if username.isdigit():
        user = User.query.get(int(username))
        if user:
            username = user.username
        else:
            return FileResponse(os.path.join(PROFILE_PATH, "user.jpg"))

    if size == "S":
        image_path = os.path.join(PROFILE_PATH, f"{username}_profile_image_s.jpg")
    elif size == "M":
        image_path = os.path.join(PROFILE_PATH, f"{username}_profile_image.jpg")
    elif size == "L":
        image_path = os.path.join(PROFILE_PATH, f"{username}_profile_image_l.jpg")
    else:
        return json_response({"success": False, "error": "Invalid size"}, 400)

    if os.path.exists(image_path):
        return FileResponse(image_path)
    return FileResponse(os.path.join(PROFILE_PATH, "user.jpg"))


@router.get("/get_profile_image/{username}")
def get_profile_image(username: str):
    return _profile_image_response(username, "M")


@router.get("/get_profile_image/{username}/{size}")
def get_profile_image_sized(username: str, size: str):
    return _profile_image_response(username, size)


# ─────────────────────────── 自助改资料 ───────────────────────────


@router.post("/update_user/{user_id:int}")
@login_required
def update_user(user_id: int, payload: Optional[dict] = _JSON_BODY):
    """自助改资料（也是 member_edit 改别人的另一个入口）。

    与 ``/edit_user_data`` 的区别在**字段白名单**：
      · 有 member_edit → SELF ∪ ADMIN_EXTRA（能改 is_member / name_NRIC / user_theme）
      · 没有           → SELF 去掉 email（自助改邮箱必须走 /email/change-request 的验证流程）
    没有 member_edit 又想改别人 → 403「你只能修改自己的资料」。
    """
    user = User.query.get(user_id)
    if not user:
        return json_response({"status": "error", "message": "用户不存在"}, 404)

    data = payload or {}
    try:
        user_permissions = get_current_user_permissions(current_user)
        can_edit_others = "member_edit" in user_permissions
        if current_user.id != user.id and not can_edit_others:
            return json_response({"status": "error", "message": "你只能修改自己的资料"}, 403)

        allowed_fields = set(service.SELF_EDITABLE_USER_FIELDS)
        if can_edit_others:
            allowed_fields |= service.ADMIN_EXTRA_EDITABLE_USER_FIELDS
        else:
            # 自助修改邮箱必须走 /email/change-request 的验证流程，这里不直接改 email。
            allowed_fields.discard("email")

        service._save_user_updates(user, data, allowed_fields=allowed_fields)
        return json_response({"status": "success", "message": "用户信息更新成功"})
    except ValueError as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 400)
    except IntegrityError:
        db.session.rollback()
        # ⚠️ 这条文案与 /edit_user_data 的那条**不一样**（少了「用户名」三个字）。
        # 原样保留：前端可能在按整串文案匹配。
        return json_response(
            {"status": "error", "message": "资料更新失败，可能是 Email 或 Phone 已重复"}, 400
        )
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": f"更新失败: {str(exc)}"}, 500)
