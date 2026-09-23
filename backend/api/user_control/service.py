"""user_control 的业务逻辑（原 backend/app/user_control/routes.py 的模块级辅助函数）。

原文件没有 services.py —— 路由和逻辑混在一个 1239 行的 routes.py 里。搬过来时按
「碰 request/response 的留在 router.py，其余进 service.py」切开，**函数体一个字没动**，
只改了 import 来源和两处框架适配（见下面 ★）。

── 内容分区 ──────────────────────────────────────────────────────
  1. 可编辑字段白名单（SELF_ / ADMIN_EXTRA_ / BOOLEAN_ / TEXT_）
  2. 心芽（青少年佛学班）标记与用户序列化
  3. 部门序列化
  4. 用户资料写入：字段规整 → 唯一性校验 → NRIC 成员同步 → 头像改名
  5. Profile 足迹（报名表 + 青少年佛学班）
  6. 会员续费凭证落盘

── ★ 两处框架适配（其余逐字照搬）──────────────────────────────────

  ① ``_save_member_renewal_proof``：入参从 werkzeug 的 FileStorage 换成 starlette 的
     UploadFile，于是 ``uploaded_file.save(path)`` → shutil.copyfileobj，
     ``uploaded_file.mimetype`` → ``.content_type``。落盘的**文件名规则一字未改**
     （时间戳_随机 8 位 hex + 原扩展名），改了就等于以前传的凭证点开 404。

  ② ``DATA_PATH`` / ``to_short_data_path`` 原本从 ``backend.app.media.paths`` 来。
     那个文件本身是干净的（只 import os + core.paths），但 app/ 这棵树是要按模块
     删掉的 —— 依赖它等于给自己埋一颗「别人删 media 时我挂掉」的雷。
     两个东西加起来三行，直接建在 core.paths.DATA_ROOT 上，值完全一致。

── 几处「看起来像 bug、故意保留」───────────────────────────────────

  · ``_apply_user_updates`` 遍历的是 ``allowed_fields & set(data.keys())``，
    而 Python 的 set 遍历**顺序不确定**。于是当同一个请求里既改 username 又改
    NRIC 时，``_validate_unique_user_fields`` 看到的 pending_username 是确定的
    （它在循环外统一算），但 ``setattr`` 的先后是不确定的。目前没有字段之间互相
    依赖，所以看不出问题。TODO(隐患): 哪天加了「B 字段的校验依赖 A 字段的新值」
    就会变成随机失败。不在本次搬迁里改。

  · ``_move_profile_images`` 在 ``db.session.flush()`` 之后、``commit()`` 之前改
    文件名。事务回滚时文件已经改完了 —— 表现为「改名失败，但头像 404 了」。
    原样保留。TODO(隐患): 要修的话得把文件操作挪到 commit 之后。

  · ``_serialize_user_for_request`` 只在「是本人或有 member/member_edit」时给全量，
    其余给三字段精简版；而 ``get_user_detail`` 随后靠 ``"is_member" in data`` 来
    判断「刚才给的是不是全量」。精简版里没有 is_member，所以判断成立 ——
    但这是**靠键名撞出来的巧合**，不是显式的标志位。别给精简版加 is_member。
"""

import os
import secrets
import shutil
from datetime import datetime

from backend.api.user_control import form_services
from backend.api.user_control.permissions import (
    FULL_DEPARTMENT_READ_PERMISSION_NAMES,
    FULL_USER_READ_PERMISSION_NAMES,
)
from backend.api.user_control.utils import PROFILE_PATH
from backend.core.auth import current_user, current_user_has_any_permission
from backend.core.db import db
from backend.core.paths import DATA_ROOT
from backend.models.form import NRIC_Asset
from backend.models.user_data import User
from backend.models.youth_class_registration import YouthClassRegistration

# 原 backend/app/media/paths.py 的两个东西，见模块头 ★②。值与那边逐字一致。
DATA_PATH = str(DATA_ROOT)


def to_short_data_path(full_path):
    """绝对路径 → 存库用的短路径（去掉 DATA_ROOT 前缀）。"""
    return full_path.replace(DATA_PATH + os.sep, "", 1)


MEMBER_RENEWAL_ROOT = os.path.join(DATA_PATH, "NAS", "UTBA", "member_renewal")


