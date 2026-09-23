"""会员自助升级 / 续费 / 付款 / 名册 / 费用设置（原 backend/app/user_control/membership.py）。

这一层是 **service**：每个函数返回的就是最终 Response，router.py 只负责取参数再原样
``return`` 回去。搬迁时逻辑一行没动，只换了四样框架相关的东西：

  ① ``jsonify(x), code``          → ``core.responses.json_response(x, code)``（66 处）
  ② ``flask_login.current_user``  → ``core.auth.current_user``（ContextVar 代理，同接口；
                                     ``actor_user.display_name = ...`` 这种**写**操作
                                     也照常透传，代理实现了 __setattr__）
  ③ ``request.host_url`` 拼付款链接 → ``core.urls.absolute_url()``
                                     （见 _build_membership_payment_public_url 的注释，
                                      这不是风格调整，是 BASE_PATH 下的正确性修复）
  ④ ``send_file``                 → ``starlette.responses.FileResponse``

form 模块的 11 个符号改走 ``form_services`` 这座**延迟 import 桥** —— form 还没搬，
它顶上写着 ``from flask import ...``，顶层 import 会把整个 Flask 栈拉进进程。
理由和代价写在 form_services.py 的模块 docstring 里。

── 两条业务主线（读代码前先看这个）──────────────────────────────────

**生效条件是「财政 + 理事会」两个都要。** ``_maybe_activate_membership`` 是唯一的
生效入口：它要求 ``registration.fully_approved()``（付款 checked + 理事会签名够数）
才会真正把 ``user.is_member`` 置 True 并写一条 MemberRenewal。
付款审核通过（``update_membership_payment_status``）和理事会签名
（``council_sign.*``）各自调它一次，谁最后到齐谁触发。

**到期日是「续一年」不是「从今天起一年」。** ``_next_membership_expiry``：
当前到期日还没过就从到期日 +1 年，过了才从今天 +1 年 —— 所以提前续费不吃亏。
2 月 29 日那天续费会 ValueError，回落到次年 2 月 28 日（那个 except 分支）。

── 「看起来像 bug、故意保留」────────────────────────────────────────

  · ``_submit_membership_upgrade_internal`` 里，**没选推荐人**时的判断是
    ``if _membership_recommender_options(): return 400 请选择推荐人``。
    也就是说「系统里一个会员都没有」时反而放行、有会员时必填。
    这在第一个会员入会时是对的（没人可推荐），之后就变成了强制。照搬。
    TODO(行为): 想改成「永远必填」要先确认没有种子数据流程依赖这条。

  · ``_derive_username_from_text`` 的后缀循环上限是 1000，到顶返回 None，
    然后调用方抛「请填写 username」。也就是说同名到第 1000 个才会看到这句
    **与真实原因无关**的提示。照搬。

  · ``get_membership_roster`` 里 ``~User.id.in_(covered_user_ids or {0})``：
    covered 为空集时替换成 ``{0}``，因为 ``in_([])`` 在部分 SQLAlchemy 版本上会
    生成恒假条件 + 警告。``{0}`` 是「不存在的 id」，等价于不过滤。照搬。

  · ``_serialize_membership_registration`` 对每一份申请都跑一次
    ``_serialize_long_term_payment_settings``（要查费用表）。``/membership/entries``
    会 N+1。照搬 —— 合并查询会改变「某份申请的年龄段刚好没有匹配费用」时的取值。

  · ``get_membership_payment_context`` 里那个 ``except Exception: db.session.rollback()``
    把同步状态的失败**吞掉**继续往下走。原样保留：付款页宁可显示旧状态也不要整页挂掉。

★ 本文件**不能写 ``from __future__ import annotations``**：core.auth 的装饰器用
  functools.wraps 包过，FastAPI 求值注解时用的是 core/auth.py 的命名空间，
  开了那一行会在那里找不到 ``Optional`` 而启动即 NameError。
  （本文件没有路由，但全包统一遵守这一条。）
"""

import re
from datetime import date, datetime
from decimal import Decimal

from starlette.responses import FileResponse

from backend.api.user_control import form_services
from backend.api.user_control.form_services import MEMBERSHIP_FEE_SCOPE
from backend.core import council_sign
from backend.core.auth import current_user, get_current_user_permissions
from backend.core.db import db
from backend.core.responses import json_response
from backend.core.urls import absolute_url
from backend.models.form import RegisPayment
from backend.models.membership_registration import (
    COUNCIL_APPROVAL_MAX,
    COUNCIL_APPROVAL_REQUIRED,
    MEMBERSHIP_ROLE_OPTIONS,
    MembershipCouncilSignature,
    MembershipRegistration,
)
from backend.models.user_data import MemberRenewal, User
from backend.models.youth_class_registration import YouthClassRegistration


def _clean_text(value):
    normalized = str(value or "").strip()
    return normalized or None


def _clean_phone(value):
    return _clean_text(value)


def _clean_username(value):
    normalized = str(value or "").strip()
    if not normalized:
        return None
    if any(char.isspace() for char in normalized):
        raise ValueError("username 不能包含空格")
    return normalized


def _derive_username_from_text(value, *, member_id=None, actor_user_id=None):
    """报名表 username 留空时，用英文名推导一个：小写、只保留字母数字。

    例如 "Hazell Tan" -> "hazelltan"；已被别人占用就往后加 2、3……
    """
    base = re.sub(r"[^a-z0-9]", "", str(value or "").lower())
    if not base:
        return None

    candidate = base
    for suffix in range(2, 1000):
        existing = User.query.filter_by(username=candidate).first()
        if existing is None:
            return candidate
        if member_id is not None and existing.nric_asset_id == member_id:
            return candidate
        if actor_user_id is not None and existing.id == actor_user_id:
            return candidate
        candidate = f"{base}{suffix}"
    return None


