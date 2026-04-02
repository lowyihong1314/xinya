from datetime import date, datetime
from decimal import Decimal

from flask import jsonify, request, send_file
from flask_login import current_user

from app.auth import get_current_user_permissions
from app.form.services import (
    MEMBERSHIP_FEE_SCOPE,
    _calc_age_from_nric,
    _collect_long_term_fee_images,
    _delete_register_fee_image,
    _get_or_create_member_by_nric,
    _get_scoped_regis_payment_or_404,
    _replace_scoped_registration_fees,
    _resolve_register_payment_proof,
    _save_register_payment_proof,
    _serialize_long_term_payment_settings,
)
from models import db
from models.form import RegisPayment
from models.membership_registration import (
    MEMBERSHIP_ROLE_OPTIONS,
    MembershipRegistration,
)
from models.user_data import MemberRenewal, User


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
        return _calc_age_from_nric(nric)
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
    token = str(getattr(registration, "payment_token", "") or "").strip()
    if not token:
        return None
    return f"{request.host_url.rstrip('/')}/template/membership-payment?t={token}"


def _serialize_membership_registration(registration):
    if not registration:
        return None
    age = _member_age(registration.member)
    settings = _serialize_long_term_payment_settings(age=age, fee_scope=MEMBERSHIP_FEE_SCOPE)
    data = registration.to_dict()
    data["payment_url"] = _build_membership_payment_public_url(registration)
    data["age"] = age
    data["selected_fee"] = settings.get("selected_fee")
    data["fee_amount"] = settings.get("amount")
    data["fee_description"] = settings.get("description")
    return data