# ─────────────────────────── 1. 可编辑字段白名单 ───────────────────────────
#
# 白名单是**唯一**的写入闸门：``_apply_user_updates`` 只认
# ``allowed_fields & data.keys()``，不在表里的键连 setattr 都不会执行。
# 所以往这几个集合里加一个名字 = 开放一个字段给前端直接写，加之前先想清楚。

SELF_EDITABLE_USER_FIELDS = {
    "username",
    "display_name",
    "display",
    "email",
    "phone",
    "NRIC",
    "gender",
    "parent_1",
    "parent_1_phone",
    "medical",
    "allergy",
    "bank_name",
    "account_name",
    "bank_account",
    "tng_number",
}
# 只有 member_edit 才额外拿到的三个字段。``is_member`` 在这里 ——
# 也就是说自助改资料**改不动会员身份**，那得走 membership 那条审核流程。
ADMIN_EXTRA_EDITABLE_USER_FIELDS = {
    "name_NRIC",
    "user_theme",
    "is_member",
}
BOOLEAN_USER_FIELDS = {"display", "is_member"}
TEXT_USER_FIELDS = {
    "username",
    "display_name",
    "email",
    "phone",
    "gender",
    "parent_1",
    "parent_1_phone",
    "medical",
    "allergy",
    "bank_name",
    "account_name",
    "bank_account",
    "tng_number",
    "user_theme",
}


def _format_department_delete_integrity_error(exc):
    """把 DB 的外键报错翻译成用户看得懂的中文。

    匹配的是**驱动给的原始错误串**里的表名，不是异常类型 —— 所以改表名
    （file_permissions / user_department / department_permission）会让这里
    静默退回最后那句兜底文案。
    """
    message = str(getattr(exc, "orig", exc) or "")
    normalized = message.lower()

    if "file_permissions" in normalized:
        return "该部门仍有关联的文件权限，无法删除。请先清理相关文件权限后再试。"

    if "user_department" in normalized or "department_permission" in normalized:
        return "该部门仍存在关联成员或权限，无法删除。请刷新后重试；如果仍失败，请先检查部门成员和权限设置。"

    return "该部门仍有关联数据，无法删除。请先移除关联后再试。"


# ─────────────────────────── 2. 心芽标记与用户序列化 ───────────────────────────


def _paid_youth_index():
    """一次性取出所有已生效（paid）青少年佛学班报名对应的 user_id / 成员 id 集合。"""
    rows = (
        YouthClassRegistration.query.filter_by(status="paid")
        .with_entities(YouthClassRegistration.user_id, YouthClassRegistration.nric_asset_id)
        .all()
    )
    paid_user_ids = {row[0] for row in rows if row[0]}
    paid_member_ids = {row[1] for row in rows if row[1]}
    return paid_user_ids, paid_member_ids


def _user_nric_age(user):
    """按全局年份规则（当前年份 - 出生年份）从 NRIC 推算年龄；无法推算返回 None。"""
    member = getattr(user, "nric_asset", None)
    nric = getattr(member, "nric", None)
    if not nric:
        return None
    try:
        return form_services._calc_age_from_nric(nric)
    except Exception:
        # 裸 except 是原样保留：NRIC 是用户自己填的自由文本，解析失败的形状很多
        # （ValueError / TypeError / IndexError 都出现过），这里只要「算不出就当没有」。
        return None


def _is_xin_ya(user, paid_user_ids, paid_member_ids, age=None):
    """心芽 = 青少年佛学班的生效人，且按 NRIC 年份规则 18 岁及以下。"""
    if user.id not in paid_user_ids and (
        user.nric_asset_id is None or user.nric_asset_id not in paid_member_ids
    ):
        return False
    if age is None:
        age = _user_nric_age(user)
    return age is not None and age <= 18


def _serialize_users_with_xin_ya(users):
    paid_user_ids, paid_member_ids = _paid_youth_index()
    result = []
    for user in users:
        data = user.to_dict()
        age = _user_nric_age(user)
        data["age"] = age
        data["xin_ya"] = _is_xin_ya(user, paid_user_ids, paid_member_ids, age=age)
        result.append(data)
    return result