def _authenticated_user_or_none():
    if getattr(current_user, "is_authenticated", False):
        return current_user
    return None


def _long_open_route_for_age(age):
    if age is None:
        return {
            "target": None,
            "target_label": None,
            "eligible": False,
            "message": "还无法根据年龄判断报名入口",
        }
    if age < 13:
        return {
            "target": "ineligible",
            "target_label": "暂不开放",
            "eligible": False,
            "message": f"年龄 {age} 岁，目前长期开放报名入口只开放给 13 岁及以上。",
        }
    if age <= 17:
        return {
            "target": "youth_class",
            "target_label": "青少年佛学班",
            "eligible": True,
            "message": f"年龄 {age} 岁，请填写青少年佛学班报名。",
        }
    return {
        "target": "membership",
        "target_label": "会员",
        "eligible": True,
        "message": f"年龄 {age} 岁，请填写会员报名。",
    }


def _coerce_bool(value):
    if isinstance(value, bool):
        return value
    normalized = str(value or "").strip().lower()
    if normalized in {"1", "true", "yes", "y", "是"}:
        return True
    if normalized in {"0", "false", "no", "n", "否"}:
        return False
    return None


def _member_age(member):
    nric = _clean_text(getattr(member, "nric", None))
    if not nric:
        return None
    try:
        return form_services._calc_age_from_nric(nric)
    except ValueError:
        return None


def _is_minor(member):
    age = _member_age(member)
    return age is not None and age < 18


def _current_membership_expiry(user):
    latest = (
        MemberRenewal.query.filter_by(user_id=user.id)
        .order_by(MemberRenewal.renewal_date.desc(), MemberRenewal.id.desc())
        .first()
    )
    return latest.renewal_date if latest else None


def _next_membership_expiry(user):
    current_expiry = _current_membership_expiry(user)
    base_date = current_expiry if current_expiry and current_expiry > date.today() else date.today()
    try:
        return base_date.replace(year=base_date.year + 1)
    except ValueError:
        return base_date.replace(month=2, day=28, year=base_date.year + 1)


def _latest_membership_registration(user_id, registration_type):
    return (
        MembershipRegistration.query.filter_by(user_id=user_id, registration_type=registration_type)
        .order_by(MembershipRegistration.submitted_at.desc(), MembershipRegistration.id.desc())
        .first()
    )


def _sync_membership_registration_status(registration):
    if not registration:
        return False
    original_status = registration.status
    registration.sync_status_from_payment()
    return registration.status != original_status


def _build_membership_payment_public_url(registration):
    """付款页的**对外**完整链接（发给申请人去付款的那条）。

    ★ 原式是 ``f"{request.host_url.rstrip('/')}/template/membership-payment?t={token}"``。
      FastAPI 里没有 host_url，而且照搬它本身就是错的（见 core/urls.py 顶部）：
        · nginx 的 rewrite 把 /UTBA_DEMO 前缀剥掉了，host_url 拼出来**缺前缀** -> 404；
        · 漏配 proxy_set_header Host 的 location 上会拼出 127.0.0.1:5102；
        · Host 头是客户端可伪造的，拿它生成链接等于开放一个钓鱼入口。
      core.urls.absolute_url() 就是为这件事造的（origin 取配置优先），
      core/council_sign.py 的两条签名链接已经这么改过了，这里保持一致。
      前提：跑后台任务/非请求上下文时 APP_PUBLIC_ORIGIN 必须配上，
      否则 absolute_url 会退化成相对路径（会打一条 warning）。
    """
    token = str(getattr(registration, "payment_token", "") or "").strip()
    if not token:
        return None
    return absolute_url(f"/template/membership-payment?t={token}")


def _serialize_membership_registration(registration):
    if not registration:
        return None
    age = _member_age(registration.member)
    settings = form_services._serialize_long_term_payment_settings(age=age, fee_scope=MEMBERSHIP_FEE_SCOPE)
    data = registration.to_dict()
    data["payment_url"] = _build_membership_payment_public_url(registration)
    data["age"] = age
    data["selected_fee"] = settings.get("selected_fee")
    data["fee_amount"] = settings.get("amount")
    data["fee_description"] = settings.get("description")

    return council_sign.augment_serialized("membership", registration, data)


def _membership_settings_payload(age=None):
    return form_services._serialize_long_term_payment_settings(age=age, fee_scope=MEMBERSHIP_FEE_SCOPE)


def _membership_payment_snapshot(registration):
    member = getattr(registration, "member", None)
    user = getattr(registration, "user", None)
    name = (
        getattr(user, "display_name", None)
        or getattr(member, "name_nric", None)
        or getattr(user, "username", None)
        or "会员付款"
    )
    phone = (
        getattr(registration, "phone", None)
        or getattr(user, "phone", None)
        or getattr(registration, "emergency_contact_phone", None)
        or ""
    )
    nric = str(getattr(member, "nric", None) or "")
    return name, phone, nric


def _membership_renewal_for_registration(registration):
    if not registration or not registration.target_expiry_date:
        return None
    return (
        MemberRenewal.query.filter_by(
            user_id=registration.user_id,
            renewal_date=registration.target_expiry_date,
        )
        .order_by(MemberRenewal.id.desc())
        .first()
    )


