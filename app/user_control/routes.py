import os
import secrets
from datetime import datetime, timedelta

from PIL import Image
from flask import Blueprint, jsonify, request, send_file, session
from flask_login import current_user, login_required, login_user, logout_user
from sqlalchemy.exc import IntegrityError

from app.auth import get_current_user_permissions, permission_required
from app.form.services import _apply_member_nric_change, _calc_age_from_nric
from app.media.paths import DATA_PATH, to_short_data_path
from . import membership
from app.common import council_sign
from app.user_control.utils import PROFILE_PATH, generate_resized_image
from models.file_manager_DB import FilePermission
from models.form import NRIC_Asset
from models import db
from models.user_data import Department, MemberRenewal, User
from models.youth_class_registration import YouthClassRegistration

user_control_bp = Blueprint("user_control", __name__)

MEMBER_RENEWAL_ROOT = os.path.join(DATA_PATH, "NAS", "UTBA", "member_renewal")
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
FULL_USER_READ_PERMISSION_NAMES = {"member", "member_edit"}
FULL_DEPARTMENT_READ_PERMISSION_NAMES = {
    "department",
    "department_edit",
    "permission",
    "permission_edit",
    "member",
    "member_edit",
}
MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES = {"member", "member_edit", "account_edit", "council_approve"}
MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES = {"member_edit", "account_edit"}
MEMBERSHIP_COUNCIL_PERMISSION_NAMES = {"council_approve"}


def _format_department_delete_integrity_error(exc):
    message = str(getattr(exc, "orig", exc) or "")
    normalized = message.lower()

    if "file_permissions" in normalized:
        return "该部门仍有关联的文件权限，无法删除。请先清理相关文件权限后再试。"

    if "user_department" in normalized or "department_permission" in normalized:
        return "该部门仍存在关联成员或权限，无法删除。请刷新后重试；如果仍失败，请先检查部门成员和权限设置。"

    return "该部门仍有关联数据，无法删除。请先移除关联后再试。"


def _current_user_permission_names():
    if not getattr(current_user, "is_authenticated", False):
        return set()
    return set(get_current_user_permissions(current_user))


def _current_user_has_any_permission(permission_names):
    return bool(_current_user_permission_names() & set(permission_names))


def _permission_denied_response(permission_names):
    joined = " / ".join(sorted(permission_names))
    return jsonify({"status": "error", "message": f"缺少权限，需要以下任一权限：{joined}"}), 403


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
        return _calc_age_from_nric(nric)
    except Exception:
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
        current_user.id == user.id or _current_user_has_any_permission(FULL_USER_READ_PERMISSION_NAMES)
    ):
        return user.to_dict()
    return _serialize_basic_user(user)


def _serialize_basic_department(department):
    return {
        "id": department.id,
        "name": department.name,
    }


def _serialize_department_for_request(department):
    if _current_user_has_any_permission(FULL_DEPARTMENT_READ_PERMISSION_NAMES):
        return department.to_dict()
    return _serialize_basic_department(department)


def _normalize_identity_value(value, *, undefined_as_none=False):
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
            continue
        if key in BOOLEAN_USER_FIELDS:
            setattr(user, key, _parse_nullable_bool(data.get(key), key))
            continue
        if key in TEXT_USER_FIELDS:
            normalized = _normalize_user_text_value(data.get(key))
            if key == "user_theme" and normalized is None:
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
            setattr(user, key, data.get(key))

    _validate_unique_user_fields(
        user,
        username=pending_username,
        email=pending_email,
        phone=pending_phone,
    )

    if identity_keys & editable_keys:
        target_member = user.nric_asset
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
    if not member:
        return False
    return bool(
        member.datas
        or member.forms
        or member.payments
        or getattr(member, "youth_class_registrations", None)
    )


def _delete_orphan_nric_member(member):
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
            current_member = NRIC_Asset(nric=None, name_nric=normalized_name_nric)
            db.session.add(current_member)
            db.session.flush()
        user.nric_asset = current_member
    elif normalized_nric:
        current_nric = _normalize_identity_value(current_member.nric)
        if current_nric != normalized_nric:
            nric_change = _apply_member_nric_change(current_member, normalized_nric)
            db.session.flush()
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