def _serialize_basic_user(user, *, include_membership=False):
    data = {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
    }
    if include_membership:
        data["is_member"] = bool(user.is_member)
    return data


def _serialize_user_for_request(user):
    if current_user.is_authenticated and (
        current_user.id == user.id or current_user_has_any_permission(FULL_USER_READ_PERMISSION_NAMES)
    ):
        return user.to_dict()
    return _serialize_basic_user(user)


# ─────────────────────────── 3. 部门序列化 ───────────────────────────


def _serialize_basic_department(department):
    return {
        "id": department.id,
        "name": department.name,
    }


def _serialize_department_for_request(department):
    if current_user_has_any_permission(FULL_DEPARTMENT_READ_PERMISSION_NAMES):
        return department.to_dict()
    return _serialize_basic_department(department)


# ─────────────────────────── 4. 用户资料写入 ───────────────────────────


def _normalize_identity_value(value, *, undefined_as_none=False):
    """NRIC / name_NRIC 的规整。

    ``undefined_as_none`` 只给 name_NRIC 用：前端历史上会把 JS 的 undefined
    ``String()`` 之后发上来，字面量就是 "undefined"。NRIC 那一侧**不开**这个开关 ——
    真有人的证件号长成那样的概率是 0，但开了之后就分不清「没填」和「填错」了。
    """
    normalized = str(value or "").strip()
    if not normalized:
        return None
    if undefined_as_none and normalized.lower() == "undefined":
        return None
    return normalized


def _normalize_user_text_value(value):
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _parse_nullable_bool(value, field_name):
    """三态解析：True / False / None（= 不设置）。认不出来抛 ValueError → 400。

    ``"undefined"`` / ``"null"`` / ``"none"`` / ``""`` 全部落到 None，
    这是给「前端没填」留的口子；别把它们并进 False 那一支 ——
    那会让「没勾 display」被当成「明确取消 display」。
    """
    if isinstance(value, bool):
        return value
    if value is None:
        return None

    normalized = str(value).strip().lower()
    if normalized in {"", "null", "none", "undefined"}:
        return None
    if normalized in {"true", "1", "yes", "on"}:
        return True
    if normalized in {"false", "0", "no", "off"}:
        return False
    raise ValueError(f"{field_name} 字段格式无效")


def _validate_unique_user_fields(user, *, username=None, email=None, phone=None):
    # 用 no_autoflush，避免这里的 SELECT 先把 session 里待写的（可能冲突的）改动 flush 掉，
    # 否则会先撞唯一约束抛 IntegrityError，拿不到下面这些更友好的提示。
    with db.session.no_autoflush:
        if username:
            existing = User.query.filter(User.username == username, User.id != user.id).first()
            if existing:
                raise ValueError("这个用户名已被其他账号使用")
        if email:
            existing = User.query.filter(User.email == email, User.id != user.id).first()
            if existing:
                raise ValueError("这个 Email 已被其他账号使用")
        if phone:
            existing = User.query.filter(User.phone == phone, User.id != user.id).first()
            if existing:
                raise ValueError("这个 Phone 已被其他账号使用")


def _move_profile_images(previous_username, next_username):
    """改用户名时把三张头像跟着改名。

    头像文件名是 ``<username>_profile_image[_s|_l].jpg`` —— 也就是说用户名**就是**
    主键。不跟着改的话，改完名字头像立刻 404（``get_profile_image`` 按新名字去找）。
    """
    if not previous_username or not next_username or previous_username == next_username:
        return

    for suffix in (
        "_profile_image_s.jpg",
        "_profile_image.jpg",
        "_profile_image_l.jpg",
    ):
        source_path = os.path.join(PROFILE_PATH, f"{previous_username}{suffix}")
        if not os.path.exists(source_path):
            continue
        destination_path = os.path.join(PROFILE_PATH, f"{next_username}{suffix}")
        os.replace(source_path, destination_path)


