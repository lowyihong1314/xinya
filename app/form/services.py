import base64
import json
import mimetypes
import os
import secrets
from datetime import datetime
from decimal import Decimal, InvalidOperation

from flask import abort, jsonify, render_template, request, send_file
from flask_login import current_user
from werkzeug.utils import secure_filename

from app.timezone import malaysia_now
from app.paths import DATA_ROOT, PROJECT_ROOT, STATIC_ROOT
from app.redis_client import redis_client
from .pdf import merge_html_files_to_pdf
from .realtime import emit_form_event, emit_youth_class_event
from models.form import (
    NRIC_Asset,
    RegistrationFee,
    RegisForm,
    RegisFormExtraFieldConfig,
    RegisMemberData,
    RegisMemberFieldValue,
    RegisPayment,
    RegisParentalData,
)
from models.user_data import User, db
from models.event_data import AlbumFiles, EventData
from models.youth_class_registration import (
    YOUTH_COUNCIL_APPROVAL_MAX,
    YouthClassCouncilSignature,
    YouthClassRegistration,
)
from models.membership_registration import MembershipRegistration
from app.auth import get_current_user_permissions
from app.common import council_sign

PARENTAL_SHARE_PREFIX = "parental_sign_share"
PARENTAL_SHARE_TTL = 60 * 60 * 12
SUPPORTED_EXTRA_FIELD_TYPES = {"text", "textarea", "number", "date", "select", "checkbox"}
FIELD_SWITCH_KEYS = [
    "email",
    "parental_form",
    "parent_1",
    "parent_2",
    "parent_1_phone",
    "parent_2_phone",
    "address",
    "medical",
    "allergy",
    "other_remark",
]

ALLOWED_FEE_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".heic", ".heif"}
REGISTER_FEE_IMAGE_DIR = STATIC_ROOT / "images" / "register_fee_image"
REGISTER_PAYMENT_PROOF_DIR = DATA_ROOT / "register_payment_images"
LEGACY_REGISTER_PAYMENT_PROOF_DIR = STATIC_ROOT / "images" / "register_payment_proof"
FORM_FEE_SCOPE = "form"
MEMBERSHIP_FEE_SCOPE = "membership"
YOUTH_CLASS_FEE_SCOPE = "youth_class"


def _parse_iso_date(value):
    if not value:
        return None
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _upsert_parental_data(member_data, payload):
    if not isinstance(payload, dict):
        raise ValueError("家长同意书资料格式不正确")

    parental = member_data.parental_data
    if not parental:
        parental = RegisParentalData(regis_member_data_id=member_data.id)
        db.session.add(parental)

    for key in [
        "parent_cn",
        "parent_en",
        "parent_nric",
        "parent_phone",
        "child_cn",
        "child_en",
        "child_nric",
        "child_phone",
        "sign",
    ]:
        if key in payload:
            setattr(parental, key, payload.get(key) or None)

    if "sign_json_data" in payload:
        parental.sign_json_data = payload.get("sign_json_data")

    sign_date = _parse_iso_date(payload.get("sign_date"))
    if sign_date:
        parental.sign_date = sign_date
    elif parental.sign_json_data and not parental.sign_date:
        parental.sign_date = malaysia_now().date()

    if not member_data.parent_1 and parental.parent_cn:
        member_data.parent_1 = parental.parent_cn
    if not member_data.parent_1_phone and parental.parent_phone:
        member_data.parent_1_phone = parental.parent_phone
    member_data.parental_form = True

    return parental


def _is_form_registration_closed(form):
    return bool(form.expired and malaysia_now().date() > form.expired)


def _inject_public_registration_status(form_data, form):
    form_data["registration_closed"] = _is_form_registration_closed(form)
    return form_data


def form_index_response(form_id):
    form = RegisForm.query.get_or_404(form_id)
    custom_tpl = f"form/custom_template/{form_id}.html"
    tpl_path = os.path.join(PROJECT_ROOT, "templates", custom_tpl)
    form_data = form.to_dict_event(is_public=True)
    _inject_public_registration_status(form_data, form)

    if os.path.exists(tpl_path):
        return render_template(custom_tpl, form=form_data)
    return render_template("form/index.html", form=form_data)


def pay_register_page_response(form_id):
    form = RegisForm.query.get_or_404(form_id)
    return render_template("form/pay_register.html", form=form.to_dict_event(is_public=True))


def _decode_share_json(value):
    if not value:
        return None

    try:
        padding = "=" * (-len(value) % 4)
        raw = base64.urlsafe_b64decode(f"{value}{padding}".encode("utf-8"))
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def parental_sign_page():
    token = request.args.get("t")
    if token:
        raw = redis_client.get(f"{PARENTAL_SHARE_PREFIX}:{token}")
        if not raw:
            return abort(404, "家长签名链接已失效")

        try:
            context = json.loads(raw)
        except Exception:
            return abort(404, "家长签名链接无效")

        if not context.get("form") or not context.get("payload"):
            return abort(404, "家长签名链接无效")

        return render_template("form/parental_sign.html", context=context)

    context = {
        "form": _decode_share_json(request.args.get("form")),
        "payload": _decode_share_json(request.args.get("payload")),
        "parent": _decode_share_json(request.args.get("parent")) or {},
        "room": request.args.get("room") or "",
    }

    if not context["form"] or not context["payload"]:
        return abort(400, "Missing form or payload")

    return render_template("form/parental_sign.html", context=context)


def create_parental_sign_share(data):
    form = data.get("form")
    payload = data.get("payload")
    parent = data.get("parent") or {}
    room = data.get("room") or ""

    if not isinstance(form, dict) or not isinstance(payload, dict):
        return jsonify({"status": "error", "message": "缺少 form 或 payload"}), 400

    token = secrets.token_urlsafe(8)
    context = {
      "form": form,
      "payload": payload,
      "parent": parent if isinstance(parent, dict) else {},
      "room": room,
    }

    redis_client.setex(
        f"{PARENTAL_SHARE_PREFIX}:{token}",
        PARENTAL_SHARE_TTL,
        json.dumps(context, ensure_ascii=False),
    )

    return jsonify(
        {
            "status": "success",
            "token": token,
            "url": f"{request.host_url.rstrip('/')}/api/form/parental_sign?t={token}",
            "expires_in": PARENTAL_SHARE_TTL,
        }
    )


def event_poster_response(form_id):
    form = RegisForm.query.get_or_404(form_id)
    if not form.events:
        abort(404, "No event for this form")

    last_event = form.events[-1]
    image = getattr(last_event, "event_image", None)
    if not image or not getattr(image, "id", None):
        abort(404, "No event poster")

    file = AlbumFiles.query.get(image.id)
    if not file:
        abort(404, "File not found")

    full_path = os.path.join(
        DATA_ROOT,
        "NAS",
        "UTBA",
        "event_photo",
        file.event.event_code,
        secure_filename(file.file_name),
    )
    if not os.path.exists(full_path):
        abort(404, "Source missing")

    return send_file(full_path, conditional=True)


def _parse_dob_from_nric(nric):
    digits = "".join(ch for ch in str(nric or "") if ch.isdigit())
    if len(digits) < 6:
        raise ValueError("NRIC 至少需要前 6 位数字")

    yy = int(digits[0:2])
    mm = int(digits[2:4])
    dd = int(digits[4:6])
    today = datetime.utcnow().date()
    current_yy = int(str(today.year)[-2:])
    year = 1900 + yy if yy > current_yy else 2000 + yy

    try:
        return datetime(year, mm, dd).date()
    except ValueError as exc:
        raise ValueError("NRIC 出生日期无效") from exc


def _calc_age_from_nric(nric):
    dob = _parse_dob_from_nric(nric)
    today = datetime.utcnow().date()
    age = today.year - dob.year
    if (today.month, today.day) < (dob.month, dob.day):
        age -= 1
    if age < 0 or age > 120:
        raise ValueError("NRIC 推算年龄无效")
    return age


def _fee_matches_age(fee, age):
    if fee.age_range_from is not None and age < fee.age_range_from:
        return False
    if fee.age_range_to is not None and age > fee.age_range_to:
        return False
    return True


def _serialize_fee_candidate(fee, form):
    data = fee.to_dict()
    data["form"] = {
        "id": form.id,
        "title": form.title,
        "created_at": form.created_at.isoformat() if form.created_at else None,
    }
    return data


def _sorted_fees_for_form(form):
    return sorted(
        [fee for fee in (form.fees or []) if getattr(fee, "fee_scope", FORM_FEE_SCOPE) == FORM_FEE_SCOPE],
        key=lambda fee: (fee.created_at or datetime.min, fee.id or 0),
        reverse=True,
    )


def _pick_fee_for_age(fees, age):
    for fee in fees:
        if _fee_matches_age(fee, age):
            return fee
    return None


