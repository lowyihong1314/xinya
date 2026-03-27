import json
import mimetypes
import os
import uuid
from datetime import datetime
from urllib.parse import urlsplit

from flask import request

from app.account.exceptions import NotFound, PermissionDenied, ValidationError
from app.account.permissions import resolve_user_permissions, user_can_manage_claims
from app.account.serializers import serialize_request_data
from app.paths import DATA_ROOT
from models import db
from models.event_data import EventData
from models.finance import (
    ReimbursementApproverData,
    ReimbursementAttachment,
    ReimbursementRequest,
)


def _get_claim_or_raise(request_id):
    request_obj = ReimbursementRequest.query.get(request_id)
    if not request_obj:
        raise NotFound("找不到申请")
    return request_obj


def _guess_extension(file_name, mime_type):
    extension = os.path.splitext(file_name or "")[1].strip()
    if extension:
        return extension

    guessed = mimetypes.guess_extension((mime_type or "").split(";")[0].strip(), strict=False)
    if guessed == ".jpe":
        return ".jpg"
    return guessed or ""


def _normalize_attachment_name(raw_name, mime_type):
    cleaned = os.path.basename((raw_name or "").replace("\\", "/")).strip()
    cleaned = "".join(char for char in cleaned if char >= " " and char != "\x7f")
    if not cleaned:
        cleaned = "attachment"

    extension = _guess_extension(cleaned, mime_type)
    stem, current_extension = os.path.splitext(cleaned)
    if current_extension:
        return cleaned, current_extension

    stem = stem or cleaned or "attachment"
    return f"{stem}{extension}", extension


def _parse_json_text(raw_value, field_name):
    try:
        return json.loads(raw_value)
    except Exception as exc:
        raise ValidationError(f"{field_name} 必须是合法 JSON") from exc


def _normalize_sign_json(sign_value, field_name="sign_json_data"):
    if sign_value is None:
        raise ValidationError(f"缺少 {field_name}")

    if isinstance(sign_value, str):
        sign_obj = _parse_json_text(sign_value, field_name)
    elif isinstance(sign_value, dict):
        sign_obj = sign_value
    else:
        raise ValidationError(f"{field_name} 格式错误")

    strokes = sign_obj.get("strokes")
    if not isinstance(strokes, list) or not any(
        isinstance(stroke, dict) and isinstance(stroke.get("points"), list) and len(stroke.get("points") or []) >= 2
        for stroke in strokes
    ):
        raise ValidationError("签名不能为空")

    return json.dumps(sign_obj, ensure_ascii=False)


def _require_payment_voucher_access(request_obj, user):
    permissions = resolve_user_permissions(user)
    can_account = "account" in permissions
    is_approved_by_me = any(
        approver.user_id == user.id and approver.reject is False
        for approver in (request_obj.approver_data or [])
    )
    if not (can_account or is_approved_by_me):
        raise PermissionDenied("没有权限访问 Payment Voucher")


def _get_claim_by_public_token_or_raise(token):
    token = str(token or "").strip()
    if not token:
        raise NotFound("链接无效")

    request_obj = ReimbursementRequest.query.filter_by(public_token=token).first()
    if not request_obj:
        raise NotFound("找不到 Payment Voucher")
    return request_obj


def _ensure_claim_approved_for_voucher(request_obj):
    latest = serialize_request_data(request_obj, with_children=True)
    approver_list = latest.get("approver_data") or []
    has_approval = any(approver.get("reject") is False for approver in approver_list)
    if not has_approval:
        raise ValidationError("该申请尚未批准，暂时不能生成 Payment Voucher")
    return latest, approver_list