def _apply_user_updates(user, data, *, allowed_fields):
    identity_keys = {"NRIC", "name_NRIC"}
    editable_keys = allowed_fields & set(data.keys())

    previous_username = user.username
    pending_username = user.username
    pending_email = user.email
    pending_phone = user.phone

    for key in editable_keys:
        if key in identity_keys:
            # 身份字段不直接 setattr 到 User 上 —— 它们住在关联的 NRIC_Asset 行里，
            # 统一交给下面的 _sync_user_nric_member 处理（可能要建行、合并行、删孤行）。
            continue
        if key in BOOLEAN_USER_FIELDS:
            setattr(user, key, _parse_nullable_bool(data.get(key), key))
            continue
        if key in TEXT_USER_FIELDS:
            normalized = _normalize_user_text_value(data.get(key))
            if key == "user_theme" and normalized is None:
                # 主题不允许为空：清空时回落到当前值，还没有值就给 light。
                normalized = user.user_theme or "light"
            if key == "username":
                if normalized is None:
                    raise ValueError("username 不能为空")
                if any(char.isspace() for char in normalized):
                    raise ValueError("username 不能包含空格")
            setattr(user, key, normalized)
            if key == "username":
                pending_username = normalized
            elif key == "email":
                pending_email = normalized
            elif key == "phone":
                pending_phone = normalized
            continue
        if hasattr(user, key):
            # 白名单里但既不是 bool 也不是 text 的字段（今天只有 display 之外的空集），
            # 原样塞进去。hasattr 是最后一道保险。
            setattr(user, key, data.get(key))

    _validate_unique_user_fields(
        user,
        username=pending_username,
        email=pending_email,
        phone=pending_phone,
    )

    if identity_keys & editable_keys:
        target_member = user.nric_asset
        # 注意这里用的是 ``"NRIC" in data``（键在不在），不是 ``data.get("NRIC")``（值真不真）：
        # 显式传 NRIC=null 是「清空」，根本不传才是「别动」。合并这两者会让
        # 「只改 name_NRIC」的请求顺手把 NRIC 洗掉。
        target_nric = data.get("NRIC") if "NRIC" in data else getattr(target_member, "nric", None)
        target_name_nric = (
            data.get("name_NRIC")
            if "name_NRIC" in data
            else getattr(target_member, "name_nric", None)
        )
        _sync_user_nric_member(user, target_nric, target_name_nric)

    return previous_username, pending_username


def _save_user_updates(user, data, *, allowed_fields):
    previous_username, next_username = _apply_user_updates(
        user,
        data,
        allowed_fields=allowed_fields,
    )
    db.session.flush()
    _move_profile_images(previous_username, next_username)
    db.session.commit()


def _member_has_registration_footprint(member):
    """这个成员行有没有报名/缴费足迹。有的话就不许在用户资料页把 NRIC 清空 ——
    清了之后那些报名记录就认不出是谁了。"""
    if not member:
        return False
    return bool(
        member.datas
        or member.forms
        or member.payments
        or getattr(member, "youth_class_registrations", None)
    )


def _delete_orphan_nric_member(member):
    """没有任何人再引用的成员行，顺手删掉，避免 nric_asset 表越积越多。

    四道检查缺一不可：还有 user 指着、还有青少年班报名指着、
    还有资料/报名表/缴费挂着 —— 任一成立就留着。
    """
    if not member or not getattr(member, "id", None):
        return

    db.session.flush()
    linked_user_count = User.query.filter_by(nric_asset_id=member.id).count()
    if linked_user_count:
        return
    youth_registration_count = YouthClassRegistration.query.filter_by(nric_asset_id=member.id).count()
    if member.datas or member.forms or member.payments or youth_registration_count:
        return
    db.session.delete(member)