def _save_register_fee_image(file_storage):
    if not file_storage or not getattr(file_storage, "filename", ""):
        raise ValueError("请选择图片文件")

    original_name = secure_filename(file_storage.filename or "")
    extension = os.path.splitext(original_name)[1].lower()
    if extension not in ALLOWED_FEE_IMAGE_EXTENSIONS:
        raise ValueError("仅支持 PNG、JPG、JPEG、HEIC 图片")

    REGISTER_FEE_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(8)}{extension}"
    target_path = REGISTER_FEE_IMAGE_DIR / filename
    file_storage.save(target_path)
    return f"/static/images/register_fee_image/{filename}"


def _delete_register_fee_image(image_path):
    normalized = str(image_path or "").strip()
    prefix = "/static/images/register_fee_image/"
    if not normalized.startswith(prefix):
        return

    filename = normalized.removeprefix(prefix)
    target_path = REGISTER_FEE_IMAGE_DIR / filename
    if target_path.exists():
        try:
            target_path.unlink()
        except OSError:
            pass


def _save_register_payment_proof(file_storage):
    if not file_storage or not getattr(file_storage, "filename", ""):
        raise ValueError("请上传付款截图")

    original_name = (file_storage.filename or "").strip()
    extension = os.path.splitext(original_name)[1].lower()
    if extension not in ALLOWED_FEE_IMAGE_EXTENSIONS:
        raise ValueError("付款截图仅支持 PNG、JPG、JPEG、HEIC、HEIF 图片")

    REGISTER_PAYMENT_PROOF_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(8)}{extension}"
    target_path = REGISTER_PAYMENT_PROOF_DIR / filename
    file_storage.save(target_path)
    return f"database/register_payment_images/{filename}"


def _resolve_register_payment_proof(image_path):
    normalized = str(image_path or "").strip()
    if not normalized:
        return None

    normalized = normalized.replace("\\", "/")

    current_prefixes = (
        "database/register_payment_images/",
        "/database/register_payment_images/",
    )
    for prefix in current_prefixes:
        if normalized.startswith(prefix):
            filename = secure_filename(os.path.basename(normalized))
            if not filename:
                return None
            target_path = REGISTER_PAYMENT_PROOF_DIR / filename
            if target_path.exists():
                return target_path
            return None

    legacy_prefix = "/static/images/register_payment_proof/"
    if not normalized.startswith(legacy_prefix):
        return None

    filename = secure_filename(os.path.basename(normalized.removeprefix(legacy_prefix)))
    if not filename:
        return None

    target_path = LEGACY_REGISTER_PAYMENT_PROOF_DIR / filename
    if target_path.exists():
        return target_path
    return None


def _delete_register_payment_proof(image_path):
    target_path = _resolve_register_payment_proof(image_path)
    if not target_path or not target_path.exists():
        return
    try:
        target_path.unlink()
    except OSError:
        pass


def _normalize_money(value, *, allow_zero=True):
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("请填写报名费")

    try:
        amount = Decimal(raw)
    except (InvalidOperation, TypeError) as exc:
        raise ValueError("报名费格式无效") from exc

    if amount < 0 or (not allow_zero and amount <= 0):
        raise ValueError("报名费必须大于 0")
    return amount.quantize(Decimal("0.01"))


def _normalize_optional_age_bound(value, label):
    normalized = str(value or "").strip()
    if not normalized:
        return None
    try:
        age = int(normalized)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label}必须是整数") from exc
    if age < 0 or age > 120:
        raise ValueError(f"{label}必须介于 0 到 120 岁")
    return age


def _default_long_term_fee_category(age_range_from, age_range_to):
    if age_range_from is not None and age_range_to is not None:
        return f"{age_range_from}-{age_range_to} 岁"
    if age_range_from is not None:
        return f"{age_range_from} 岁以上"
    if age_range_to is not None:
        return f"{age_range_to} 岁以下"
    return "所有年龄"


def _list_scoped_registration_fees(fee_scope):
    return (
        RegistrationFee.query.filter_by(fee_scope=fee_scope, regis_form_id=None)
        .order_by(RegistrationFee.created_at.asc(), RegistrationFee.id.asc())
        .all()
    )


def _serialize_long_term_fee_option(option):
    if not option:
        return None
    if hasattr(option, "to_dict"):
        return option.to_dict()
    return {
        "id": option.get("id"),
        "category": option.get("category"),
        "age_range_from": option.get("age_range_from"),
        "age_range_to": option.get("age_range_to"),
        "amount": float(option.get("amount") or 0),
        "description": option.get("description"),
        "image_path": option.get("image_path"),
        "label": option.get("label"),
        "created_at": option.get("created_at"),
    }


def _sorted_long_term_fee_options(options):
    return sorted(
        list(options or []),
        key=lambda item: (
            getattr(item, "age_range_from", None) is None,
            getattr(item, "age_range_from", None) if getattr(item, "age_range_from", None) is not None else 10**9,
            getattr(item, "age_range_to", None) is None,
            getattr(item, "age_range_to", None) if getattr(item, "age_range_to", None) is not None else 10**9,
            getattr(item, "id", 0) or 0,
        ),
    )


def _pick_long_term_fee_option(options, age):
    if age is None:
        return None

    matches = [item for item in _sorted_long_term_fee_options(options) if _fee_matches_age(item, age)]
    if not matches:
        return None

    def _priority(item):
        lower = item.age_range_from if item.age_range_from is not None else -1
        upper = item.age_range_to if item.age_range_to is not None else 10**9
        return (lower, -(upper - lower), item.id or 0)

    return max(matches, key=_priority)


def _normalize_long_term_fee_options(raw_options):
    if raw_options in (None, ""):
        return []
    if not isinstance(raw_options, list):
        raise ValueError("fee_options 必须是数组")

    normalized = []
    for index, item in enumerate(raw_options, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"第 {index} 条报名费选项格式无效")

        age_range_from = _normalize_optional_age_bound(item.get("age_range_from"), f"第 {index} 条起始年龄")
        age_range_to = _normalize_optional_age_bound(item.get("age_range_to"), f"第 {index} 条结束年龄")
        if age_range_from is not None and age_range_to is not None and age_range_from > age_range_to:
            raise ValueError(f"第 {index} 条年龄区间无效")

        category = str(item.get("category") or "").strip() or _default_long_term_fee_category(age_range_from, age_range_to)
        amount = _normalize_money(item.get("amount"), allow_zero=False)
        description = str(item.get("description") or "").strip() or None
        image_path = str(item.get("image_path") or "").strip() or None
        normalized.append(
            {
                "category": category,
                "age_range_from": age_range_from,
                "age_range_to": age_range_to,
                "amount": amount,
                "description": description,
                "image_path": image_path,
            }
        )

    return normalized


def _collect_long_term_fee_images(items):
    image_paths = set()
    for item in items or []:
        normalized = str(getattr(item, "image_path", None) or "").strip()
        if normalized:
            image_paths.add(normalized)
    return image_paths


def _replace_scoped_registration_fees(fee_scope, raw_options):
    normalized_options = _normalize_long_term_fee_options(raw_options)
    existing_fees = _list_scoped_registration_fees(fee_scope)
    old_image_paths = _collect_long_term_fee_images(existing_fees)

    for existing in existing_fees:
        db.session.delete(existing)
    db.session.flush()

    created_fees = []
    for item in normalized_options:
        fee = RegistrationFee(
            regis_form_id=None,
            fee_scope=fee_scope,
            category=item["category"],
            age_range_from=item["age_range_from"],
            age_range_to=item["age_range_to"],
            amount=item["amount"],
            description=item["description"],
            image_path=item["image_path"],
            created_at=datetime.utcnow(),
        )
        db.session.add(fee)
        created_fees.append(fee)

    return created_fees, old_image_paths


def _serialize_long_term_payment_settings(*, age=None, fee_scope=None, fee_source=None):
    payload = {
        "id": None,
        "amount": 0,
        "description": "",
        "image_path": "",
        "created_at": None,
        "updated_at": None,
    }
    if fee_source is None:
        fee_source = _list_scoped_registration_fees(fee_scope) if fee_scope else []

    fee_options = _sorted_long_term_fee_options(fee_source)
    serialized_fees = []
    for item in fee_options:
        serialized = _serialize_long_term_fee_option(item)
        serialized["category"] = str(serialized.get("category") or "").strip() or _default_long_term_fee_category(
            serialized.get("age_range_from"),
            serialized.get("age_range_to"),
        )
        serialized["image_path"] = str(serialized.get("image_path") or "").strip()
        serialized_fees.append(serialized)

    selected_fee = _pick_long_term_fee_option(fee_options, age) if age is not None else None
    fallback_fee = selected_fee or (fee_options[0] if fee_options and age is None else None)
    serialized_selected_fee = None
    if selected_fee is not None:
        serialized_selected_fee = _serialize_long_term_fee_option(selected_fee)
        serialized_selected_fee["category"] = str(serialized_selected_fee.get("category") or "").strip() or _default_long_term_fee_category(
            serialized_selected_fee.get("age_range_from"),
            serialized_selected_fee.get("age_range_to"),
        )
        serialized_selected_fee["image_path"] = str(serialized_selected_fee.get("image_path") or "").strip()

    if fallback_fee is not None:
        payload["amount"] = float(fallback_fee.amount or 0)
        payload["description"] = str(getattr(fallback_fee, "description", None) or "").strip()
        payload["image_path"] = str(getattr(fallback_fee, "image_path", None) or "").strip()
    elif fee_options and age is not None:
        payload["amount"] = 0

    payload["image_path"] = str(payload.get("image_path") or "").strip()
    payload["fees"] = serialized_fees
    payload["fee_options"] = serialized_fees
    payload["selected_fee"] = serialized_selected_fee
    payload["payment_enabled"] = bool(Decimal(str(payload.get("amount") or 0)) > 0)
    return payload