def _membership_settings_payload(age=None):
    return _serialize_long_term_payment_settings(age=age, fee_scope=MEMBERSHIP_FEE_SCOPE)


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
        getattr(user, "phone", None)
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

    return jsonify({"status": "error", "message": "无权访问这份会员资料"}), 403


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
        "is_member": bool(user.is_member),
        "has_password": bool(user.password_hash),
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

    if actor_user is not None:
        if actor_user.is_member:
            raise ValueError("当前账号已是会员，请直接使用续费入口")

        requested_username = actor_user.username
        if not requested_username:
            requested_username = _clean_username(payload.get("username"))
        if not requested_username:
            raise ValueError("请填写 username")

        member = actor_user.nric_asset
        if member and _clean_text(getattr(member, "nric", None)):
            if applicant_name and not _clean_text(getattr(member, "name_nric", None)):
                member.name_nric = applicant_name
        else:
            nric = _clean_text(payload.get("nric"))
            if not nric:
                raise ValueError("请先在 Profile 资料页填写并保存 NRIC，或在这里补上 NRIC")
            member = _get_or_create_member_by_nric(
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
        if not requested_username:
            raise ValueError("请填写 username")

        nric = _clean_text(payload.get("nric"))
        if not nric:
            raise ValueError("请填写 NRIC")
        if not applicant_name:
            raise ValueError("请填写姓名")

        member = _get_or_create_member_by_nric(nric, name_nric=applicant_name)
        age = _member_age(member)
        if age is None:
            raise ValueError("当前 NRIC 无法解析年龄，请先检查资料")

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


def _submit_membership_upgrade_internal(payload, *, actor_user=None):
    try:
        member, age, requested_username, applicant_name = _resolve_membership_submission_target(
            payload,
            actor_user=actor_user,
        )
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400

    facebook_profile_url = _clean_text(payload.get("facebook_profile_url"))
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
        return jsonify({"status": "error", "message": "请填写 Facebook 个人主页链接"}), 400
    if not nric_address:
        return jsonify({"status": "error", "message": "请填写 NRIC_address"}), 400
    if not ancestral_home:
        return jsonify({"status": "error", "message": "请填写籍贯"}), 400
    if not occupation:
        return jsonify({"status": "error", "message": "请填写职业"}), 400
    if refuge_taken is None:
        return jsonify({"status": "error", "message": "请填写是否皈依"}), 400
    if not emergency_contact_name or not emergency_contact_phone:
        return jsonify({"status": "error", "message": "请完整填写紧急联络人资料"}), 400
    if membership_role not in MEMBERSHIP_ROLE_OPTIONS:
        return jsonify({"status": "error", "message": "加入身份无效"}), 400

    refuge_year = None
    if refuge_taken:
        if not refuge_year_raw:
            return jsonify({"status": "error", "message": "已皈依者请填写皈依年份"}), 400
        try:
            refuge_year = int(refuge_year_raw)
        except (TypeError, ValueError):
            return jsonify({"status": "error", "message": "皈依年份格式无效"}), 400

        current_year = datetime.utcnow().year
        if refuge_year < 1900 or refuge_year > current_year:
            return jsonify({"status": "error", "message": "皈依年份超出合理范围"}), 400
        if not refuge_master:
            return jsonify({"status": "error", "message": "请填写皈依证明法师"}), 400
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
            return jsonify({"status": "error", "message": "推荐人无效"}), 400
        recommender = User.query.filter_by(id=recommender_user_id, is_member=True).first()
        if not recommender:
            return jsonify({"status": "error", "message": "推荐人必须来自现有会员名单"}), 400
    else:
        recommender_user_id = None
        if _membership_recommender_options():
            return jsonify({"status": "error", "message": "请选择推荐人"}), 400

    if actor_user is not None:
        existing = _latest_membership_registration(actor_user.id, "upgrade")
    else:
        existing = _latest_public_membership_registration(member.id)

    latest_payment = existing.latest_membership_payment() if existing else None
    if existing and latest_payment and latest_payment.status == "checked":
        changed = _sync_membership_registration_status(existing)
        if changed:
            db.session.commit()
        return jsonify(
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
        return jsonify(
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
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


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

    return jsonify(
        {
            "status": "success",
            "context": {
                "user": {
                    "id": current_user.id,
                    "username": current_user.username,
                    "display_name": current_user.display_name,
                    "email": current_user.email,
                    "phone": current_user.phone,
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

    return jsonify(
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
                "latest_upgrade": _serialize_membership_registration(latest_upgrade),
                "latest_renewal": _serialize_membership_registration(latest_renewal),
            },
        }
    )


def get_long_open_registration_route(nric):
    nric = _clean_text(nric)
    if not nric:
        return jsonify({"status": "error", "message": "缺少 NRIC"}), 400

    try:
        age = _calc_age_from_nric(nric)
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400

    route = _long_open_route_for_age(age)
    return jsonify({"status": "success", "age": age, **route})


def submit_membership_upgrade(payload):
    return _submit_membership_upgrade_internal(payload, actor_user=current_user)


def submit_public_membership_upgrade(payload):
    return _submit_membership_upgrade_internal(payload, actor_user=_authenticated_user_or_none())


def start_membership_renewal():
    if not current_user.is_member:
        return jsonify({"status": "error", "message": "当前账号尚未启用会员身份"}), 400

    member = current_user.nric_asset
    if not member or not _clean_text(member.nric):
        return jsonify({"status": "error", "message": "请先在 Profile 资料页填写并绑定 NRIC"}), 400

    existing = _latest_membership_registration(current_user.id, "renew")
    latest_payment = existing.latest_membership_payment() if existing else None

    if existing and latest_payment and latest_payment.status == "checked":
        changed = _sync_membership_registration_status(existing)
        if changed:
            db.session.commit()
        return jsonify(
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
        return jsonify(
            {
                "status": "success",
                "message": "续费链接已生成。",
                "registration": _serialize_membership_registration(registration),
                "payment_url": _build_membership_payment_public_url(registration),
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def get_membership_payment_context(token):
    token = _clean_text(token)
    if not token:
        return jsonify({"status": "error", "message": "缺少付款 token"}), 400

    registration = MembershipRegistration.query.filter_by(payment_token=token).first()
    if not registration:
        return jsonify({"status": "error", "message": "付款链接无效"}), 404

    try:
        if _sync_membership_registration_status(registration):
            db.session.commit()
    except Exception:
        db.session.rollback()

    settings = _membership_settings_payload(age=_member_age(registration.member))
    latest_payment = registration.latest_membership_payment()
    payment_enabled = bool(settings.get("payment_enabled"))
    can_submit = payment_enabled and not (latest_payment and latest_payment.status == "checked")

    return jsonify(
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
        return jsonify({"status": "error", "message": "缺少付款 token"}), 400

    registration = MembershipRegistration.query.filter_by(payment_token=token).first()
    if not registration:
        return jsonify({"status": "error", "message": "付款链接无效"}), 404

    settings = _membership_settings_payload(age=_member_age(registration.member))
    if not settings:
        return jsonify({"status": "error", "message": "管理员暂未配置会员费用"}), 400

    selected_fee = settings.get("selected_fee")
    amount = Decimal(str(settings.get("amount") or 0))
    if not selected_fee or amount <= 0:
        return jsonify({"status": "error", "message": "当前没有适合你年龄的会员费用选项，请联系管理员"}), 400

    latest_payment = registration.latest_membership_payment()
    if latest_payment and latest_payment.status == "checked":
        return jsonify({"status": "error", "message": "系统显示你已完成付款，无需重复提交"}), 400

    payment_mode = _clean_text(data.get("payment_mode")) or "QR"

    try:
        proof_image_path = _save_register_payment_proof(proof_image)
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
        return jsonify(
            {
                "status": "success",
                "message": success_message,
                "payment": payment.to_dict(),
                "registration": _serialize_membership_registration(registration),
            }
        )
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def get_membership_payment_proof_image(payment_id):
    payment = _get_scoped_regis_payment_or_404(payment_id, MEMBERSHIP_FEE_SCOPE)
    registration = payment.membership_registration

    access_error = _ensure_membership_access(registration)
    if access_error is not None:
        return access_error

    image_path = _resolve_register_payment_proof(payment.proof_image_path)
    if not image_path:
        return jsonify({"status": "error", "message": "付款截图不存在"}), 404
    return send_file(image_path)


def get_membership_payment_settings():
    return jsonify({"status": "success", "settings": _membership_settings_payload()})


def update_membership_payment_settings(data):
    try:
        fee_rows, old_fee_image_paths = _replace_scoped_registration_fees(
            MEMBERSHIP_FEE_SCOPE,
            data.get("fees") if data.get("fees") is not None else data.get("fee_options"),
        )

        db.session.commit()

        new_fee_image_paths = _collect_long_term_fee_images(fee_rows)
        for removed_path in old_fee_image_paths - new_fee_image_paths:
            _delete_register_fee_image(removed_path)

        return jsonify(
            {
                "status": "success",
                "message": "会员费用选项已更新",
                "settings": _serialize_long_term_payment_settings(
                    fee_scope=MEMBERSHIP_FEE_SCOPE,
                    fee_source=fee_rows,
                ),
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def get_membership_registrations():
    try:
        entries = (
            MembershipRegistration.query.order_by(
                MembershipRegistration.submitted_at.desc(),
                MembershipRegistration.id.desc(),
            ).all()
        )
        changed = False
        for entry in entries:
            changed = _sync_membership_registration_status(entry) or changed
        if changed:
            db.session.commit()

        return jsonify(
            {
                "status": "success",
                "entries": [_serialize_membership_registration(entry) for entry in entries],
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def update_membership_payment_status(payment_id, data):
    payment = _get_scoped_regis_payment_or_404(payment_id, MEMBERSHIP_FEE_SCOPE)
    registration = payment.membership_registration
    status = _clean_text(data.get("status"))
    allowed_statuses = {"process", "checked", "fail"}

    if status not in allowed_statuses:
        return jsonify({"status": "error", "message": "付款状态无效"}), 400

    if payment.status == "checked" and status != "checked":
        renewal = _membership_renewal_for_registration(registration)
        if renewal:
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": "这笔会员付款已经生效，不能直接回退，请先到用户管理手动处理会员状态与续费记录。",
                    }
                ),
                400,
            )

    try:
        payment.status = status

        if status == "checked":
            _apply_membership_approval(registration)
        elif status == "fail":
            registration.status = "reject"
        else:
            registration.status = "process"

        db.session.commit()
        return jsonify(
            {
                "status": "success",
                "message": "会员付款状态已更新",
                "payment": payment.to_dict(),
                "registration": _serialize_membership_registration(registration),
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500