def _membership_recommender_options():
    query = User.query.filter(User.is_member.is_(True))
    authenticated_user = _authenticated_user_or_none()
    if authenticated_user is not None:
        query = query.filter(User.id != authenticated_user.id)
    users = query.order_by(User.display_name.asc(), User.username.asc()).all()
    options = []
    for user in users:
        label = user.display_name or getattr(user.nric_asset, "name_nric", None) or user.username
        options.append(
            {
                "id": user.id,
                "label": label or f"成员 #{user.id}",
                "username": user.username,
                "display_name": user.display_name,
            }
        )
    return options


def _ensure_membership_access(registration):
    authenticated_user = _authenticated_user_or_none()
    if authenticated_user and registration.user_id == authenticated_user.id:
        return None

    if authenticated_user:
        permissions = get_current_user_permissions(authenticated_user)
    else:
        permissions = set()
    if "account_edit" in permissions or "member_edit" in permissions:
        return None

    return json_response({"status": "error", "message": "无权访问这份会员资料"}, 403)


def _membership_role_for_current_user():
    latest = (
        MembershipRegistration.query.filter_by(user_id=current_user.id)
        .filter(MembershipRegistration.membership_role.isnot(None))
        .order_by(MembershipRegistration.submitted_at.desc(), MembershipRegistration.id.desc())
        .first()
    )
    if latest and latest.membership_role:
        return latest.membership_role
    return "普通会员"


def _ensure_registration_target_expiry(registration):
    if registration.target_expiry_date:
        return registration.target_expiry_date
    registration.target_expiry_date = _next_membership_expiry(registration.user)
    return registration.target_expiry_date


def _serialize_public_user(user):
    if not user:
        return None
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "email": user.email,
        "phone": user.phone,
        "gender": user.gender,
        "is_member": bool(user.is_member),
        "has_password": bool(user.password_hash),
    }


def _first_clean_text(*values):
    for value in values:
        normalized = _clean_text(value)
        if normalized:
            return normalized
    return None


def _latest_youth_profile_registration(member):
    if not member:
        return None
    return (
        YouthClassRegistration.query.filter_by(nric_asset_id=member.id)
        .order_by(YouthClassRegistration.submitted_at.desc(), YouthClassRegistration.id.desc())
        .first()
    )


def _profile_prefill_defaults(user, member, latest_registration=None):
    latest_member_data = member.latest_data() if member else None
    latest_youth = _latest_youth_profile_registration(member)
    return {
        "english_name": _first_clean_text(
            getattr(latest_registration, "english_name", None),
            getattr(latest_member_data, "name", None),
            getattr(latest_youth, "english_name", None),
        ),
        "phone": _first_clean_text(
            getattr(latest_registration, "phone", None),
            getattr(latest_member_data, "phone", None),
            getattr(latest_youth, "phone", None),
            getattr(user, "phone", None),
        ),
        "gender": _first_clean_text(
            getattr(latest_registration, "gender", None),
            getattr(latest_member_data, "gender", None),
            getattr(latest_youth, "gender", None),
            getattr(user, "gender", None),
        ),
        "address": _first_clean_text(
            getattr(latest_registration, "nric_address", None),
            getattr(latest_member_data, "address", None),
            getattr(latest_youth, "address", None),
        ),
    }


def _latest_public_membership_registration(member_id):
    return (
        MembershipRegistration.query.filter_by(
            nric_asset_id=member_id,
            registration_type="upgrade",
            user_id=None,
        )
        .order_by(MembershipRegistration.submitted_at.desc(), MembershipRegistration.id.desc())
        .first()
    )


def _validate_requested_username(requested_username, *, actor_user=None, member=None):
    if not requested_username:
        return None

    existing_user = User.query.filter_by(username=requested_username).first()
    if existing_user is None:
        return None

    if actor_user is not None and existing_user.id == actor_user.id:
        return existing_user

    if member is not None and existing_user.nric_asset_id == member.id:
        return existing_user

    raise ValueError("这个 username 已被其他账号使用，请换一个")


def _resolve_membership_submission_target(payload, *, actor_user=None):
    requested_username = None
    applicant_name = _clean_text(payload.get("display_name")) or _clean_text(payload.get("full_name"))
    english_name = _clean_text(payload.get("english_name"))

    if actor_user is not None:
        if actor_user.is_member:
            raise ValueError("当前账号已是会员，请直接使用续费入口")

        requested_username = actor_user.username
        if not requested_username:
            requested_username = _clean_username(payload.get("username"))

        member = actor_user.nric_asset
        if member and _clean_text(getattr(member, "nric", None)):
            if applicant_name and not _clean_text(getattr(member, "name_nric", None)):
                member.name_nric = applicant_name
        else:
            nric = _clean_text(payload.get("nric"))
            if not nric:
                raise ValueError("请先在 Profile 资料页填写并保存 NRIC，或在这里补上 NRIC")
            member = form_services._get_or_create_member_by_nric(
                nric,
                name_nric=applicant_name or actor_user.display_name or actor_user.username,
            )
            actor_user.nric_asset = member

        age = _member_age(member)
        if age is None:
            raise ValueError("当前 NRIC 无法解析年龄，请先检查资料")

        if applicant_name and not _clean_text(actor_user.display_name):
            actor_user.display_name = applicant_name
    else:
        requested_username = _clean_username(payload.get("username"))

        nric = _clean_text(payload.get("nric"))
        if not nric:
            raise ValueError("请填写 NRIC")
        if not applicant_name:
            raise ValueError("请填写姓名")

        member = form_services._get_or_create_member_by_nric(nric, name_nric=applicant_name)
        age = _member_age(member)
        if age is None:
            raise ValueError("当前 NRIC 无法解析年龄，请先检查资料")

    if not requested_username:
        requested_username = _derive_username_from_text(
            english_name or applicant_name,
            member_id=getattr(member, "id", None),
            actor_user_id=getattr(actor_user, "id", None),
        )
    if not requested_username:
        raise ValueError("请填写 username")

    if age < 18:
        raise ValueError("18 岁以下请改走青少年佛学班报名入口")

    _validate_requested_username(requested_username, actor_user=actor_user, member=member)
    return member, age, requested_username, applicant_name