def _generate_youth_payment_token():
    while True:
        token = secrets.token_urlsafe(24)
        exists = YouthClassRegistration.query.filter_by(payment_token=token).first()
        if not exists:
            return token


def _get_latest_youth_payment(entry):
    payments = getattr(entry, "payments", None) or []
    if payments:
        return payments[0]
    return (
        RegisPayment.query.filter_by(
            payment_scope=YOUTH_CLASS_FEE_SCOPE,
            youth_class_registration_id=entry.id,
        )
        .order_by(RegisPayment.id.desc())
        .first()
    )


def _get_scoped_regis_payment_or_404(payment_id, payment_scope):
    query = RegisPayment.query.filter_by(id=payment_id, payment_scope=payment_scope)
    if payment_scope == FORM_FEE_SCOPE:
        query = query.filter(RegisPayment.regis_form_id.isnot(None))
    elif payment_scope == MEMBERSHIP_FEE_SCOPE:
        query = query.filter(RegisPayment.membership_registration_id.isnot(None))
    elif payment_scope == YOUTH_CLASS_FEE_SCOPE:
        query = query.filter(RegisPayment.youth_class_registration_id.isnot(None))
    return query.first_or_404()


def _build_youth_payment_public_url(entry):
    token = str(getattr(entry, "payment_token", "") or "").strip()
    if not token:
        return None
    return f"{request.host_url.rstrip('/')}/template/youth-class-registration/payment?t={token}"


def _serialize_youth_entry(entry, fee_source=None):
    data = entry.to_dict()
    settings = _serialize_long_term_payment_settings(
        age=getattr(entry, "age", None),
        fee_scope=YOUTH_CLASS_FEE_SCOPE,
        fee_source=fee_source,
    )
    data["selected_fee"] = settings.get("selected_fee")
    data["fee_amount"] = settings.get("amount")
    data["fee_description"] = settings.get("description")
    data["payment_url"] = _build_youth_payment_public_url(entry)
    return council_sign.augment_serialized("youth_class", entry, data)


def _maybe_activate_youth(entry):
    """财政 + 理事会都通过后，青少年佛学班报名才真正生效（status=paid）。

    青少年报名没有登录账号（无 user_id），生效只是把状态置为 paid，不创建续费/会员记录。
    """
    if not entry:
        return False
    if entry.status == "paid":
        return False
    if not entry.fully_approved():
        return False
    entry.status = "paid"
    return True


def _youth_applicant_name(entry):
    return (
        getattr(entry, "chinese_name", None)
        or getattr(entry, "english_name", None)
        or f"报名 #{getattr(entry, 'id', '')}"
    )


# 注册青少年佛学班 scope 到共用理事会签名模块。
council_sign.register_scope(
    council_sign.CouncilScope(
        scope="youth_class",
        signature_model=YouthClassCouncilSignature,
        fk_attr="youth_class_registration_id",
        signatures_attr="council_signatures",
        max_signatures=YOUTH_COUNCIL_APPROVAL_MAX,
        get_registration=lambda rid: YouthClassRegistration.query.get(rid),
        applicant_name=_youth_applicant_name,
        consent_object="青少年佛学班",
        org_name="地南佛学会",
        activate=_maybe_activate_youth,
        serialize=_serialize_youth_entry,
    )
)


YOUTH_EDITABLE_FIELDS = {
    "chinese_name",
    "english_name",
    "phone",
    "gender",
    "address",
    "emergency_contact_name",
    "emergency_contact_phone",
    "emergency_contact_relation",
}


def update_youth_class_registration_fields(entry_id, data):
    entry = YouthClassRegistration.query.get(entry_id)
    if not entry:
        return jsonify({"status": "error", "message": "报名记录不存在"}), 404

    if entry.status == "paid":
        return jsonify({"status": "error", "message": "该报名已经生效，无法再修改资料。"}), 400

    if not isinstance(data, dict):
        return jsonify({"status": "error", "message": "请求格式错误"}), 400

    unknown = set(data.keys()) - YOUTH_EDITABLE_FIELDS
    if unknown:
        return jsonify({"status": "error", "message": f"以下字段不可编辑：{', '.join(sorted(unknown))}"}), 400

    try:
        for field in YOUTH_EDITABLE_FIELDS:
            if field not in data:
                continue
            value = str(data.get(field) or "").strip()
            if field == "gender":
                if value and value not in {"男", "女"}:
                    return jsonify({"status": "error", "message": "性别无效"}), 400
                if not value:
                    return jsonify({"status": "error", "message": "性别不能为空"}), 400
                entry.gender = value
            else:
                if not value:
                    return jsonify({"status": "error", "message": "该字段不能为空"}), 400
                setattr(entry, field, value)

        db.session.commit()
        return jsonify({"status": "success", "message": "资料已更新", "entry": _serialize_youth_entry(entry)})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def _normalize_extra_field_label(value):
    label = (value or "").strip()
    if not label:
        raise ValueError("label 不能为空")
    return label


def _normalize_extra_field_type(value):
    field_type = (value or "text").strip().lower()
    if field_type not in SUPPORTED_EXTRA_FIELD_TYPES:
        raise ValueError(f"不支持的 field_type: {field_type}")
    return field_type


def _normalize_extra_field_order(value):
    if value in (None, ""):
        return 0
    try:
        return int(value)
    except Exception as exc:
        raise ValueError("order 必须是整数") from exc


def _normalize_extra_field_options(field_type, raw_options):
    if field_type != "select":
        return None

    if raw_options in (None, ""):
        return []

    if isinstance(raw_options, str):
        parts = raw_options.replace("\r", "\n").replace(",", "\n").split("\n")
        options = [part.strip() for part in parts if part.strip()]
    elif isinstance(raw_options, list):
        options = [str(part).strip() for part in raw_options if str(part).strip()]
    else:
        raise ValueError("options 格式无效")

    return options


def _normalize_extra_field_config(data, existing_order=0):
    field_type = _normalize_extra_field_type(data.get("field_type"))
    return {
        "label": _normalize_extra_field_label(data.get("label")),
        "field_type": field_type,
        "options": _normalize_extra_field_options(field_type, data.get("options")),
        "order": _normalize_extra_field_order(data.get("order", existing_order)),
    }


def _coerce_extra_field_value(field_config, raw_value):
    field_type = (field_config.field_type or "text").strip().lower()

    if field_type == "checkbox":
        if isinstance(raw_value, str):
            return raw_value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(raw_value)

    if raw_value in (None, ""):
        return None

    if field_type == "number":
        try:
            number = float(raw_value)
        except Exception as exc:
            raise ValueError(f"{field_config.label} 必须是数字") from exc
        return int(number) if number.is_integer() else number

    if field_type == "date":
        return str(raw_value).strip()

    value = str(raw_value).strip()

    if field_type == "select":
        options = field_config.options if isinstance(field_config.options, list) else []
        if options and value not in options:
            raise ValueError(f"{field_config.label} 选项无效")

    return value


def _extract_field_switches(data):
    nested = data.get("field_switches")
    source = nested if isinstance(nested, dict) else data
    switches = {}
    for key in FIELD_SWITCH_KEYS:
        if key in source:
            switches[key] = bool(source.get(key))

    if "parent_1" in switches and "parent_1_phone" not in switches:
        switches["parent_1_phone"] = switches["parent_1"]
    if "parent_1_phone" in switches and "parent_1" not in switches:
        switches["parent_1"] = switches["parent_1_phone"]

    if "parent_2" in switches and "parent_2_phone" not in switches:
        switches["parent_2_phone"] = switches["parent_2"]
    if "parent_2_phone" in switches and "parent_2" not in switches:
        switches["parent_2"] = switches["parent_2_phone"]

    return switches