@user_control_bp.get("/get_user_data")
@login_required
def get_user_data():
    return jsonify(current_user.to_dict())


@user_control_bp.get("/my_footprints")
@login_required
def get_my_footprints():
    member = current_user.nric_asset
    if not member:
        return jsonify(
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

    return jsonify({"status": "success", **_build_profile_footprints(member)})


@user_control_bp.get("/membership/context")
@login_required
def get_membership_context():
    return membership.get_membership_context()


@user_control_bp.get("/membership/public-context")
def get_membership_public_context():
    return membership.get_public_membership_context()


@user_control_bp.get("/membership/registration-route")
def get_membership_registration_route():
    return membership.get_long_open_registration_route(request.args.get("nric"))


@user_control_bp.post("/membership/upgrade")
@login_required
def submit_membership_upgrade():
    return membership.submit_membership_upgrade(request.get_json(silent=True) or {})


@user_control_bp.post("/membership/public-upgrade")
def submit_membership_public_upgrade():
    return membership.submit_public_membership_upgrade(request.get_json(silent=True) or {})


@user_control_bp.post("/membership/renew")
@login_required
def start_membership_renewal():
    return membership.start_membership_renewal()


@user_control_bp.get("/membership/payment/<token>")
def get_membership_payment_context(token):
    return membership.get_membership_payment_context(token)


@user_control_bp.post("/membership/payment/<token>/submit")
def submit_membership_payment(token):
    return membership.submit_membership_payment(token, request.form, request.files.get("proof_image"))


@user_control_bp.get("/membership/payment/proof_image/<int:payment_id>")
@login_required
def get_membership_payment_proof_image(payment_id):
    return membership.get_membership_payment_proof_image(payment_id)


@user_control_bp.get("/membership/settings")
@login_required
def get_membership_settings():
    if not _current_user_has_any_permission(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES):
        return _permission_denied_response(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES)
    return membership.get_membership_payment_settings()


@user_control_bp.put("/membership/settings")
@login_required
def update_membership_settings():
    if not _current_user_has_any_permission(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES):
        return _permission_denied_response(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES)
    return membership.update_membership_payment_settings(request.get_json(silent=True) or {})


@user_control_bp.get("/membership/entries")
@login_required
def get_membership_entries():
    if not _current_user_has_any_permission(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES):
        return _permission_denied_response(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES)
    return membership.get_membership_registrations()


@user_control_bp.post("/membership/payment/<int:payment_id>/status")
@login_required
def update_membership_payment_status(payment_id):
    if not _current_user_has_any_permission(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES):
        return _permission_denied_response(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES)
    return membership.update_membership_payment_status(payment_id, request.get_json(silent=True) or {})


@user_control_bp.post("/membership/<int:registration_id>/council-sign")
@login_required
def add_membership_council_signature(registration_id):
    if not _current_user_has_any_permission(MEMBERSHIP_COUNCIL_PERMISSION_NAMES):
        return _permission_denied_response(MEMBERSHIP_COUNCIL_PERMISSION_NAMES)
    return membership.add_membership_council_signature(registration_id, request.get_json(silent=True) or {})


# 共用的理事会「手机/链接签名」入口（会员 + 青少年佛学班），scope 由 token 决定。
@user_control_bp.get("/council-sign/mobile")
@login_required
def get_council_sign_mobile_context():
    return council_sign.get_sign_mobile_context(request.args.get("t"))


@user_control_bp.post("/council-sign/mobile")
@login_required
def submit_council_sign_mobile():
    payload = request.get_json(silent=True) or {}
    return council_sign.submit_sign_mobile(payload.get("t") or request.args.get("t"), payload)


# 共用的批量理事会签名入口（一条链接对应多份申请）。
@user_control_bp.get("/council-sign/batch")
@login_required
def get_council_sign_batch_context():
    return council_sign.get_batch_sign_context(request.args.get("t"))


@user_control_bp.post("/council-sign/batch")
@login_required
def submit_council_sign_batch():
    payload = request.get_json(silent=True) or {}
    return council_sign.submit_batch_sign(payload.get("t") or request.args.get("t"), payload)


# 会员工作台生成批量理事会审核 URL（选中的会员申请）。
@user_control_bp.post("/membership/council-sign/batch-url")
@login_required
def create_membership_council_batch_url():
    if not _current_user_has_any_permission(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES):
        return _permission_denied_response(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES)
    payload = request.get_json(silent=True) or {}
    return council_sign.batch_sign_url_response("membership", payload.get("registration_ids"))


@user_control_bp.put("/membership/<int:registration_id>")
@login_required
def update_membership_registration_fields(registration_id):
    if not _current_user_has_any_permission(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES):
        return _permission_denied_response(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES)
    return membership.update_membership_registration_fields(registration_id, request.get_json(silent=True) or {})


@user_control_bp.post("/membership/<int:registration_id>/remove")
@login_required
def remove_membership_registration(registration_id):
    if not _current_user_has_any_permission(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES):
        return _permission_denied_response(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES)
    return membership.remove_membership_registration(registration_id)


@user_control_bp.post("/edit_reject_local/<edit_type>")
@login_required
@permission_required("member_edit")
def edit_reject_local(edit_type):
    if edit_type not in ["approve", "reject"]:
        return jsonify({"error": "invalid edit_type"}), 400

    if edit_type == "approve":
        current_user.reject_local = True
        current_user.reject_date = datetime.utcnow()
    else:
        current_user.reject_local = False
        current_user.reject_date = None

    db.session.commit()
    return jsonify(
        {
            "id": current_user.id,
            "reject_local": current_user.reject_local,
            "reject_date": current_user.reject_date.isoformat()
            if current_user.reject_date
            else None,
        }
    )


@user_control_bp.get("/get_all_user_data")
def get_all_user_data():
    if current_user.is_authenticated and _current_user_has_any_permission(FULL_USER_READ_PERMISSION_NAMES):
        users = User.query.all()
        user_data = _serialize_users_with_xin_ya(users)
        login = True
    elif current_user.is_authenticated:
        users = User.query.all()
        user_data = [_serialize_basic_user(user, include_membership=True) for user in users]
        login = True
    else:
        users = User.query.filter_by(display=True).all()
        user_data = [_serialize_basic_user(user) for user in users]
        login = False

    return jsonify({"login": login, "data": user_data})


@user_control_bp.get("/get_user_detail/<int:user_id>")
@login_required
def get_user_detail(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "用户不存在"}), 404
    data = _serialize_user_for_request(user)
    if "is_member" in data:
        paid_user_ids, paid_member_ids = _paid_youth_index()
        age = _user_nric_age(user)
        data["age"] = age
        data["xin_ya"] = _is_xin_ya(user, paid_user_ids, paid_member_ids, age=age)
    return jsonify(data)