def _ensure_approved_membership_user(registration):
    member = getattr(registration, "member", None)
    requested_username = _clean_username(getattr(registration, "requested_username", None))
    target_user = registration.user

    if target_user is None:
        if not requested_username:
            raise ValueError("这份会员申请还没有填写 username，暂时无法写入 user_data")

        target_user = User.query.filter_by(username=requested_username).first()
        if target_user is None:
            target_user = User(
                username=requested_username,
                display_name=getattr(member, "name_nric", None) or requested_username,
                nric_asset_id=registration.nric_asset_id,
                created_by=getattr(current_user, "id", None),
                display=True,
                is_member=False,
            )
            db.session.add(target_user)
            db.session.flush()
        elif registration.nric_asset_id and target_user.nric_asset_id not in (None, registration.nric_asset_id):
            raise ValueError("这个 username 已关联到另一份成员资料，无法自动写入 user_data")

        registration.user = target_user
        registration.user_id = target_user.id

    if requested_username and not target_user.username:
        duplicated = User.query.filter(User.username == requested_username, User.id != target_user.id).first()
        if duplicated:
            raise ValueError("这个 username 已被其他账号使用，请先调整后再审核通过")
        target_user.username = requested_username

    if registration.nric_asset_id and target_user.nric_asset_id in (None, registration.nric_asset_id):
        target_user.nric_asset_id = registration.nric_asset_id
    elif registration.nric_asset_id and target_user.nric_asset_id != registration.nric_asset_id:
        raise ValueError("这份会员申请关联的成员资料和现有 user_data 不一致，请先手动处理")

    if not _clean_text(target_user.display_name):
        target_user.display_name = getattr(member, "name_nric", None) or target_user.username

    return target_user


def _apply_membership_approval(registration):
    target_user = _ensure_approved_membership_user(registration)
    expiry_date = _ensure_registration_target_expiry(registration)
    renewal = _membership_renewal_for_registration(registration)

    if renewal is None:
        note = "会员续费审核通过" if registration.registration_type == "renew" else "会员升级审核通过"
        renewal = MemberRenewal(
            user_id=target_user.id,
            renewal_date=expiry_date,
            note=note,
            created_by=current_user.id,
        )
        db.session.add(renewal)

    target_user.is_member = True
    registration.status = "paid"
    return renewal


def _maybe_activate_membership(registration):
    """财政 + 理事会都通过后，才真正生效并开始注册日期。"""
    if registration.status == "paid":
        return False
    if not registration.fully_approved():
        return False
    _apply_membership_approval(registration)
    return True


def add_membership_council_signature(registration_id, data=None):
    return council_sign.add_council_signature("membership", registration_id, data)


# 注册会员 scope 到共用理事会签名模块（backend/core/council_sign.py）。
# ⚠️ 这行是 **import 期副作用**：只有本模块被 import 过，council_sign 才认识
#    "membership" 这个 scope。router.py 顶层 import 了本模块，所以永远成立。
#    反过来，青少年佛学班那个 scope 由 app/form/services.py 注册 —— form 还没搬，
#    所以带 youth_class token 的签名链接目前会回「未知的签名类型。」。
#    TODO(form 搬完时): 确认 api/form 的 service 也在 import 期注册了 youth_class。
council_sign.register_scope(
    council_sign.CouncilScope(
        scope="membership",
        signature_model=MembershipCouncilSignature,
        fk_attr="membership_registration_id",
        signatures_attr="council_signatures",
        max_signatures=COUNCIL_APPROVAL_MAX,
        get_registration=lambda rid: MembershipRegistration.query.get(rid),
        applicant_name=lambda reg: _membership_payment_snapshot(reg)[0],
        consent_object="会员",
        org_name="地南佛学会",
        activate=_maybe_activate_membership,
        serialize=_serialize_membership_registration,
    )
)


MEMBERSHIP_EDITABLE_FIELDS = {
    "facebook_profile_url",
    "english_name",
    "phone",
    "gender",
    "nric_address",
    "ancestral_home",
    "occupation",
    "refuge_master",
    "dharma_name",
    "emergency_contact_name",
    "emergency_contact_phone",
    "membership_role",
    "recommender_name",
}


def update_membership_registration_fields(registration_id, data):
    registration = MembershipRegistration.query.get(registration_id)
    if not registration:
        return json_response({"status": "error", "message": "会员申请不存在"}, 404)

    if registration.status == "paid":
        return json_response({"status": "error", "message": "该会员申请已经生效，无法再修改资料。"}, 400)

    if not isinstance(data, dict):
        return json_response({"status": "error", "message": "请求格式错误"}, 400)

    unknown = set(data.keys()) - MEMBERSHIP_EDITABLE_FIELDS - {"refuge_year"}
    if unknown:
        return json_response({"status": "error", "message": f"以下字段不可编辑：{', '.join(sorted(unknown))}"}, 400)

    try:
        for field in MEMBERSHIP_EDITABLE_FIELDS:
            if field not in data:
                continue
            if field == "membership_role":
                value = _clean_text(data.get(field))
                if value and value not in MEMBERSHIP_ROLE_OPTIONS:
                    return json_response({"status": "error", "message": "加入身份无效"}, 400)
                registration.membership_role = value
            elif field == "gender":
                value = _clean_text(data.get(field))
                if value and value not in {"男", "女"}:
                    return json_response({"status": "error", "message": "性别无效"}, 400)
                registration.gender = value
            elif field == "recommender_name":
                # recommender_name 只读展示，通过 recommender_user_id 维护，忽略直接改名
                continue
            else:
                setattr(registration, field, _clean_text(data.get(field)))

        if "refuge_year" in data:
            raw_year = _clean_text(data.get("refuge_year"))
            if not raw_year:
                registration.refuge_year = None
            else:
                try:
                    year = int(raw_year)
                except (TypeError, ValueError):
                    return json_response({"status": "error", "message": "皈依年份格式无效"}, 400)
                if year < 1900 or year > datetime.utcnow().year:
                    return json_response({"status": "error", "message": "皈依年份超出合理范围"}, 400)
                registration.refuge_year = year

        db.session.commit()
        return json_response(
            {
                "status": "success",
                "message": "资料已更新",
                "registration": _serialize_membership_registration(registration),
            }
        )
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