def create_form(data):
    required_fields = ["title", "detail", "expired"]
    for field in required_fields:
        if field not in data:
            return jsonify({"status": "error", "message": f"缺少字段: {field}"}), 400

    try:
        field_switches = _extract_field_switches(data)
        form = RegisForm(
            title=data["title"],
            detail=data["detail"],
            expired=datetime.fromisoformat(data["expired"]).date(),
            email=field_switches.get("email", data.get("email", True)),
            parental_form=field_switches.get("parental_form", data.get("parental_form", False)),
            parent_1=field_switches.get("parent_1", data.get("parent_1", True)),
            parent_2=field_switches.get("parent_2", data.get("parent_2", False)),
            parent_1_phone=field_switches.get("parent_1_phone", data.get("parent_1", True)),
            parent_2_phone=field_switches.get("parent_2_phone", data.get("parent_2", False)),
            address=field_switches.get("address", data.get("address", False)),
            medical=field_switches.get("medical", data.get("medical", False)),
            allergy=field_switches.get("allergy", data.get("allergy", False)),
            other_remark=field_switches.get("other_remark", data.get("other_remark", False)),
        )
        db.session.add(form)
        db.session.flush()

        for extra_field in data.get("extra_fields_config", []):
            normalized = _normalize_extra_field_config(extra_field)
            db.session.add(
                RegisFormExtraFieldConfig(
                    regis_form_id=form.id,
                    label=normalized["label"],
                    field_type=normalized["field_type"],
                    options=normalized["options"],
                    order=normalized["order"],
                )
            )

        db.session.commit()
        return jsonify(
            {"status": "success", "message": "表单创建成功", "form": form.to_dict()}
        )
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def remove_form(data):
    form_id = data.get("form_id")
    if not form_id:
        return jsonify({"status": "error", "message": "缺少参数 form_id"}), 400

    try:
        form = RegisForm.query.get(form_id)
        if not form:
            return jsonify({"status": "error", "message": "未找到对应报名表"}), 404

        db.session.delete(form)
        db.session.commit()
        return jsonify({"status": "success", "message": f"报名表 ID {form_id} 已删除"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"删除失败: {exc}"}), 500


def _get_or_create_member_by_nric(nric, *, name_nric=None):
    normalized_nric = _normalize_member_nric(nric)
    normalized_name_nric = str(name_nric or "").strip() or None

    member = NRIC_Asset.query.filter_by(nric=normalized_nric).first()
    if not member:
        member = NRIC_Asset(nric=normalized_nric, name_nric=normalized_name_nric)
        db.session.add(member)
        db.session.flush()
        return member

    if normalized_name_nric and not getattr(member, "name_nric", None):
        member.name_nric = normalized_name_nric
    return member


def register_member(form_id, data):
    form = RegisForm.query.get_or_404(form_id)
    if _is_form_registration_closed(form):
        return jsonify({"status": "error", "message": "报名已截止，无法继续报名"}), 400

    for field in ["name", "name_cn", "nric", "phone", "gender"]:
        if not data.get(field):
            return jsonify({"status": "error", "message": f"缺少字段: {field}"}), 400

    try:
        member = _get_or_create_member_by_nric(
            data["nric"],
            name_nric=data.get("name"),
        )

        member_data = RegisMemberData(
            member_id=member.id,
            name_cn=data["name_cn"],
            name=data["name"],
            phone=data["phone"],
            gender=data["gender"],
            email=data.get("email"),
            address=data.get("address"),
            parent_1=data.get("parent_1"),
            parent_2=data.get("parent_2"),
            parent_1_phone=data.get("parent_1_phone"),
            parent_2_phone=data.get("parent_2_phone"),
            medical=data.get("medical"),
            allergy=data.get("allergy"),
            other_remark=data.get("other_remark"),
            available_time_slot_json=data.get("available_time_slot_json"),
        )
        db.session.add(member_data)
        db.session.flush()

        parental_payload = data.get("parental_payload")
        if parental_payload:
            db.session.add(
                RegisParentalData(
                    regis_member_data_id=member_data.id,
                    parent_cn=parental_payload.get("parent_cn"),
                    parent_en=parental_payload.get("parent_en"),
                    parent_nric=parental_payload.get("parent_nric"),
                    parent_phone=parental_payload.get("parent_phone"),
                    child_cn=parental_payload.get("child_cn"),
                    child_en=parental_payload.get("child_en"),
                    child_nric=parental_payload.get("child_nric"),
                    child_phone=parental_payload.get("child_phone"),
                    sign_date=datetime.now().date(),
                    sign_json_data=parental_payload.get("sign_json_data"),
                )
            )
            if not member_data.parent_1 and parental_payload.get("parent_cn"):
                member_data.parent_1 = parental_payload.get("parent_cn")
            if not member_data.parent_1_phone and parental_payload.get("parent_phone"):
                member_data.parent_1_phone = parental_payload.get("parent_phone")

        if form not in member.forms:
            form.members.append(member)

        field_config_map = {
            config.id: config for config in (form.extra_field_configs or [])
        }
        for extra_field in data.get("extra_fields", []):
            field_config_id = extra_field.get("field_config_id")
            field_config = field_config_map.get(field_config_id)
            if not field_config:
                continue
            field_value = _coerce_extra_field_value(field_config, extra_field.get("field_value"))
            db.session.add(
                RegisMemberFieldValue(
                    regis_member_data_id=member_data.id,
                    field_config_id=field_config_id,
                    field_value_json=field_value,
                )
            )

        db.session.commit()
        return jsonify({"status": "success", "message": "注册成功"})
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def get_form_detail(form_id):
    form = RegisForm.query.get_or_404(form_id)
    return jsonify({"status": "success", "form": form.to_dict_event()})


def get_payment_quote(form_id, nric):
    if not nric:
        return jsonify({"status": "error", "message": "缺少参数 nric"}), 400

    form = RegisForm.query.get_or_404(form_id)

    try:
        age = _calc_age_from_nric(nric)
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400

    current_form_fees = _sorted_fees_for_form(form)
    current_fee_match = _pick_fee_for_age(current_form_fees, age)
    current_matching_fees = [
        _serialize_fee_candidate(fee, form) for fee in current_form_fees if _fee_matches_age(fee, age)
    ]

    member = NRIC_Asset.query.filter_by(nric=nric).first()
    related_fee_match = None
    related_fee_candidates = []
    related_matching_fees = []

    if member:
        related_forms = sorted(
            list(member.forms or []),
            key=lambda item: (item.created_at or datetime.min, item.id or 0),
            reverse=True,
        )
        for related_form in related_forms:
            for fee in _sorted_fees_for_form(related_form):
                serialized = _serialize_fee_candidate(fee, related_form)
                related_fee_candidates.append(serialized)
                if _fee_matches_age(fee, age):
                    related_matching_fees.append(serialized)
                if related_fee_match is None and _fee_matches_age(fee, age):
                    related_fee_match = serialized

    selected_fee = related_fee_match
    if selected_fee is None and current_fee_match is not None:
        selected_fee = _serialize_fee_candidate(current_fee_match, form)
    if selected_fee is None and related_fee_candidates:
        selected_fee = related_fee_candidates[0]
    if selected_fee is None and current_form_fees:
        selected_fee = _serialize_fee_candidate(current_form_fees[0], form)

    return jsonify(
        {
            "status": "success",
            "nric": nric,
            "age": age,
            "member": member.to_dict() if member else None,
            "selected_fee": selected_fee,
            "current_form_fee": _serialize_fee_candidate(current_fee_match, form) if current_fee_match else None,
            "matching_fees": related_matching_fees + current_matching_fees,
            "related_fee_candidates": related_fee_candidates,
        }
    )


def create_payment(form_id, data, proof_image):
    form = RegisForm.query.get_or_404(form_id)

    nric = str(data.get("nric") or "").strip()
    fee_id = data.get("fee_id")
    payment_mode = str(data.get("payment_mode") or "QR").strip() or "QR"
    if not nric:
        return jsonify({"status": "error", "message": "缺少 nric"}), 400
    if not fee_id:
        return jsonify({"status": "error", "message": "缺少 fee_id"}), 400

    member = NRIC_Asset.query.filter_by(nric=nric).first()
    if not member:
        return jsonify({"status": "error", "message": "未找到该 NRIC 对应的成员"}), 404

    try:
        fee_id = int(fee_id)
    except (TypeError, ValueError):
        return jsonify({"status": "error", "message": "fee_id 无效"}), 400

    fee = RegistrationFee.query.filter_by(id=fee_id, regis_form_id=form.id, fee_scope=FORM_FEE_SCOPE).first()
    if not fee:
        return jsonify({"status": "error", "message": "未找到收费项"}), 404

    latest = member.latest_data()
    if not latest:
        return jsonify({"status": "error", "message": "成员没有可用资料"}), 400

    try:
        proof_image_path = _save_register_payment_proof(proof_image)
        payment = RegisPayment(
            regis_form_id=fee.regis_form_id,
            payment_scope=FORM_FEE_SCOPE,
            nric_asset_id=member.id,
            nric=member.nric,
            name=latest.name_cn or latest.name or member.nric,
            phone=latest.phone or "",
            payment_mode=payment_mode,
            price=fee.amount,
            status="process",
            proof_image_path=proof_image_path,
            created_at=datetime.utcnow(),
            date=datetime.utcnow().date(),
            time=datetime.utcnow().time(),
        )
        db.session.add(payment)
        db.session.commit()
        return jsonify({"status": "success", "message": "付款资料已提交", "payment": payment.to_dict()})
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def get_payment_proof_image(payment_id):
    payment = _get_scoped_regis_payment_or_404(payment_id, FORM_FEE_SCOPE)

    image_path = _resolve_register_payment_proof(payment.proof_image_path)
    if image_path:
        mime_type = mimetypes.guess_type(str(image_path))[0] or "application/octet-stream"
        return send_file(
            image_path,
            mimetype=mime_type,
            download_name=image_path.name,
            conditional=True,
        )

    abort(404, "找不到付款截图")