def _sync_user_nric_member(user, target_nric, target_name_nric):
    """把 User 想要的 (NRIC, name_NRIC) 落到关联的 NRIC_Asset 行上。

    四条分支，顺序不能调：
      ① 两个都空 → 解绑 + 可能删孤行（有报名足迹时拒绝）
      ② 本来就没有成员行 → 按 NRIC 找/建一行
      ③ 有成员行且传了新 NRIC → 走 _apply_member_nric_change（可能合并到已存在的行，
         所以后面要用返回的 member_id 重新取一次，不能接着用旧对象）
      ④ 有成员行但 NRIC 传空 → 清空（有报名足迹时拒绝）
    """
    normalized_nric = _normalize_identity_value(target_nric)
    normalized_name_nric = _normalize_identity_value(target_name_nric, undefined_as_none=True)
    current_member = user.nric_asset

    if not normalized_nric and not normalized_name_nric:
        if current_member and _member_has_registration_footprint(current_member):
            raise ValueError("该用户关联的成员已有报名资料，不能在这里清空 NRIC")
        user.nric_asset = None
        db.session.flush()
        _delete_orphan_nric_member(current_member)
        return

    if current_member is None:
        if normalized_nric:
            current_member = NRIC_Asset.query.filter_by(nric=normalized_nric).first()
            if current_member is None:
                current_member = NRIC_Asset(nric=normalized_nric, name_nric=normalized_name_nric)
                db.session.add(current_member)
                db.session.flush()
        else:
            # 只填了 name_NRIC 没填 NRIC：也建一行（NRIC 留空），
            # 这样「先登记姓名、后补证件号」的流程不至于丢掉姓名。
            current_member = NRIC_Asset(nric=None, name_nric=normalized_name_nric)
            db.session.add(current_member)
            db.session.flush()
        user.nric_asset = current_member
    elif normalized_nric:
        current_nric = _normalize_identity_value(current_member.nric)
        if current_nric != normalized_nric:
            nric_change = form_services._apply_member_nric_change(current_member, normalized_nric)
            db.session.flush()
            # ★ 换号可能把两行**合并**掉，返回的 member_id 未必是原来那行。
            #   这里必须重取，接着用 current_member 会写到一行已经被删的记录上。
            current_member = NRIC_Asset.query.get(nric_change["member_id"])
            user.nric_asset_id = nric_change["member_id"]
    elif current_member.nric:
        if _member_has_registration_footprint(current_member):
            raise ValueError("该用户关联的成员已有报名资料，不能在这里清空 NRIC")
        current_member.nric = None

    current_member = current_member or user.nric_asset
    if current_member:
        current_member.name_nric = normalized_name_nric
        user.nric_asset = current_member


# ─────────────────────────── 5. Profile 足迹 ───────────────────────────


def _format_footprint_datetime(value):
    return value.isoformat() if value else None


def _combine_payment_datetime(date_value, time_value):
    if not date_value:
        return None
    if time_value is None:
        return datetime.combine(date_value, datetime.min.time())
    return datetime.combine(date_value, time_value)


def _member_profile_display_name(member):
    if not member:
        return None
    latest = member.latest_data()
    return (
        getattr(latest, "name_cn", None)
        or getattr(latest, "name", None)
        or getattr(member, "name_nric", None)
        or getattr(member, "nric", None)
    )


def _serialize_profile_event(event):
    return {
        "id": event.id,
        "event_name": event.event_name,
        "datetime": _format_footprint_datetime(event.datetime),
        "end_datetime": _format_footprint_datetime(event.end_datetime),
        "location": event.location,
        "type": event.type,
        "event_code": event.event_code,
    }


def _serialize_profile_form_footprint(member, form):
    latest_data = member.latest_data()
    events = sorted(
        list(form.events or []),
        key=lambda item: (item.datetime or datetime.min, item.id or 0),
        reverse=True,
    )
    payments = sorted(
        [payment for payment in (member.payments or []) if payment.regis_form_id == form.id],
        key=lambda item: (
            _combine_payment_datetime(getattr(item, "date", None), getattr(item, "time", None)) or datetime.min,
            item.id or 0,
        ),
        reverse=True,
    )
    latest_payment = payments[0] if payments else None
    latest_event = events[0] if events else None
    # 「这条足迹发生在什么时候」的回落链：最近一笔缴费 → 最近一场活动 →
    # 资料最后编辑时间 → 建表时间。四个都可能是 None，最后一个兜底。
    footprint_at = (
        _combine_payment_datetime(getattr(latest_payment, "date", None), getattr(latest_payment, "time", None))
        or getattr(latest_event, "datetime", None)
        or getattr(latest_data, "edit_at", None)
        or form.created_at
    )

    return {
        "kind": "registration_form",
        "id": form.id,
        "title": form.title,
        "detail": form.detail,
        "expired": form.expired.isoformat() if form.expired else None,
        "created_at": _format_footprint_datetime(form.created_at),
        "footprint_at": _format_footprint_datetime(footprint_at),
        "event_count": len(events),
        "events": [_serialize_profile_event(event) for event in events],
        "payment_count": len(payments),
        "latest_payment": latest_payment.to_dict() if latest_payment else None,
        "profile_name": getattr(latest_data, "name_cn", None) or getattr(latest_data, "name", None),
        "profile_updated_at": _format_footprint_datetime(getattr(latest_data, "edit_at", None)),
    }


