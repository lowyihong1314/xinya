import base64
import os
import secrets
from datetime import datetime

from flask import abort, jsonify, render_template, request, send_file
from flask_login import current_user
from werkzeug.utils import secure_filename

from app.paths import DATA_ROOT, PROJECT_ROOT, STATIC_ROOT
from app.redis_client import redis_client
from .pdf import merge_html_files_to_pdf
from .realtime import emit_form_event
from models.form import (
    RegistrationFee,
    RegisForm,
    RegisFormExtraFieldConfig,
    RegisMember,
    RegisMemberData,
    RegisMemberFieldValue,
    RegisPayment,
    RegisParentalData,
)
from models.user_data import db
from models.event_data import AlbumFiles, EventData
from models.youth_class_registration import YouthClassRegistration

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
    "medical",
    "allergy",
    "address",
]

ALLOWED_FEE_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".heic", ".heif"}
REGISTER_FEE_IMAGE_DIR = STATIC_ROOT / "images" / "register_fee_image"
REGISTER_PAYMENT_PROOF_DIR = STATIC_ROOT / "images" / "register_payment_proof"


def form_index_response(form_id):
    form = RegisForm.query.get_or_404(form_id)
    custom_tpl = f"form/custom_template/{form_id}.html"
    tpl_path = os.path.join(PROJECT_ROOT, "templates", custom_tpl)
    form_data = form.to_dict_event(is_public=True)

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
        list(form.fees or []),
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

    original_name = secure_filename(file_storage.filename or "")
    extension = os.path.splitext(original_name)[1].lower()
    if extension not in ALLOWED_FEE_IMAGE_EXTENSIONS:
        raise ValueError("付款截图仅支持 PNG、JPG、JPEG、HEIC 图片")

    REGISTER_PAYMENT_PROOF_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(8)}{extension}"
    target_path = REGISTER_PAYMENT_PROOF_DIR / filename
    file_storage.save(target_path)
    return f"/static/images/register_payment_proof/{filename}"


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
            medical=field_switches.get("medical", data.get("medical", False)),
            allergy=field_switches.get("allergy", data.get("allergy", False)),
            address=field_switches.get("address", data.get("address", False)),
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


def register_member(form_id, data):
    form = RegisForm.query.get_or_404(form_id)
    for field in ["name", "name_cn", "nric", "phone", "gender"]:
        if not data.get(field):
            return jsonify({"status": "error", "message": f"缺少字段: {field}"}), 400

    try:
        member = RegisMember.query.filter_by(nric=data["nric"]).first()
        if not member:
            member = RegisMember(nric=data["nric"])
            db.session.add(member)
            db.session.flush()

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

    member = RegisMember.query.filter_by(nric=nric).first()
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

    member = RegisMember.query.filter_by(nric=nric).first()
    if not member:
        return jsonify({"status": "error", "message": "未找到该 NRIC 对应的成员"}), 404

    try:
        fee_id = int(fee_id)
    except (TypeError, ValueError):
        return jsonify({"status": "error", "message": "fee_id 无效"}), 400

    fee = RegistrationFee.query.filter_by(id=fee_id, regis_form_id=form.id).first()
    if not fee:
        fee = RegistrationFee.query.get(fee_id)
    if not fee:
        return jsonify({"status": "error", "message": "未找到收费项"}), 404

    latest = member.latest_data()
    if not latest:
        return jsonify({"status": "error", "message": "成员没有可用资料"}), 400

    try:
        proof_image_path = _save_register_payment_proof(proof_image)
        payment = RegisPayment(
            regis_form_id=fee.regis_form_id,
            nric=member.nric,
            name=latest.name_cn or latest.name or member.nric,
            phone=latest.phone or "",
            payment_mode=payment_mode,
            price=fee.amount,
            status="process",
            proof_image_path=proof_image_path,
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


def update_payment_status(payment_id, data):
    payment = RegisPayment.query.get_or_404(payment_id)
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
        fee = RegistrationFee.query.get_or_404(fee_id)
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
        fee = RegistrationFee.query.get_or_404(fee_id)
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
            RegistrationFee.query.filter_by(regis_form_id=form_id)
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
    member = RegisMember.query.get(member_id)
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


def edit_member(data):
    member_id = data.get("member_id")
    field = data.get("field")
    value = data.get("value")
    form_id = data.get("form_id")
    if not member_id or not field:
        return jsonify({"status": "error", "message": "缺少参数 member_id 或 field"}), 400

    member = RegisMember.query.get(member_id)
    if not member:
        return jsonify({"status": "error", "message": "未找到该成员"}), 404

    latest = member.latest_data()
    if not latest:
        return jsonify({"status": "error", "message": "该成员没有资料版本"}), 404

    try:
        updated_target = None
        if hasattr(latest, field):
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

        if form_id and updated_target:
            emit_form_event(
                form_id,
                "member_edit",
                {
                    "member_id": member_id,
                    "field": field,
                    "value": value,
                },
            )

        if updated_target:
            return jsonify(
                {
                    "status": "success",
                    "message": f"{updated_target} 的字段 {field} 已更新",
                    "target": updated_target,
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

    member = RegisMember.query.filter_by(nric=nric).first()
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

        for key in ["email", "parental_form", "medical", "allergy", "address"]:
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
    return merge_html_files_to_pdf(request.files.getlist("files"))


def _sync_youth_registration_status(entry):
    if not entry:
        return entry

    payment = entry.payment
    if payment is None:
        payment = (
            RegisPayment.query.filter_by(nric=entry.nric)
            .order_by(RegisPayment.id.desc())
            .first()
        )
        if payment and entry.regis_payment_id != payment.id:
            entry.regis_payment_id = payment.id
            entry.payment = payment

    original_status = entry.status
    entry.sync_status_from_payment()
    return entry.status != original_status


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
        return jsonify({"status": "error", "message": f"年龄 {age} 岁，不符合青少年/青年佛学班报名资格"}), 400

    try:
        entry = YouthClassRegistration(
            chinese_name=chinese_name,
            english_name=english_name,
            nric=nric,
            age=age,
            category=category,
            address=address,
            gender=gender,
            phone=phone,
            emergency_contact_name=emergency_contact_name,
            emergency_contact_phone=emergency_contact_phone,
            emergency_contact_relation=emergency_contact_relation,
            status="process",
        )
        _sync_youth_registration_status(entry)
        db.session.add(entry)
        db.session.commit()
        return jsonify({"status": "success", "entry": entry.to_dict()})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def get_youth_class_registrations():
    try:
        entries = (
            YouthClassRegistration.query.order_by(YouthClassRegistration.submitted_at.desc(), YouthClassRegistration.id.desc())
            .all()
        )
        changed = False
        for entry in entries:
            changed = _sync_youth_registration_status(entry) or changed
        if changed:
            db.session.commit()
        return jsonify({"status": "success", "entries": [entry.to_dict() for entry in entries]})
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
        return jsonify({"status": "success", "message": "报名状态已更新", "entry": entry.to_dict()})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def _youth_class_category_from_age(age):
    if 13 <= age <= 17:
        return "青少年", True
    if 18 <= age <= 40:
        return "青年", True
    return "不符合资格", False


def get_youth_class_nric_check(nric):
    try:
        age = _calc_age_from_nric(nric)
    except ValueError as exc:
        return jsonify({"status": "error", "message": str(exc)}), 400

    category, eligible = _youth_class_category_from_age(age)
    return jsonify({"status": "success", "age": age, "category": category, "eligible": eligible})