@user_control_bp.post("/edit_user_data")
@login_required
@permission_required("member_edit")
def edit_user_data():
    try:
        data = request.get_json() or {}
        target_user_id = data.get("user_id") or current_user.id
        user = User.query.get(target_user_id)
        if not user:
            return jsonify({"status": "error", "message": "用户不存在"}), 404

        _save_user_updates(
            user,
            data,
            allowed_fields=SELF_EDITABLE_USER_FIELDS | ADMIN_EXTRA_EDITABLE_USER_FIELDS,
        )
        return jsonify({"status": "success", "message": "用户信息更新成功"})
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 400
    except IntegrityError:
        db.session.rollback()
        return jsonify({"status": "error", "message": "资料更新失败，可能是用户名、Email 或 Phone 已重复"}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"更新失败: {str(exc)}"}), 500


@user_control_bp.post("/register")
@login_required
@permission_required("member_edit")
def register():
    data = request.get_json() or {}
    username = data.get("username")
    password = data.get("password")
    phone = data.get("phone")
    email = data.get("email")

    if not username or not password or not email:
        return jsonify({"error": "username, password 和 email 都是必填的"}), 400

    if User.query.filter((User.username == username) | (User.email == email)).first():
        return jsonify({"error": "用户名或邮箱已存在"}), 409

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
        return jsonify({"success": True, "user": user.to_dict()}), 201
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"注册失败: {str(exc)}"}), 500


@user_control_bp.get("/logout")
@login_required
def logout():
    logout_user()
    return jsonify({"status": "success"}), 200