def update_payment_status(payment_id, data):
    payment = _get_scoped_regis_payment_or_404(payment_id, FORM_FEE_SCOPE)
    status = str(data.get("status") or "").strip()
    allowed_statuses = {"process", "checked", "fail"}

    if status not in allowed_statuses:
        return jsonify({"status": "error", "message": "付款状态无效"}), 400

    try:
        payment.status = status
        if "counter" in data:
            counter = str(data.get("counter") or "").strip()
            payment.counter = counter or None
        db.session.commit()
        return jsonify({"status": "success", "message": "付款状态已更新", "payment": payment.to_dict()})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def replace_payment_proof_image(payment_id, proof_image):
    payment = _get_scoped_regis_payment_or_404(payment_id, FORM_FEE_SCOPE)
    if payment.status != "process":
        return jsonify({"status": "error", "message": "只有处理中的付款记录可以替换截图"}), 400

    old_image_path = payment.proof_image_path
    new_image_path = None

    try:
        new_image_path = _save_register_payment_proof(proof_image)
        payment.proof_image_path = new_image_path
        db.session.commit()
        if old_image_path and old_image_path != new_image_path:
            _delete_register_payment_proof(old_image_path)
        return jsonify({"status": "success", "message": "付款截图已更新", "payment": payment.to_dict()})
    except ValueError as exc:
        db.session.rollback()
        if new_image_path:
            _delete_register_payment_proof(new_image_path)
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        if new_image_path:
            _delete_register_payment_proof(new_image_path)
        return jsonify({"status": "error", "message": str(exc)}), 500