def _payment_voucher_public_url(token):
    parsed = urlsplit(request.host_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    return f"{origin}/#/payment-voucher-sign/{token}"


def create_claim_from_form(form, files, current_user=None):
    applicant_name = form.get("applicant_name")
    request_date_raw = form.get("request_date")
    amount_raw = form.get("amount")
    department_id_raw = form.get("department_id")
    purpose = form.get("purpose")
    event_id_raw = form.get("event_id")
    sign_json_data_raw = form.get("sign_json_data")

    if not all(
        [
            applicant_name,
            request_date_raw,
            amount_raw,
            department_id_raw,
            purpose,
            sign_json_data_raw,
        ]
    ):
        raise ValidationError("缺少必要字段")

    sign_json_data = _normalize_sign_json(sign_json_data_raw)

    try:
        request_date = datetime.strptime(request_date_raw, "%Y-%m-%d").date()
        amount = float(amount_raw)
        department_id = int(department_id_raw)
        event_id = int(event_id_raw) if event_id_raw else None
    except Exception as exc:
        raise ValidationError("数据格式错误") from exc

    request_obj = ReimbursementRequest(
        applicant_user_id=getattr(current_user, "id", None),
        applicant_name=applicant_name,
        request_date=request_date,
        amount=amount,
        department_id=department_id,
        purpose=purpose,
        public_token=uuid.uuid4().hex,
        event_id=event_id,
        sign_json_data=sign_json_data,
        status="submitted",
    )
    db.session.add(request_obj)
    db.session.flush()

    base_upload_path = DATA_ROOT / "NAS" / "UTBA" / "claim"
    os.makedirs(base_upload_path, exist_ok=True)

    for uploaded_file in files.getlist("files"):
        if not (uploaded_file and uploaded_file.filename):
            continue

        filename, extension = _normalize_attachment_name(uploaded_file.filename, uploaded_file.mimetype)

        attachment = ReimbursementAttachment(
            request_id=request_obj.id,
            uploader_user_id=getattr(current_user, "id", None),
            file_path="",
            file_name=filename,
            mime_type=uploaded_file.mimetype,
        )
        db.session.add(attachment)
        db.session.flush()

        new_filename = f"{attachment.id}{extension}"
        save_path = base_upload_path / new_filename
        uploaded_file.save(save_path)
        attachment.file_path = os.path.join("NAS", "UTBA", "claim", new_filename)

    db.session.commit()
    return request_obj


def list_claims_for_user(user):
    query = ReimbursementRequest.query
    can_view_all = user_can_manage_claims(user)
    if not can_view_all:
        query = query.filter(ReimbursementRequest.applicant_user_id == user.id)

    requests = query.order_by(ReimbursementRequest.created_at.desc()).all()
    return {
        "can_view_all": can_view_all,
        "data": [serialize_request_data(request_obj) for request_obj in requests],
    }


def record_claim_decision(request_id, payload, user):
    request_obj = _get_claim_or_raise(request_id)
    action = (payload.get("action") or "").strip().lower()
    comment = (payload.get("comment") or "").strip()
    sign_json_data = payload.get("sign_json_data")

    if action not in ("approve", "reject"):
        raise ValidationError("action 必须是 approve 或 reject")

    dep_id = None
    if getattr(user, "departments", None):
        dep_id = user.departments[0].id

    sign_payload = {
        "action": action,
        "comment": comment,
        "by_user_id": user.id,
        "by_username": user.username,
        "at": datetime.utcnow().isoformat(),
    }
    if sign_json_data is not None:
        sign_payload["extra"] = sign_json_data

    approver_row = ReimbursementApproverData(
        request_id=request_obj.id,
        user_id=user.id,
        dep_id=dep_id,
        sign_json_data=json.dumps(sign_payload, ensure_ascii=False),
        decided_at=datetime.utcnow(),
        reject=(action == "reject"),
    )
    db.session.add(approver_row)
    request_obj.status = "rejected" if action == "reject" else "approved"
    db.session.commit()
    return request_obj


def update_claim_event(request_id, payload, user):
    request_obj = _get_claim_or_raise(request_id)

    can_manage = user_can_manage_claims(user)
    if request_obj.applicant_user_id != user.id and not can_manage:
        raise PermissionDenied("没有权限编辑该申请")

    if request_obj.is_locked:
        raise PermissionDenied("该申请已锁定，不能修改活动")

    raw_event_id = (payload or {}).get("event_id")
    if raw_event_id in (None, "", 0, "0"):
        request_obj.event_id = None
        db.session.commit()
        return request_obj

    try:
        event_id = int(raw_event_id)
    except Exception as exc:
        raise ValidationError("event_id 格式错误") from exc

    event = EventData.query.get(event_id)
    if not event:
        raise ValidationError("活动不存在")

    request_obj.event_id = event.id
    db.session.commit()
    return request_obj


def build_payment_voucher_context(request_id, user):
    request_obj = _get_claim_or_raise(request_id)
    _require_payment_voucher_access(request_obj, user)
    data, approver_list = _ensure_claim_approved_for_voucher(request_obj)
    if not (data.get("voucher_recipient_name") and data.get("voucher_recipient_sign_json")):
        raise ValidationError("对方尚未完成 Payment Voucher 签名")
    return data, approver_list


def get_payment_voucher_share_data(request_id, user):
    request_obj = _get_claim_or_raise(request_id)
    _require_payment_voucher_access(request_obj, user)
    data, approver_list = _ensure_claim_approved_for_voucher(request_obj)
    return {
        "share_url": _payment_voucher_public_url(request_obj.public_token),
        "token": request_obj.public_token,
        "claim": data,
        "approver_data": approver_list,
        "is_signed": bool(data.get("voucher_recipient_name") and data.get("voucher_recipient_sign_json")),
    }


def get_public_payment_voucher_data(token):
    request_obj = _get_claim_by_public_token_or_raise(token)
    data, approver_list = _ensure_claim_approved_for_voucher(request_obj)
    return {
        "claim": data,
        "approver_data": approver_list,
        "is_signed": bool(data.get("voucher_recipient_name") and data.get("voucher_recipient_sign_json")),
    }


def submit_public_payment_voucher_signature(token, payload):
    request_obj = _get_claim_by_public_token_or_raise(token)
    _ensure_claim_approved_for_voucher(request_obj)

    full_name = str((payload or {}).get("full_name") or "").strip()
    if not full_name:
        raise ValidationError("请填写全名")

    sign_json_data = _normalize_sign_json((payload or {}).get("sign_json_data"))
    request_obj.voucher_recipient_name = full_name
    request_obj.voucher_recipient_sign_json = sign_json_data
    request_obj.voucher_signed_at = datetime.utcnow()
    db.session.commit()

    data = serialize_request_data(request_obj, with_children=True)
    return {
        "message": "签名已确认",
        "claim": data,
        "download_url": f"/api/account/print_payment_voucher/public/{request_obj.public_token}/download",
    }


def build_public_payment_voucher_context(token):
    request_obj = _get_claim_by_public_token_or_raise(token)
    data, approver_list = _ensure_claim_approved_for_voucher(request_obj)
    if not (data.get("voucher_recipient_name") and data.get("voucher_recipient_sign_json")):
        raise ValidationError("尚未完成签名，暂时不能下载 Payment Voucher")
    return data, approver_list