@user_control_bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    username = data.get("username")
    password = data.get("password")

    if not username or not password:
        return jsonify({"error": "用户名和密码不能为空"}), 400

    user = User.query.filter_by(username=username).first()
    if user and user.check_password(password):
        session.permanent = True
        login_user(user, remember=True, duration=timedelta(days=7))
        session["login_version"] = user.login_version
        return jsonify({"success": True})

    return jsonify({"error": "用户名或密码错误"}), 401


@user_control_bp.post("/change_password")
@login_required
def change_password():
    data = request.get_json(silent=True) or {}
    old_password = data.get("old_password")
    new_password = data.get("new_password")
    has_password = bool(current_user.password_hash)

    if not isinstance(new_password, str) or not new_password.strip():
        return jsonify({"status": "error", "message": "新密码不能为空"}), 400
    if len(new_password) < 6:
        return jsonify({"status": "error", "message": "新密码至少需要 6 位"}), 400

    if has_password:
        if not old_password:
            return jsonify({"status": "error", "message": "请输入当前密码"}), 400
        if not current_user.check_password(old_password):
            return jsonify({"status": "error", "message": "当前密码错误"}), 403
        if current_user.check_password(new_password):
            return jsonify({"status": "error", "message": "新密码不能与当前密码相同"}), 400

    current_user.set_password(new_password)
    current_user.increment_login_version()
    db.session.commit()
    session["login_version"] = current_user.login_version
    return jsonify({"status": "success", "message": "密码修改成功" if has_password else "密码设置成功"}), 200


@user_control_bp.get("/reset_password/<int:user_id>")
@login_required
@permission_required("member_edit")
def reset_password(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "用户不存在"}), 404

    user.set_password("123456")
    user.increment_login_version()
    db.session.commit()
    return jsonify({"status": "success", "message": "密码已重置为 123456"}), 200


@user_control_bp.get("/departments")
@login_required
def list_departments():
    departments = Department.query.order_by(Department.name.asc(), Department.id.asc()).all()
    return jsonify([_serialize_department_for_request(department) for department in departments])


@user_control_bp.post("/departments")
@login_required
@permission_required("department_edit")
def create_department():
    try:
        data = request.get_json() or {}
        name = str(data.get("name") or "").strip()
        if not name:
            return jsonify({"status": "error", "message": "部门名称不能为空"}), 400
        if Department.query.filter_by(name=name).first():
            return jsonify({"status": "error", "message": "部门已存在"}), 400

        department = Department(name=name)
        db.session.add(department)
        db.session.commit()
        return jsonify({"status": "success", "message": "部门创建成功", "id": department.id})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"创建失败: {str(exc)}"}), 500


@user_control_bp.put("/departments/<int:dept_id>")
@login_required
@permission_required("department_edit")
def rename_department(dept_id):
    try:
        department = Department.query.get(dept_id)
        if not department:
            return jsonify({"status": "error", "message": "部门不存在"}), 404

        data = request.get_json() or {}
        name = str(data.get("name") or "").strip()
        if not name:
            return jsonify({"status": "error", "message": "部门名称不能为空"}), 400

        existing = Department.query.filter(Department.name == name, Department.id != dept_id).first()
        if existing:
            return jsonify({"status": "error", "message": "部门已存在"}), 400

        department.name = name
        db.session.commit()
        return jsonify(
            {
                "status": "success",
                "message": "部门名称已更新",
                "data": department.to_dict(),
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"更新失败: {str(exc)}"}), 500


@user_control_bp.delete("/departments/<int:dept_id>")
@login_required
@permission_required("department_edit")
def delete_department(dept_id):
    try:
        if dept_id == 1:
            return jsonify({"status": "error", "message": "不能删除默认部门（1号群）"}), 403

        department = Department.query.get(dept_id)
        if not department:
            return jsonify({"status": "error", "message": "部门不存在"}), 404

        department.users.clear()
        department.permissions.clear()
        FilePermission.query.filter_by(department_id=dept_id).delete(synchronize_session=False)
        db.session.flush()
        db.session.delete(department)
        db.session.commit()
        return jsonify({"status": "success", "message": "部门删除成功"})
    except IntegrityError as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": _format_department_delete_integrity_error(exc)}), 409
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"删除失败: {str(exc)}"}), 500