def _submit_membership_upgrade_internal(payload, *, actor_user=None):
    try:
        member, age, requested_username, applicant_name = _resolve_membership_submission_target(
            payload,
            actor_user=actor_user,
        )
    except ValueError as exc:
        return json_response({"status": "error", "message": str(exc)}, 400)

    facebook_profile_url = _clean_text(payload.get("facebook_profile_url"))
    english_name = _clean_text(payload.get("english_name"))
    phone = _clean_phone(payload.get("phone"))
    gender = _clean_text(payload.get("gender"))
    nric_address = _clean_text(payload.get("nric_address"))
    ancestral_home = _clean_text(payload.get("ancestral_home"))
    occupation = _clean_text(payload.get("occupation"))
    refuge_taken = _coerce_bool(payload.get("refuge_taken"))
    refuge_year_raw = _clean_text(payload.get("refuge_year"))
    refuge_master = _clean_text(payload.get("refuge_master"))
    dharma_name = _clean_text(payload.get("dharma_name"))
    emergency_contact_name = _clean_text(payload.get("emergency_contact_name"))
    emergency_contact_phone = _clean_phone(payload.get("emergency_contact_phone"))
    membership_role = _clean_text(payload.get("membership_role"))

    if not facebook_profile_url:
        return json_response({"status": "error", "message": "请填写 Facebook 个人主页链接"}, 400)
    if gender and gender not in {"男", "女"}:
        return json_response({"status": "error", "message": "性别无效"}, 400)
    if not nric_address:
        return json_response({"status": "error", "message": "请填写 NRIC_address / 住家地址"}, 400)
    if not ancestral_home:
        return json_response({"status": "error", "message": "请填写籍贯"}, 400)
    if not occupation:
        return json_response({"status": "error", "message": "请填写职业"}, 400)
    if refuge_taken is None:
        return json_response({"status": "error", "message": "请填写是否皈依"}, 400)
    if not emergency_contact_name or not emergency_contact_phone:
        return json_response({"status": "error", "message": "请完整填写紧急联络人资料"}, 400)
    if membership_role not in MEMBERSHIP_ROLE_OPTIONS:
        return json_response({"status": "error", "message": "加入身份无效"}, 400)

    refuge_year = None
    if refuge_taken:
        if not refuge_year_raw:
            return json_response({"status": "error", "message": "已皈依者请填写皈依年份"}, 400)
        try:
            refuge_year = int(refuge_year_raw)
        except (TypeError, ValueError):
            return json_response({"status": "error", "message": "皈依年份格式无效"}, 400)

        current_year = datetime.utcnow().year
        if refuge_year < 1900 or refuge_year > current_year:
            return json_response({"status": "error", "message": "皈依年份超出合理范围"}, 400)
        if not refuge_master:
            return json_response({"status": "error", "message": "请填写皈依证明法师"}, 400)
    else:
        refuge_master = None
        refuge_year = None
        dharma_name = None

    recommender_user_id = payload.get("recommender_user_id")
    recommender = None
    if recommender_user_id not in (None, ""):
        try:
            recommender_user_id = int(recommender_user_id)
        except (TypeError, ValueError):
            return json_response({"status": "error", "message": "推荐人无效"}, 400)
        recommender = User.query.filter_by(id=recommender_user_id, is_member=True).first()
        if not recommender:
            return json_response({"status": "error", "message": "推荐人必须来自现有会员名单"}, 400)
    else:
        recommender_user_id = None
        if _membership_recommender_options():
            return json_response({"status": "error", "message": "请选择推荐人"}, 400)

    if actor_user is not None:
        existing = _latest_membership_registration(actor_user.id, "upgrade")
    else:
        existing = _latest_public_membership_registration(member.id)

    latest_payment = existing.latest_membership_payment() if existing else None
    if existing and latest_payment and latest_payment.status == "checked":
        changed = _sync_membership_registration_status(existing)
        if changed:
            db.session.commit()
        return json_response(
            {
                "status": "success",
                "message": "你已有已提交的会员升级申请，正在等待审核。",
                "registration": _serialize_membership_registration(existing),
                "payment_url": _build_membership_payment_public_url(existing),
                "payment_required": False,
            }
        )

    try:
        if existing:
            registration = existing
        else:
            registration = MembershipRegistration(
                registration_type="upgrade",
                user_id=actor_user.id if actor_user is not None else None,
                nric_asset_id=member.id,
                status="process",
            )
            db.session.add(registration)

        registration.user_id = actor_user.id if actor_user is not None else registration.user_id
        registration.nric_asset_id = member.id
        registration.requested_username = requested_username
        registration.facebook_profile_url = facebook_profile_url
        registration.english_name = english_name
        registration.phone = phone
        registration.gender = gender
        registration.nric_address = nric_address
        registration.ancestral_home = ancestral_home
        registration.occupation = occupation
        registration.refuge_taken = refuge_taken
        registration.refuge_year = refuge_year
        registration.refuge_master = refuge_master
        registration.dharma_name = dharma_name
        registration.emergency_contact_name = emergency_contact_name
        registration.emergency_contact_phone = emergency_contact_phone
        registration.guardian_name = None
        registration.guardian_phone = None
        registration.recommender_user_id = recommender.id if recommender else None
        registration.membership_role = membership_role
        registration.status = "process"

        if applicant_name and not _clean_text(getattr(member, "name_nric", None)):
            member.name_nric = applicant_name
        if not _clean_text(getattr(member, "name_nric", None)):
            member.name_nric = (
                getattr(actor_user, "display_name", None)
                or getattr(actor_user, "username", None)
                or requested_username
            )

        db.session.commit()
        settings = _membership_settings_payload(age=age)
        payment_required = bool(settings.get("payment_enabled"))
        return json_response(
            {
                "status": "success",
                "message": "会员升级资料已保存。",
                "registration": _serialize_membership_registration(registration),
                "payment_url": _build_membership_payment_public_url(registration),
                "payment_required": payment_required,
            }
        )
    except ValueError as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 400)
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