def _serialize_profile_youth_footprint(entry):
    latest_payment = entry.latest_youth_payment()
    footprint_at = getattr(latest_payment, "created_at", None) or entry.submitted_at
    data = entry.to_dict()
    data.update(
        {
            "kind": "youth_class",
            "footprint_at": _format_footprint_datetime(footprint_at),
            "payment_count": len(entry.payments or []),
        }
    )
    return data


def _build_profile_footprints(member):
    # 排序键是 ``(footprint_at 的 ISO 字符串, id)``。按字符串排在这里是**对的**
    # （ISO 8601 的字典序就是时间序），而 ``or ""`` 让没有时间的排到最后。
    form_items = sorted(
        [_serialize_profile_form_footprint(member, form) for form in (member.forms or [])],
        key=lambda item: (item.get("footprint_at") or "", item.get("id") or 0),
        reverse=True,
    )
    youth_items = sorted(
        [_serialize_profile_youth_footprint(entry) for entry in (member.youth_class_registrations or [])],
        key=lambda item: (item.get("footprint_at") or "", item.get("id") or 0),
        reverse=True,
    )

    event_count = sum(len(item.get("events") or []) for item in form_items)
    payment_count = sum(item.get("payment_count") or 0 for item in form_items) + sum(
        item.get("payment_count") or 0 for item in youth_items
    )

    return {
        "member": {
            "id": member.id,
            "nric": member.nric,
            "name_nric": member.name_nric,
            "display_name": _member_profile_display_name(member),
        },
        "summary": {
            "registration_form_count": len(form_items),
            "event_count": event_count,
            "youth_class_count": len(youth_items),
            "payment_count": payment_count,
            "total_count": len(form_items) + len(youth_items),
        },
        "registrations": form_items,
        "youth_class_registrations": youth_items,
    }


# ─────────────────────────── 6. 会员续费凭证 ───────────────────────────


def _save_member_renewal_proof(user, uploaded_file):
    """把续费凭证存到 ``<DATA>/NAS/UTBA/member_renewal/<username>/``。

    ★ 这是本文件唯一改了写法的函数（见模块头 ★①）：werkzeug FileStorage →
      starlette UploadFile，于是 ``.save()`` 换成 copyfileobj、``.mimetype``
      换成 ``.content_type``。**文件名规则一字未动** ——
      ``%Y%m%d%H%M%S_<8位hex><原扩展名>``，改了等于历史凭证全部点开 404。

    ⚠️ 目录名用的是 ``user.username``（用户可以自己改）。也就是说用户改名之后，
      旧凭证留在旧目录里 —— 但库里存的是**完整短路径**，所以读还是读得到。
      TODO(隐患): 万一两个用户先后用过同一个 username，凭证会混在一个目录里。
      原行为，不在本次搬迁里改。
    """
    if not uploaded_file or not getattr(uploaded_file, "filename", ""):
        return None

    # os.path.basename 挡目录穿越；扩展名原样保留（不做白名单，与原代码一致）。
    raw_name = os.path.basename((uploaded_file.filename or "").strip())
    extension = os.path.splitext(raw_name)[1].lower()
    folder_name = user.username or f"user_{user.id}"
    target_dir = os.path.join(MEMBER_RENEWAL_ROOT, folder_name)
    os.makedirs(target_dir, exist_ok=True)

    filename = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(4)}{extension}"
    target_path = os.path.join(target_dir, filename)

    source = uploaded_file.file
    try:
        source.seek(0)
    except (OSError, ValueError):
        pass
    with open(target_path, "wb") as target:
        shutil.copyfileobj(source, target)

    return {
        "proof_path": to_short_data_path(target_path),
        "proof_name": raw_name or filename,
        # werkzeug 的 .mimetype 在 starlette 这边叫 .content_type；空串要落成 None。
        "proof_mime": (uploaded_file.content_type or None),
    }