@user_control_bp.post("/departments/<int:dept_id>/add_user")
@login_required
@permission_required("department_edit")
def add_user_to_department(dept_id):
    try:
        data = request.get_json() or {}
        user = User.query.get(data.get("user_id"))
        department = Department.query.get(dept_id)
        if not user or not department:
            return jsonify({"status": "error", "message": "用户或部门不存在"}), 404
        if department in user.departments:
            return jsonify({"status": "error", "message": "用户已在该部门"}), 400

        user.departments.append(department)
        db.session.commit()
        return jsonify({"status": "success", "message": "用户加入部门成功"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"加入失败: {str(exc)}"}), 500


@user_control_bp.post("/departments/<int:dept_id>/remove_user")
@login_required
@permission_required("department_edit")
def remove_user_from_department(dept_id):
    try:
        data = request.get_json() or {}
        user = User.query.get(data.get("user_id"))
        department = Department.query.get(dept_id)
        if not user or not department:
            return jsonify({"status": "error", "message": "用户或部门不存在"}), 404
        if user.id == 1 and department.id == 1:
            return jsonify({"status": "error", "message": "不能将系统管理员移出科技组"}), 403
        if department not in user.departments:
            return jsonify({"status": "error", "message": "用户不在该部门"}), 400

        user.departments.remove(department)
        db.session.commit()
        return jsonify({"status": "success", "message": "用户移出部门成功"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"移出失败: {str(exc)}"}), 500


def _save_member_renewal_proof(user, uploaded_file):
    if not uploaded_file or not getattr(uploaded_file, "filename", ""):
        return None

    raw_name = os.path.basename((uploaded_file.filename or "").strip())
    extension = os.path.splitext(raw_name)[1].lower()
    folder_name = user.username or f"user_{user.id}"
    target_dir = os.path.join(MEMBER_RENEWAL_ROOT, folder_name)
    os.makedirs(target_dir, exist_ok=True)

    filename = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(4)}{extension}"
    target_path = os.path.join(target_dir, filename)
    uploaded_file.save(target_path)
    return {
        "proof_path": to_short_data_path(target_path),
        "proof_name": raw_name or filename,
        "proof_mime": uploaded_file.mimetype or None,
    }


@user_control_bp.get("/member_renewal/<int:user_id>")
@login_required
def get_member_renewals(user_id):
    if not _current_user_has_any_permission(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES):
        return _permission_denied_response(MEMBERSHIP_ADMIN_READ_PERMISSION_NAMES)
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "用户不存在"}), 404
    return jsonify({"status": "success", "data": [item.to_dict() for item in user.member_renewals]})


@user_control_bp.post("/member_renewal/<int:user_id>")
@login_required
def create_member_renewal(user_id):
    if not _current_user_has_any_permission(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES):
        return _permission_denied_response(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES)
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "用户不存在"}), 404

    try:
        renewal_date_raw = request.form.get("renewal_date") or request.values.get("renewal_date")
        if not renewal_date_raw:
            return jsonify({"status": "error", "message": "续费日期不能为空"}), 400
        renewal_date = datetime.strptime(renewal_date_raw, "%Y-%m-%d").date()
        upload = request.files.get("proof") or request.files.get("file")
        saved = _save_member_renewal_proof(user, upload) or {}

        record = MemberRenewal(
            user_id=user.id,
            renewal_date=renewal_date,
            note=(request.form.get("note") or request.values.get("note") or "").strip() or None,
            proof_path=saved.get("proof_path"),
            proof_name=saved.get("proof_name"),
            proof_mime=saved.get("proof_mime"),
            created_by=current_user.id,
        )
        db.session.add(record)
        db.session.commit()
        return jsonify({"status": "success", "message": "会员续费已保存", "data": record.to_dict()})
    except ValueError:
        db.session.rollback()
        return jsonify({"status": "error", "message": "续费日期格式无效"}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"保存失败: {str(exc)}"}), 500