def get_membership_context():
    member = current_user.nric_asset
    age = _member_age(member)
    is_minor = _is_minor(member) if member else False
    next_expiry = _current_membership_expiry(current_user)
    latest_upgrade = _latest_membership_registration(current_user.id, "upgrade")
    latest_renewal = _latest_membership_registration(current_user.id, "renew")

    changed = False
    changed = _sync_membership_registration_status(latest_upgrade) or changed
    changed = _sync_membership_registration_status(latest_renewal) or changed
    if changed:
        db.session.commit()

    return json_response(
        {
            "status": "success",
            "context": {
                "user": {
                    "id": current_user.id,
                    "username": current_user.username,
                    "display_name": current_user.display_name,
                    "email": current_user.email,
                    "phone": current_user.phone,
                    "gender": current_user.gender,
                    "is_member": bool(current_user.is_member),
                },
                "member": (
                    {
                        "id": member.id,
                        "nric": member.nric,
                        "name_nric": member.name_nric,
                    }
                    if member
                    else None
                ),
                "age": age,
                "is_minor": is_minor,
                "next_expiry_date": next_expiry.isoformat() if next_expiry else None,
                "missing_nric": not bool(member and _clean_text(member.nric)),
                "role_options": list(MEMBERSHIP_ROLE_OPTIONS),
                "recommenders": _membership_recommender_options(),
                "settings": _membership_settings_payload(age=age),
                "profile_defaults": _profile_prefill_defaults(current_user, member, latest_upgrade),
                "latest_upgrade": _serialize_membership_registration(latest_upgrade),
                "latest_renewal": _serialize_membership_registration(latest_renewal),
            },
        }
    )


def get_public_membership_context():
    actor_user = _authenticated_user_or_none()
    member = actor_user.nric_asset if actor_user is not None else None
    age = _member_age(member)
    route = _long_open_route_for_age(age)
    latest_upgrade = None
    latest_renewal = None
    changed = False

    if actor_user is not None:
        latest_upgrade = _latest_membership_registration(actor_user.id, "upgrade")
        latest_renewal = _latest_membership_registration(actor_user.id, "renew")
        changed = _sync_membership_registration_status(latest_upgrade) or changed
        changed = _sync_membership_registration_status(latest_renewal) or changed
        if changed:
            db.session.commit()

    return json_response(
        {
            "status": "success",
            "context": {
                "user": _serialize_public_user(actor_user),
                "member": (
                    {
                        "id": member.id,
                        "nric": member.nric,
                        "name_nric": member.name_nric,
                    }
                    if member
                    else None
                ),
                "age": age,
                "is_minor": bool(age is not None and age < 18),
                "registration_route": route,
                "missing_nric": not bool(member and _clean_text(member.nric)),
                "role_options": list(MEMBERSHIP_ROLE_OPTIONS),
                "recommenders": _membership_recommender_options(),
                "profile_defaults": _profile_prefill_defaults(actor_user, member, latest_upgrade),
                "latest_upgrade": _serialize_membership_registration(latest_upgrade),
                "latest_renewal": _serialize_membership_registration(latest_renewal),
            },
        }
    )


def get_long_open_registration_route(nric):
    nric = _clean_text(nric)
    if not nric:
        return json_response({"status": "error", "message": "缺少 NRIC"}, 400)

    try:
        age = form_services._calc_age_from_nric(nric)
    except ValueError as exc:
        return json_response({"status": "error", "message": str(exc)}, 400)

    route = _long_open_route_for_age(age)
    return json_response({"status": "success", "age": age, **route})


def submit_membership_upgrade(payload):
    return _submit_membership_upgrade_internal(payload, actor_user=current_user)


def submit_public_membership_upgrade(payload):
    return _submit_membership_upgrade_internal(payload, actor_user=_authenticated_user_or_none())