def delete_payment_record(payment_id):
    payment = _get_scoped_regis_payment_or_404(payment_id, FORM_FEE_SCOPE)
    if payment.status != "fail":
        return jsonify({"status": "error", "message": "只有失败的付款记录可以移除"}), 400

    proof_image_path = payment.proof_image_path
    regis_form_id = payment.regis_form_id

    try:
        db.session.delete(payment)
        db.session.commit()
        if proof_image_path:
            _delete_register_payment_proof(proof_image_path)
        return jsonify(
            {
                "status": "success",
                "message": "付款记录已移除",
                "payment_id": payment_id,
                "regis_form_id": regis_form_id,
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def get_all_form():
    try:
        forms = RegisForm.query.order_by(RegisForm.created_at.desc()).all()
        return jsonify({"status": "success", "forms": [form.to_dict_event() for form in forms]})
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


def add_extra_field(form_id, data):
    try:
        form = RegisForm.query.get_or_404(form_id)
        normalized = _normalize_extra_field_config(
            data,
            existing_order=len(form.extra_field_configs or []),
        )

        field = RegisFormExtraFieldConfig(
            regis_form_id=form.id,
            label=normalized["label"],
            field_type=normalized["field_type"],
            options=normalized["options"],
            order=normalized["order"],
            created_at=datetime.utcnow(),
        )
        db.session.add(field)
        db.session.commit()
        emit_form_event(
            form_id,
            "extra_field_add",
            {
                "field": {
                    "id": field.id,
                    "label": field.label,
                    "field_type": field.field_type,
                    "options": field.options,
                    "order": field.order,
                }
            },
        )
        return jsonify(
            {
                "status": "success",
                "message": "字段添加成功",
                "field": {
                    "id": field.id,
                    "label": field.label,
                    "field_type": field.field_type,
                    "options": field.options,
                    "order": field.order,
                },
            }
        )
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def edit_extra_field(field_id, data):
    try:
        field = RegisFormExtraFieldConfig.query.get_or_404(field_id)
        normalized = _normalize_extra_field_config(
            {
                "label": data.get("label", field.label),
                "field_type": data.get("field_type", field.field_type),
                "options": data.get("options", field.options),
                "order": data.get("order", field.order),
            },
            existing_order=field.order or 0,
        )
        for key, value in normalized.items():
            setattr(field, key, value)
        db.session.commit()
        emit_form_event(
            field.regis_form_id,
            "extra_field_edit",
            {
                "field": {
                    "id": field.id,
                    "label": field.label,
                    "field_type": field.field_type,
                    "options": field.options,
                    "order": field.order,
                }
            },
        )
        return jsonify(
            {
                "status": "success",
                "message": "字段修改成功",
                "field": {
                    "id": field.id,
                    "label": field.label,
                    "field_type": field.field_type,
                    "options": field.options,
                    "order": field.order,
                },
            }
        )
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def delete_extra_field(field_id):
    try:
        field = RegisFormExtraFieldConfig.query.get_or_404(field_id)
        form_id = field.regis_form_id
        field_data = {"id": field.id, "label": field.label}
        db.session.delete(field)
        db.session.commit()
        emit_form_event(form_id, "extra_field_delete", {"field": field_data})
        return jsonify({"status": "success", "message": "字段已删除"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def list_extra_fields(form_id):
    try:
        fields = (
            RegisFormExtraFieldConfig.query.filter_by(regis_form_id=form_id)
            .order_by(RegisFormExtraFieldConfig.order.asc())
            .all()
        )
        return jsonify(
            {
                "status": "success",
                "fields": [
                    {
                        "id": field.id,
                        "label": field.label,
                        "field_type": field.field_type,
                        "options": field.options,
                        "order": field.order,
                    }
                    for field in fields
                ],
            }
        )
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


def add_fee(form_id, data):
    try:
        form = RegisForm.query.get_or_404(form_id)
        if not data.get("category") or data.get("amount") is None:
            return jsonify({"status": "error", "message": "类别和金额不能为空"}), 400

        fee = RegistrationFee(
            regis_form_id=form.id,
            fee_scope=FORM_FEE_SCOPE,
            category=data.get("category"),
            age_range_from=data.get("age_range_from"),
            age_range_to=data.get("age_range_to"),
            amount=data.get("amount"),
            description=data.get("description"),
            image_path=data.get("image_path"),
            created_at=datetime.utcnow(),
        )
        db.session.add(fee)
        db.session.commit()
        emit_form_event(form_id, "fee_add", {"fee": fee.to_dict()})
        return jsonify({"status": "success", "message": "收费项添加成功", "fee": fee.to_dict()})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def edit_fee(fee_id, data):
    try:
        fee = RegistrationFee.query.filter_by(id=fee_id, fee_scope=FORM_FEE_SCOPE).first_or_404()
        old_image_path = fee.image_path
        for key in ["category", "age_range_from", "age_range_to", "amount", "description", "image_path"]:
            if key in data:
                setattr(fee, key, data[key])
        if "image_path" in data and old_image_path and old_image_path != fee.image_path:
            _delete_register_fee_image(old_image_path)
        db.session.commit()
        emit_form_event(fee.regis_form_id, "fee_edit", {"fee": fee.to_dict()})
        return jsonify({"status": "success", "message": "收费项修改成功", "fee": fee.to_dict()})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def delete_fee(fee_id):
    try:
        fee = RegistrationFee.query.filter_by(id=fee_id, fee_scope=FORM_FEE_SCOPE).first_or_404()
        form_id = fee.regis_form_id
        fee_data = {"id": fee.id, "category": fee.category, "amount": float(fee.amount)}
        if fee.image_path:
            _delete_register_fee_image(fee.image_path)
        db.session.delete(fee)
        db.session.commit()
        emit_form_event(form_id, "fee_delete", {"fee": fee_data})
        return jsonify({"status": "success", "message": "收费项已删除"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def list_fees(form_id):
    try:
        fees = (
            RegistrationFee.query.filter_by(regis_form_id=form_id, fee_scope=FORM_FEE_SCOPE)
            .order_by(RegistrationFee.created_at.asc())
            .all()
        )
        return jsonify({"status": "success", "fees": [fee.to_dict() for fee in fees]})
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


def upload_fee_image(file_storage):
    try:
        image_path = _save_register_fee_image(file_storage)
        return jsonify({"status": "success", "image_path": image_path})
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


def add_event_to_form(form_id, data):
    try:
        event_id = data.get("event_id")
        if not event_id:
            return jsonify({"status": "error", "message": "缺少 event_id"}), 400

        form = RegisForm.query.get_or_404(form_id)
        event = EventData.query.get_or_404(event_id)
        if event in form.events:
            return jsonify({"status": "error", "message": "该活动已关联"}), 400

        form.events.append(event)
        db.session.commit()
        return jsonify(
            {
                "status": "success",
                "message": f"活动 {event.id} 已关联到表单 {form.id}",
                "form": form.to_dict_event(),
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def remove_event_from_form(form_id, data):
    try:
        event_id = data.get("event_id")
        if not event_id:
            return jsonify({"status": "error", "message": "缺少 event_id"}), 400

        form = RegisForm.query.get_or_404(form_id)
        event = EventData.query.get_or_404(event_id)
        if event not in form.events:
            return jsonify({"status": "error", "message": "该活动未关联"}), 400

        form.events.remove(event)
        db.session.commit()
        return jsonify(
            {
                "status": "success",
                "message": f"活动 {event.id} 已从表单 {form.id} 移除",
                "form": form.to_dict_event(),
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def remove_regis_form_member(data):
    form_id = data.get("form_id")
    member_id = data.get("member_id")
    if not form_id or not member_id:
        return jsonify({"status": "error", "message": "缺少参数 form_id 或 member_id"}), 400

    form = RegisForm.query.get(form_id)
    member = NRIC_Asset.query.get(member_id)
    if not form or not member:
        return jsonify({"status": "error", "message": "未找到对应表单或成员"}), 404
    if member not in form.members:
        return jsonify({"status": "error", "message": "该成员不属于此表单"}), 400

    form.members.remove(member)
    db.session.commit()
    emit_form_event(form_id, "fee_delete")
    return jsonify(
        {"status": "success", "message": f"成员 {member.id} 已从表单 {form.id} 中移除"}
    )


def _normalize_member_nric(value):
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError("NRIC 不能为空")
    return normalized


def _member_merge_target_payload(member):
    latest = member.latest_data()
    display_name = str(
        getattr(latest, "name_cn", None)
        or getattr(latest, "name", None)
        or getattr(member, "name_nric", None)
        or member.nric
        or f"成员 #{member.id}"
    ).strip()
    return {
        "id": member.id,
        "nric": member.nric,
        "display_name": display_name,
    }


def _member_nric_change_impact(member, target_member=None):
    data_ids = [item.id for item in member.datas]
    parental_query = RegisParentalData.query.filter(False)
    if data_ids:
        parental_query = RegisParentalData.query.filter(
            RegisParentalData.regis_member_data_id.in_(data_ids),
            RegisParentalData.child_nric == member.nric,
        )

    form_ids = sorted({form.id for form in member.forms})
    target_form_ids = sorted({form.id for form in (target_member.forms if target_member else [])})
    duplicate_form_ids = sorted(set(form_ids) & set(target_form_ids))
    merged_form_ids = sorted(set(form_ids) | set(target_form_ids))

    return {
        "registration_count": len(form_ids),
        "form_ids": form_ids,
        "version_count": len(data_ids),
        "payment_count": RegisPayment.query.filter_by(nric_asset_id=member.id).count(),
        "user_link_count": User.query.filter_by(nric_asset_id=member.id).count(),
        "youth_registration_count": YouthClassRegistration.query.filter_by(nric_asset_id=member.id).count(),
        "parental_reference_count": parental_query.count(),
        "duplicate_registration_count": len(duplicate_form_ids),
        "duplicate_form_ids": duplicate_form_ids,
        "merged_registration_count": len(merged_form_ids),
        "merged_form_ids": merged_form_ids,
    }


def _apply_member_nric_change(member, new_nric):
    old_nric = str(member.nric or "").strip()
    normalized_nric = _normalize_member_nric(new_nric)
    if normalized_nric == old_nric:
        return {
            "updated_target": "NRIC_Asset",
            "member_id": member.id,
            "value": normalized_nric,
            "event_form_ids": set(),
            "response_payload": {
                "mode": "noop",
                "impact": {
                    "registration_count": 0,
                    "form_ids": [],
                    "version_count": 0,
                    "payment_count": 0,
                    "user_link_count": 0,
                    "youth_registration_count": 0,
                    "parental_reference_count": 0,
                    "duplicate_registration_count": 0,
                    "duplicate_form_ids": [],
                    "merged_registration_count": 0,
                    "merged_form_ids": [],
                },
            },
        }

    existing = NRIC_Asset.query.filter(
        NRIC_Asset.nric == normalized_nric,
        NRIC_Asset.id != member.id,
    ).first()
    impact = _member_nric_change_impact(member, existing)
    data_ids = [item.id for item in member.datas]

    if existing:
        source_form_ids = {item.id for item in member.forms}
        target_form_ids = {item.id for item in existing.forms}
        event_form_ids = source_form_ids | target_form_ids
        source_member_id = member.id

        for data_row in list(member.datas):
            data_row.member = existing

        for form in list(member.forms):
            if form not in existing.forms:
                existing.forms.append(form)

        payment_updates = RegisPayment.query.filter_by(nric_asset_id=member.id).update(
            {
                RegisPayment.nric_asset_id: existing.id,
                RegisPayment.nric: normalized_nric,
            },
            synchronize_session=False,
        )
        user_link_updates = User.query.filter_by(nric_asset_id=member.id).update(
            {User.nric_asset_id: existing.id},
            synchronize_session=False,
        )
        youth_registration_updates = YouthClassRegistration.query.filter_by(nric_asset_id=member.id).update(
            {YouthClassRegistration.nric_asset_id: existing.id},
            synchronize_session=False,
        )
        parental_updates = 0
        if data_ids:
            parental_updates = RegisParentalData.query.filter(
                RegisParentalData.regis_member_data_id.in_(data_ids),
                RegisParentalData.child_nric == old_nric,
            ).update(
                {RegisParentalData.child_nric: normalized_nric},
                synchronize_session=False,
            )
        db.session.flush()
        db.session.delete(member)

        return {
            "updated_target": "NRIC_AssetMerge",
            "member_id": existing.id,
            "value": normalized_nric,
            "event_form_ids": event_form_ids,
            "response_payload": {
                "mode": "merge",
                "impact": {
                    **impact,
                    "payment_count": payment_updates,
                    "user_link_count": user_link_updates,
                    "youth_registration_count": youth_registration_updates,
                    "parental_reference_count": parental_updates,
                },
                "merge_target": _member_merge_target_payload(existing),
                "source_member_id": source_member_id,
                "target_member_id": existing.id,
            },
        }

    member.nric = normalized_nric
    payment_updates = RegisPayment.query.filter_by(nric_asset_id=member.id).update(
        {RegisPayment.nric: normalized_nric},
        synchronize_session=False,
    )
    parental_updates = 0
    if data_ids:
        parental_updates = RegisParentalData.query.filter(
            RegisParentalData.regis_member_data_id.in_(data_ids),
            RegisParentalData.child_nric == old_nric,
        ).update(
            {RegisParentalData.child_nric: normalized_nric},
            synchronize_session=False,
        )
    db.session.flush()
    return {
        "updated_target": "NRIC_Asset",
        "member_id": member.id,
        "value": normalized_nric,
        "event_form_ids": {item.id for item in member.forms},
        "response_payload": {
            "mode": "update",
            "impact": {
                **impact,
                "payment_count": payment_updates,
                "user_link_count": User.query.filter_by(nric_asset_id=member.id).count(),
                "parental_reference_count": parental_updates,
            },
        },
    }


def preview_member_nric_change(data):
    member_id = data.get("member_id")
    new_nric = data.get("new_nric")
    if not member_id:
        return jsonify({"status": "error", "message": "缺少参数 member_id"}), 400

    member = NRIC_Asset.query.get(member_id)
    if not member:
        return jsonify({"status": "error", "message": "未找到该成员"}), 404

    try:
        normalized_nric = _normalize_member_nric(new_nric)
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400

    existing = NRIC_Asset.query.filter(
        NRIC_Asset.nric == normalized_nric,
        NRIC_Asset.id != member.id,
    ).first()

    impact = _member_nric_change_impact(member, existing)
    if normalized_nric == member.nric:
        mode = "noop"
        message = "NRIC 没有变化，不会影响任何报名数据"
    elif existing:
        mode = "merge"
        message = (
            f"NRIC {normalized_nric} 已在成员 #{existing.id} 使用，"
            f"将视为同一人并合并 {impact['registration_count']} 条报名数据"
        )
    else:
        mode = "update"
        message = f"本次修改将影响 {impact['registration_count']} 条报名数据"

    return jsonify(
        {
            "status": "success",
            "member_id": member.id,
            "old_nric": member.nric,
            "new_nric": normalized_nric,
            "mode": mode,
            "impact": impact,
            "message": message,
            "merge_target": _member_merge_target_payload(existing) if existing else None,
        }
    )


def edit_member(data):
    member_id = data.get("member_id")
    field = data.get("field")
    value = data.get("value")
    form_id = data.get("form_id")
    if not member_id or not field:
        return jsonify({"status": "error", "message": "缺少参数 member_id 或 field"}), 400

    member = NRIC_Asset.query.get(member_id)
    if not member:
        return jsonify({"status": "error", "message": "未找到该成员"}), 404

    latest = member.latest_data()
    if not latest:
        return jsonify({"status": "error", "message": "该成员没有资料版本"}), 404

    try:
        updated_target = None
        event_form_ids = set()
        response_payload = {}

        if field == "nric":
            nric_change = _apply_member_nric_change(member, value)
            updated_target = nric_change["updated_target"]
            member_id = nric_change["member_id"]
            value = nric_change["value"]
            event_form_ids = nric_change["event_form_ids"]
            response_payload.update(nric_change["response_payload"])
            db.session.commit()
        elif field == "parental_data":
            parental = _upsert_parental_data(latest, value)
            db.session.commit()
            updated_target = "RegisParentalData"
            value = parental.to_dict()
            response_payload["parental_data"] = value
        elif isinstance(field, str) and hasattr(latest, field):
            setattr(latest, field, value)
            db.session.commit()
            updated_target = "RegisMemberData"
        else:
            field_query = RegisFormExtraFieldConfig.query
            if form_id:
                field_query = field_query.filter_by(regis_form_id=form_id)

            field_id = None
            if isinstance(field, int):
                field_id = field
            elif isinstance(field, str) and field.isdigit():
                field_id = int(field)

            if field_id is None:
                return jsonify({"status": "error", "message": "扩展字段只能通过 field_config_id 更新"}), 400

            field_config = field_query.filter(RegisFormExtraFieldConfig.id == field_id).first()

            if field_config:
                field_value = RegisMemberFieldValue.query.filter_by(
                    regis_member_data_id=latest.id,
                    field_config_id=field_config.id,
                ).first()
                normalized_value = _coerce_extra_field_value(field_config, value)
                if field_value:
                    field_value.field_value_json = normalized_value
                else:
                    db.session.add(
                        RegisMemberFieldValue(
                            regis_member_data_id=latest.id,
                            field_config_id=field_config.id,
                            field_value_json=normalized_value,
                        )
                    )
                db.session.commit()
                updated_target = "RegisMemberFieldValue"

        if updated_target:
            if form_id:
                event_form_ids.add(form_id)
            for affected_form_id in sorted(event_form_ids):
                emit_form_event(
                    affected_form_id,
                    "member_edit",
                    {
                        "member_id": member_id,
                        "field": field,
                        "value": value,
                    },
                )

        if updated_target:
            success_message = f"{updated_target} 的字段 {field} 已更新"
            if updated_target == "NRIC_AssetMerge":
                merge_target = response_payload.get("merge_target") or {}
                success_message = (
                    f"成员 #{response_payload.get('source_member_id')} 已合并到成员 "
                    f"#{merge_target.get('id')}"
                )
            elif updated_target == "NRIC_Asset" and response_payload.get("mode") == "noop":
                success_message = "NRIC 没有变化，无需更新"
            return jsonify(
                {
                    "status": "success",
                    "message": success_message,
                    "target": updated_target,
                    **response_payload,
                }
            )
        return jsonify({"status": "error", "message": f"未找到字段: {field}"}), 400
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def get_nric_detail(nric):
    if not nric:
        return jsonify({"status": "error", "message": "缺少参数 nric"}), 400

    member = NRIC_Asset.query.filter_by(nric=nric).first()
    if not member:
        return jsonify({"status": "error", "message": "未找到该 NRIC 对应的成员"}), 404

    datas = (
        RegisMemberData.query.filter_by(member_id=member.id)
        .order_by(RegisMemberData.edit_at.desc())
        .all()
    )
    return jsonify(
        {
            "status": "success",
            "nric": member.nric,
            "member_id": member.id,
            "total_versions": len(datas),
            "datas": [item.to_dict() for item in datas],
        }
    )


def edit_form(form_id, data):
    form = RegisForm.query.get_or_404(form_id)
    try:
        if "title" in data:
            form.title = (data.get("title") or "").strip()
        if "detail" in data:
            form.detail = data.get("detail") or ""
        if "expired" in data:
            expired = data.get("expired")
            if expired:
                try:
                    form.expired = datetime.strptime(expired, "%Y-%m-%d").date()
                except Exception:
                    return jsonify({"status": "error", "message": "expired 格式需为 YYYY-MM-DD"}), 400

        switches = _extract_field_switches(data)

        for key in ["email", "parental_form", "address", "medical", "allergy", "other_remark"]:
            if key in switches:
                setattr(form, key, switches[key])

        if "parent_1" in switches:
            form.parent_1 = switches["parent_1"]
            form.parent_1_phone = form.parent_1
        elif "parent_1_phone" in switches:
            form.parent_1_phone = switches["parent_1_phone"]
            form.parent_1 = form.parent_1_phone

        if "parent_2" in switches:
            form.parent_2 = switches["parent_2"]
            form.parent_2_phone = form.parent_2
        elif "parent_2_phone" in switches:
            form.parent_2_phone = switches["parent_2_phone"]
            form.parent_2 = form.parent_2_phone

        db.session.commit()
        return jsonify({"status": "success", "message": "编辑成功", "form_id": form.id})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def html_to_pdf():
    return merge_html_files_to_pdf(
        request.files.getlist("files"),
        request.form.get("filename"),
    )


def _sync_youth_registration_status(entry):
    if not entry:
        return False

    original_status = entry.status
    payment = _get_latest_youth_payment(entry)

    # 维护「当前付款」指针，但状态判定统一交给模型的 sync_status_from_payment（含 paid 守卫）：
    # checked 只代表财政通过，必须再配合理事会签名（_maybe_activate_youth）才会置为 paid。
    if payment:
        if entry.regis_payment_id != payment.id:
            entry.regis_payment_id = payment.id
    else:
        if entry.regis_payment_id is not None:
            entry.regis_payment_id = None

    entry.sync_status_from_payment()
    return entry.status != original_status


def get_youth_class_payment_settings():
    return jsonify(
        {
            "status": "success",
            "settings": _serialize_long_term_payment_settings(fee_scope=YOUTH_CLASS_FEE_SCOPE),
        }
    )


def update_youth_class_payment_settings(data):
    try:
        fee_rows, old_fee_image_paths = _replace_scoped_registration_fees(
            YOUTH_CLASS_FEE_SCOPE,
            data.get("fees") if data.get("fees") is not None else data.get("fee_options"),
        )

        db.session.commit()

        new_fee_image_paths = _collect_long_term_fee_images(fee_rows)
        for removed_path in old_fee_image_paths - new_fee_image_paths:
            _delete_register_fee_image(removed_path)

        return jsonify(
            {
                "status": "success",
                "message": "报名费选项已更新",
                "settings": _serialize_long_term_payment_settings(fee_scope=YOUTH_CLASS_FEE_SCOPE, fee_source=fee_rows),
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def submit_youth_class_registration(payload):
    chinese_name = str(payload.get("chinese_name") or "").strip()
    english_name = str(payload.get("english_name") or "").strip()
    nric = str(payload.get("nric") or "").strip()
    address = str(payload.get("address") or "").strip()
    gender = str(payload.get("gender") or "").strip()
    phone = str(payload.get("phone") or "").strip()
    emergency_contact_name = str(payload.get("emergency_contact_name") or "").strip()
    emergency_contact_phone = str(payload.get("emergency_contact_phone") or "").strip()
    emergency_contact_relation = str(payload.get("emergency_contact_relation") or "").strip()

    if not chinese_name:
        return jsonify({"status": "error", "message": "请填写中文名"}), 400
    if not english_name:
        return jsonify({"status": "error", "message": "请填写英文名"}), 400
    if not nric:
        return jsonify({"status": "error", "message": "请填写 NRIC"}), 400
    if not address:
        return jsonify({"status": "error", "message": "请填写住家地址"}), 400
    if gender not in {"男", "女"}:
        return jsonify({"status": "error", "message": "请选择性别"}), 400
    if not phone:
        return jsonify({"status": "error", "message": "请填写手机号码"}), 400
    if not emergency_contact_name or not emergency_contact_phone or not emergency_contact_relation:
        return jsonify({"status": "error", "message": "请完整填写紧急联络人资料"}), 400

    try:
        age = _calc_age_from_nric(nric)
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400

    category, eligible = _youth_class_category_from_age(age)
    if not eligible:
        return jsonify({"status": "error", "message": f"年龄 {age} 岁，不符合青少年佛学班报名资格"}), 400

    try:
        member = _get_or_create_member_by_nric(nric, name_nric=english_name)
        entry = YouthClassRegistration(
            chinese_name=chinese_name,
            english_name=english_name,
            nric_asset_id=member.id,
            age=age,
            category=category,
            address=address,
            gender=gender,
            phone=phone,
            emergency_contact_name=emergency_contact_name,
            emergency_contact_phone=emergency_contact_phone,
            emergency_contact_relation=emergency_contact_relation,
            payment_token=_generate_youth_payment_token(),
            status="process",
        )
        _sync_youth_registration_status(entry)
        db.session.add(entry)
        db.session.commit()
        fee_rows = _list_scoped_registration_fees(YOUTH_CLASS_FEE_SCOPE)
        settings = _serialize_long_term_payment_settings(age=age, fee_scope=YOUTH_CLASS_FEE_SCOPE, fee_source=fee_rows)
        payment_url = _build_youth_payment_public_url(entry)
        payment_required = bool(settings.get("payment_enabled"))
        return jsonify(
            {
                "status": "success",
                "entry": _serialize_youth_entry(entry, fee_source=fee_rows),
                "payment_url": payment_url,
                "payment_required": payment_required,
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def get_youth_class_registrations():
    try:
        fee_rows = _list_scoped_registration_fees(YOUTH_CLASS_FEE_SCOPE)
        entries = (
            YouthClassRegistration.query.filter(YouthClassRegistration.status != "remove")
            .order_by(YouthClassRegistration.submitted_at.desc(), YouthClassRegistration.id.desc())
            .all()
        )
        changed = False
        for entry in entries:
            changed = _sync_youth_registration_status(entry) or changed
        if changed:
            db.session.commit()
        return jsonify({"status": "success", "entries": [_serialize_youth_entry(entry, fee_source=fee_rows) for entry in entries]})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def remove_youth_class_registration(entry_id):
    entry = YouthClassRegistration.query.get(entry_id)
    if not entry:
        return jsonify({"status": "error", "message": "报名记录不存在"}), 404
    if entry.status == "paid":
        return jsonify({"status": "error", "message": "该报名已经生效，无法移除。"}), 400
    try:
        entry.status = "remove"
        db.session.commit()
        return jsonify({"status": "success", "message": "报名已移除。"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def upgrade_youth_to_membership(entry_id):
    entry = YouthClassRegistration.query.get(entry_id)
    if not entry:
        return jsonify({"status": "error", "message": "报名记录不存在"}), 404
    if entry.status != "paid":
        return jsonify({"status": "error", "message": "只有已生效的报名才能升级为会员。"}), 400

    member = entry.nric_asset
    if member is None:
        return jsonify({"status": "error", "message": "该报名没有绑定成员资料，无法升级。"}), 400

    existing = (
        MembershipRegistration.query.filter_by(nric_asset_id=member.id, registration_type="upgrade")
        .filter(MembershipRegistration.status != "remove")
        .order_by(MembershipRegistration.id.desc())
        .first()
    )
    if existing is not None:
        return jsonify({"status": "error", "message": "该学员已有一份会员申请，请到会员工作台处理。"}), 400

    try:
        if not str(getattr(member, "name_nric", None) or "").strip():
            member.name_nric = entry.chinese_name or entry.english_name

        registration = MembershipRegistration(
            registration_type="upgrade",
            user_id=None,
            nric_asset_id=member.id,
            status="process",
            english_name=entry.english_name,
            phone=entry.phone,
            gender=entry.gender if entry.gender in ("男", "女") else None,
            nric_address=entry.address,
            emergency_contact_name=entry.emergency_contact_name,
            emergency_contact_phone=entry.emergency_contact_phone,
        )
        db.session.add(registration)
        db.session.commit()
        return jsonify(
            {
                "status": "success",
                "message": "已创建会员申请，请到会员工作台继续走财政 + 理事会审批。",
                "membership_registration_id": registration.id,
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def update_youth_class_registration_status(entry_id, data):
    entry = YouthClassRegistration.query.get_or_404(entry_id)
    status = str(data.get("status") or "").strip()
    allowed_statuses = {"paid", "process", "reject"}

    if status not in allowed_statuses:
        return jsonify({"status": "error", "message": "报名状态无效"}), 400

    try:
        entry.status = status
        db.session.commit()
        return jsonify({"status": "success", "message": "报名状态已更新", "entry": _serialize_youth_entry(entry)})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def get_youth_class_payment_context(token):
    token = str(token or "").strip()
    if not token:
        return jsonify({"status": "error", "message": "缺少付款 token"}), 400

    entry = YouthClassRegistration.query.filter_by(payment_token=token).first()
    if not entry:
        return jsonify({"status": "error", "message": "付款链接无效"}), 404

    try:
        changed = _sync_youth_registration_status(entry)
        if changed:
            db.session.commit()
    except Exception:
        db.session.rollback()

    latest_payment = _get_latest_youth_payment(entry)
    settings = _serialize_long_term_payment_settings(age=entry.age, fee_scope=YOUTH_CLASS_FEE_SCOPE)
    payment_enabled = bool(settings.get("payment_enabled"))
    can_submit = payment_enabled and not (latest_payment and latest_payment.status == "checked")

    registration = {
        "id": entry.id,
        "submitted_at": entry.submitted_at.strftime("%Y-%m-%d %H:%M:%S") if entry.submitted_at else None,
        "chinese_name": entry.chinese_name,
        "english_name": entry.english_name,
        "age": entry.age,
        "category": entry.category,
        "status": entry.status,
        "phone": entry.phone,
        "payment_url": _build_youth_payment_public_url(entry),
    }

    return jsonify(
        {
            "status": "success",
            "registration": registration,
            "settings": settings,
            "latest_payment": latest_payment.to_dict() if latest_payment else None,
            "can_submit": can_submit,
        }
    )


def submit_youth_class_payment(token, data, proof_image):
    token = str(token or "").strip()
    if not token:
        return jsonify({"status": "error", "message": "缺少付款 token"}), 400

    entry = YouthClassRegistration.query.filter_by(payment_token=token).first()
    if not entry:
        return jsonify({"status": "error", "message": "付款链接无效"}), 404

    settings = _serialize_long_term_payment_settings(age=entry.age, fee_scope=YOUTH_CLASS_FEE_SCOPE)
    selected_fee = settings.get("selected_fee")
    amount = Decimal(str(settings.get("amount") or 0))
    if not selected_fee or amount <= 0:
        return jsonify({"status": "error", "message": "当前没有适合你年龄的报名费选项，请联系管理员"}), 400

    latest_payment = _get_latest_youth_payment(entry)
    if latest_payment and latest_payment.status == "checked":
        return jsonify({"status": "error", "message": "系统显示你已完成付款，无需重复提交"}), 400

    payment_mode = str(data.get("payment_mode") or "QR").strip() or "QR"

    try:
        proof_image_path = _save_register_payment_proof(proof_image)
        payment = RegisPayment(
            regis_form_id=None,
            payment_scope=YOUTH_CLASS_FEE_SCOPE,
            youth_class_registration_id=entry.id,
            nric_asset_id=entry.nric_asset_id,
            nric=str(getattr(entry.member, "nric", None) or ""),
            name=entry.chinese_name or entry.english_name or str(getattr(entry.member, "name_nric", None) or ""),
            phone=entry.phone or "",
            payment_mode=payment_mode,
            price=amount,
            status="process",
            proof_image_path=proof_image_path,
            created_at=datetime.utcnow(),
            date=datetime.utcnow().date(),
            time=datetime.utcnow().time(),
        )
        db.session.add(payment)
        db.session.flush()
        entry.regis_payment_id = payment.id
        entry.status = "process"
        db.session.commit()
        payment_data = payment.to_dict()
        entry_data = _serialize_youth_entry(entry)
        emit_youth_class_event(
            "youth_class_payment_submitted",
            {
                "entry_id": entry.id,
                "payment_id": payment.id,
                "entry": entry_data,
                "payment": payment_data,
                "message": f"{entry.chinese_name or entry.english_name or '学员'} 已提交青少年佛学班付款截图",
            },
        )
        return jsonify(
            {
                "status": "success",
                "message": "付款资料已提交，请等待审核",
                "payment": payment_data,
                "entry": entry_data,
                "redirect_url": "/",
            }
        )
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def get_youth_class_payment_proof_image(payment_id):
    payment = _get_scoped_regis_payment_or_404(payment_id, YOUTH_CLASS_FEE_SCOPE)
    image_path = _resolve_register_payment_proof(payment.proof_image_path)
    if not image_path:
        abort(404, "找不到付款截图")

    mime_type = mimetypes.guess_type(str(image_path))[0] or "application/octet-stream"
    return send_file(
        image_path,
        mimetype=mime_type,
        download_name=image_path.name,
        conditional=True,
    )


def update_youth_class_payment_status(payment_id, data):
    payment = _get_scoped_regis_payment_or_404(payment_id, YOUTH_CLASS_FEE_SCOPE)
    status = str(data.get("status") or "").strip()
    allowed_statuses = {"process", "checked", "fail"}

    if status not in allowed_statuses:
        return jsonify({"status": "error", "message": "付款状态无效"}), 400

    try:
        payment.status = status
        if "counter" in data:
            counter = str(data.get("counter") or "").strip()
            payment.counter = counter or None

        entry = payment.youth_class_registration
        if entry and entry.regis_payment_id != payment.id:
            entry.regis_payment_id = payment.id
        _sync_youth_registration_status(entry)
        _maybe_activate_youth(entry)
        db.session.commit()
        return jsonify(
            {
                "status": "success",
                "message": "付款状态已更新",
                "payment": payment.to_dict(),
                "entry": _serialize_youth_entry(entry),
            }
        )
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def _youth_class_category_from_age(age):
    if 13 <= age <= 17:
        return "青少年", True
    return "不符合资格", False


def get_youth_class_nric_check(nric):
    try:
        age = _calc_age_from_nric(nric)
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400

    category, eligible = _youth_class_category_from_age(age)
    return jsonify({"status": "success", "age": age, "category": category, "eligible": eligible})