@user_control_bp.delete("/member_renewal/<int:renewal_id>")
@login_required
def delete_member_renewal(renewal_id):
    if not _current_user_has_any_permission(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES):
        return _permission_denied_response(MEMBERSHIP_ADMIN_WRITE_PERMISSION_NAMES)
    record = MemberRenewal.query.get(renewal_id)
    if not record:
        return jsonify({"status": "error", "message": "续费记录不存在"}), 404
    proof_path = record.proof_path
    try:
        db.session.delete(record)
        db.session.commit()
        if proof_path:
            full_path = os.path.join(DATA_PATH, proof_path)
            if os.path.isfile(full_path):
                os.remove(full_path)
        return jsonify({"status": "success", "message": "续费记录已删除"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"删除失败: {str(exc)}"}), 500


@user_control_bp.delete("/delete_user/<int:user_id>")
@login_required
@permission_required("member_edit")
def delete_user(user_id):
    if not any(department.id == 1 for department in current_user.departments):
        return jsonify({"status": "error", "message": "无权限删除用户"}), 403
    if user_id == 1:
        return jsonify({"status": "error", "message": "不能删除系统管理员用户"}), 403

    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "用户不存在"}), 404

    try:
        db.session.delete(user)
        db.session.commit()
        return jsonify({"status": "success", "message": "用户删除成功"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"删除失败: {str(exc)}"}), 500


@user_control_bp.get("/departments/<int:dept_id>/users")
@login_required
def get_department_users(dept_id):
    if not _current_user_has_any_permission(FULL_DEPARTMENT_READ_PERMISSION_NAMES):
        return _permission_denied_response(FULL_DEPARTMENT_READ_PERMISSION_NAMES)

    department = Department.query.get(dept_id)
    if not department:
        return jsonify({"status": "error", "message": "部门不存在"}), 404

    users = department.users
    if _current_user_has_any_permission(FULL_USER_READ_PERMISSION_NAMES):
        user_data = _serialize_users_with_xin_ya(users)
    else:
        user_data = [_serialize_basic_user(user, include_membership=True) for user in users]

    return jsonify(
        {
            "id": department.id,
            "name": department.name,
            "login": True,
            "users": user_data,
        }
    )


@user_control_bp.post("/upload_profile_image")
@login_required
def upload_profile_image():
    if "image" not in request.files:
        return jsonify({"success": False, "error": "No file part"})

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"success": False, "error": "No selected file"})

    if file:
        img = Image.open(file.stream).convert("RGB")
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
        return jsonify({"success": True})

    return jsonify({"success": False, "error": "File upload failed"})


@user_control_bp.route("/get_profile_image/<username>")
@user_control_bp.route("/get_profile_image/<username>/<size>")
def get_profile_image(username, size="M"):
    if username.isdigit():
        user = User.query.get(int(username))
        if user:
            username = user.username
        else:
            return send_file(os.path.join(PROFILE_PATH, "user.jpg"))

    if size == "S":
        image_path = os.path.join(PROFILE_PATH, f"{username}_profile_image_s.jpg")
    elif size == "M":
        image_path = os.path.join(PROFILE_PATH, f"{username}_profile_image.jpg")
    elif size == "L":
        image_path = os.path.join(PROFILE_PATH, f"{username}_profile_image_l.jpg")
    else:
        return jsonify({"success": False, "error": "Invalid size"}), 400

    if os.path.exists(image_path):
        return send_file(image_path)
    return send_file(os.path.join(PROFILE_PATH, "user.jpg"))


@user_control_bp.post("/update_user/<int:user_id>")
@login_required
def update_user(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "用户不存在"}), 404

    data = request.get_json() or {}
    try:
        user_permissions = get_current_user_permissions(current_user)
        can_edit_others = "member_edit" in user_permissions
        if current_user.id != user.id and not can_edit_others:
            return jsonify({"status": "error", "message": "你只能修改自己的资料"}), 403

        allowed_fields = set(SELF_EDITABLE_USER_FIELDS)
        if can_edit_others:
            allowed_fields |= ADMIN_EXTRA_EDITABLE_USER_FIELDS
        else:
            # 自助修改邮箱必须走 /api/email/change-request 的验证流程，这里不直接改 email。
            allowed_fields.discard("email")

        _save_user_updates(user, data, allowed_fields=allowed_fields)
        return jsonify({"status": "success", "message": "用户信息更新成功"})
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 400
    except IntegrityError:
        db.session.rollback()
        return jsonify({"status": "error", "message": "资料更新失败，可能是 Email 或 Phone 已重复"}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"更新失败: {str(exc)}"}), 500