def start_membership_renewal():
    if not current_user.is_member:
        return json_response({"status": "error", "message": "当前账号尚未启用会员身份"}, 400)

    member = current_user.nric_asset
    if not member or not _clean_text(member.nric):
        return json_response({"status": "error", "message": "请先在 Profile 资料页填写并绑定 NRIC"}, 400)

    existing = _latest_membership_registration(current_user.id, "renew")
    latest_payment = existing.latest_membership_payment() if existing else None

    if existing and latest_payment and latest_payment.status == "checked":
        changed = _sync_membership_registration_status(existing)
        if changed:
            db.session.commit()
        return json_response(
            {
                "status": "success",
                "message": "你已有一笔续费资料正在等待审核。",
                "registration": _serialize_membership_registration(existing),
                "payment_url": _build_membership_payment_public_url(existing),
            }
        )

    try:
        if existing:
            registration = existing
        else:
            registration = MembershipRegistration(
                registration_type="renew",
                user_id=current_user.id,
                nric_asset_id=member.id,
                status="process",
            )
            db.session.add(registration)

        registration.nric_asset_id = member.id
        registration.membership_role = _membership_role_for_current_user()
        registration.target_expiry_date = _next_membership_expiry(current_user)
        registration.status = "process"
        db.session.commit()
        return json_response(
            {
                "status": "success",
                "message": "续费链接已生成。",
                "registration": _serialize_membership_registration(registration),
                "payment_url": _build_membership_payment_public_url(registration),
            }
        )
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


def get_membership_payment_context(token):
    token = _clean_text(token)
    if not token:
        return json_response({"status": "error", "message": "缺少付款 token"}, 400)

    registration = MembershipRegistration.query.filter_by(payment_token=token).first()
    if not registration:
        return json_response({"status": "error", "message": "付款链接无效"}, 404)

    try:
        if _sync_membership_registration_status(registration):
            db.session.commit()
    except Exception:
        db.session.rollback()

    settings = _membership_settings_payload(age=_member_age(registration.member))
    latest_payment = registration.latest_membership_payment()
    payment_enabled = bool(settings.get("payment_enabled"))
    can_submit = payment_enabled and not (latest_payment and latest_payment.status == "checked")

    return json_response(
        {
            "status": "success",
            "registration": _serialize_membership_registration(registration),
            "settings": settings,
            "latest_payment": latest_payment.to_dict() if latest_payment else None,
            "can_submit": can_submit,
        }
    )


def submit_membership_payment(token, data, proof_image):
    token = _clean_text(token)
    if not token:
        return json_response({"status": "error", "message": "缺少付款 token"}, 400)

    registration = MembershipRegistration.query.filter_by(payment_token=token).first()
    if not registration:
        return json_response({"status": "error", "message": "付款链接无效"}, 404)

    settings = _membership_settings_payload(age=_member_age(registration.member))
    if not settings:
        return json_response({"status": "error", "message": "管理员暂未配置会员费用"}, 400)

    selected_fee = settings.get("selected_fee")
    amount = Decimal(str(settings.get("amount") or 0))
    if not selected_fee or amount <= 0:
        return json_response({"status": "error", "message": "当前没有适合你年龄的会员费用选项，请联系管理员"}, 400)

    latest_payment = registration.latest_membership_payment()
    if latest_payment and latest_payment.status == "checked":
        return json_response({"status": "error", "message": "系统显示你已完成付款，无需重复提交"}, 400)

    payment_mode = _clean_text(data.get("payment_mode")) or "QR"

    try:
        proof_image_path = form_services._save_register_payment_proof(proof_image)
        payment_name, payment_phone, payment_nric = _membership_payment_snapshot(registration)
        payment = RegisPayment(
            regis_form_id=None,
            payment_scope=MEMBERSHIP_FEE_SCOPE,
            membership_registration_id=registration.id,
            nric_asset_id=registration.nric_asset_id,
            nric=payment_nric,
            name=payment_name,
            phone=payment_phone,
            payment_mode=payment_mode,
            price=amount,
            status="process",
            proof_image_path=proof_image_path,
            created_at=datetime.utcnow(),
            date=datetime.utcnow().date(),
            time=datetime.utcnow().time(),
        )
        db.session.add(payment)
        registration.status = "process"
        db.session.commit()
        success_message = "续费资料已提交，请等待审核。"
        if registration.registration_type == "upgrade":
            success_message = "会员升级付款已提交，请等待审核。"
        return json_response(
            {
                "status": "success",
                "message": success_message,
                "payment": payment.to_dict(),
                "registration": _serialize_membership_registration(registration),
            }
        )
    except ValueError as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 400)
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


def get_membership_payment_proof_image(payment_id):
    payment = form_services._get_scoped_regis_payment_or_404(payment_id, MEMBERSHIP_FEE_SCOPE)
    registration = payment.membership_registration

    access_error = _ensure_membership_access(registration)
    if access_error is not None:
        return access_error

    image_path = form_services._resolve_register_payment_proof(payment.proof_image_path)
    if not image_path:
        return json_response({"status": "error", "message": "付款截图不存在"}, 404)
    # send_file -> FileResponse：两者都按文件名猜 Content-Type，都走流式（支持 Range）。
    # image_path 是 Path（_resolve_register_payment_proof 的返回值），FileResponse 直接吃。
    return FileResponse(image_path)


def get_membership_payment_settings():
    return json_response({"status": "success", "settings": _membership_settings_payload()})


def update_membership_payment_settings(data):
    try:
        fee_rows, old_fee_image_paths = form_services._replace_scoped_registration_fees(
            MEMBERSHIP_FEE_SCOPE,
            data.get("fees") if data.get("fees") is not None else data.get("fee_options"),
        )

        db.session.commit()

        new_fee_image_paths = form_services._collect_long_term_fee_images(fee_rows)
        for removed_path in old_fee_image_paths - new_fee_image_paths:
            form_services._delete_register_fee_image(removed_path)

        return json_response(
            {
                "status": "success",
                "message": "会员费用选项已更新",
                "settings": form_services._serialize_long_term_payment_settings(
                    fee_scope=MEMBERSHIP_FEE_SCOPE,
                    fee_source=fee_rows,
                ),
            }
        )
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


PERMANENT_MEMBER_DATE = date(2099, 12, 31)


def get_membership_roster():
    """会员名册：以 MemberRenewal 为准聚合每个人（含无登录账号的老会员），
    另补上有 is_member 标记但没有续费记录的账号。"""
    from backend.models.form import NRIC_Asset

    renewals = MemberRenewal.query.order_by(MemberRenewal.renewal_date.desc()).all()
    today = date.today()

    groups = {}  # key: ("a", nric_asset_id) 或 ("u", user_id)

    def group_for(renewal):
        if renewal.nric_asset_id:
            return ("a", renewal.nric_asset_id)
        if renewal.user_id:
            return ("u", renewal.user_id)
        return None

    for r in renewals:
        key = group_for(r)
        if key is None:
            continue
        groups.setdefault(key, []).append(r)

    covered_user_ids = set()
    rows = []
    for key, items in groups.items():
        asset = None
        user = None
        if key[0] == "a":
            asset = db.session.get(NRIC_Asset, key[1])
            user = next((r.user for r in items if r.user), None)
            if user is None and asset is not None:
                user = next(iter(asset.linked_users or []), None)
        else:
            user = db.session.get(User, key[1])
            if user is not None:
                asset = user.nric_data

        if user is not None:
            covered_user_ids.add(user.id)

        candidates = []
        if asset is not None:
            latest = asset.latest_data() if hasattr(asset, "latest_data") else None
            candidates += [asset.name_nric]
            if latest is not None:
                candidates += [getattr(latest, "name_cn", None), getattr(latest, "name", None)]
        if user is not None:
            candidates += [user.display_name, user.username]
        candidates = [c for c in candidates if c and str(c).strip()]
        # 优先取带中文的名字
        name = next((c for c in candidates if re.search(r"[一-鿿]", str(c))), None) or (candidates[0] if candidates else None)

        expiry = max(r.renewal_date for r in items)
        permanent = expiry >= PERMANENT_MEMBER_DATE
        rows.append({
            "nric_asset_id": asset.id if asset else None,
            "name": name or "（未命名）",
            "nric": asset.nric if asset else None,
            "user": {
                "id": user.id,
                "username": user.username,
                "display_name": user.display_name,
            } if user else None,
            "expiry": expiry.isoformat(),
            "permanent": permanent,
            "active": permanent or expiry >= today,
            "renewal_count": len(items),
            "renewal_dates": [r.renewal_date.isoformat() for r in sorted(items, key=lambda x: x.renewal_date)],
        })

    # is_member 账号但没有任何续费记录的，也列进名册（标记无记录）
    stray_users = User.query.filter(User.is_member.is_(True), ~User.id.in_(covered_user_ids or {0})).all()
    for user in stray_users:
        asset = user.nric_data
        rows.append({
            "nric_asset_id": asset.id if asset else None,
            "name": user.display_name or user.username or "（未命名）",
            "nric": asset.nric if asset else None,
            "user": {"id": user.id, "username": user.username, "display_name": user.display_name},
            "expiry": None,
            "permanent": False,
            "active": True,
            "renewal_count": 0,
            "renewal_dates": [],
        })

    # 永久在前，其余按到期日倒序，无记录的排最后
    rows.sort(
        key=lambda r: (
            0 if r["permanent"] else 1,
            -(int(r["expiry"].replace("-", "")) if r["expiry"] else 0),
        )
    )
    return json_response({"status": "success", "members": rows, "total": len(rows)})


def get_membership_registrations():
    try:
        entries = (
            MembershipRegistration.query.filter(MembershipRegistration.status != "remove")
            .order_by(
                MembershipRegistration.submitted_at.desc(),
                MembershipRegistration.id.desc(),
            )
            .all()
        )
        changed = False
        for entry in entries:
            changed = _sync_membership_registration_status(entry) or changed
        if changed:
            db.session.commit()

        return json_response(
            {
                "status": "success",
                "entries": [_serialize_membership_registration(entry) for entry in entries],
            }
        )
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


def remove_membership_registration(registration_id):
    registration = MembershipRegistration.query.get(registration_id)
    if not registration:
        return json_response({"status": "error", "message": "会员申请不存在"}, 404)
    if registration.status == "paid":
        return json_response({"status": "error", "message": "该会员申请已经生效，无法移除。"}, 400)
    try:
        registration.status = "remove"
        db.session.commit()
        return json_response({"status": "success", "message": "会员申请已移除。"})
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)


def update_membership_payment_status(payment_id, data):
    payment = form_services._get_scoped_regis_payment_or_404(payment_id, MEMBERSHIP_FEE_SCOPE)
    registration = payment.membership_registration
    status = _clean_text(data.get("status"))
    allowed_statuses = {"process", "checked", "fail"}

    if status not in allowed_statuses:
        return json_response({"status": "error", "message": "付款状态无效"}, 400)

    if payment.status == "checked" and status != "checked":
        renewal = _membership_renewal_for_registration(registration)
        if renewal:
            return json_response(
                {
                    "status": "error",
                    "message": "这笔会员付款已经生效，不能直接回退，请先到用户管理手动处理会员状态与续费记录。",
                },
                400,
            )

    try:
        payment.status = status

        # 财政通过（付款审核通过）只是两个条件之一；只有理事会签名也集齐时，
        # _maybe_activate_membership 才会真正生效并开始注册日期。
        registration.sync_status_from_payment()
        _maybe_activate_membership(registration)

        db.session.commit()
        return json_response(
            {
                "status": "success",
                "message": "会员付款状态已更新",
                "payment": payment.to_dict(),
                "registration": _serialize_membership_registration(registration),
            }
        )
    except Exception as exc:
        db.session.rollback()
        return json_response({"status": "error", "message": str(exc)}, 500)
