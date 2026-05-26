import json
import mimetypes
import os
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from flask import request

from app.account.exceptions import NotFound, PermissionDenied, ValidationError
from app.account.permissions import resolve_user_permissions, user_can_manage_claims, user_can_read_all_claims
from app.account.serializers import serialize_request_data
from app.paths import DATA_ROOT
from models import db
from models.event_data import EventData
from models.finance import (
    ReimbursementApproverData,
    ReimbursementAttachment,
    ReimbursementRequestChangeLog,
    ReimbursementRequest,
)
from models.user_data import Department

READ_BILL_UPLOAD_URL = os.environ.get(
    "READ_BILL_UPLOAD_URL",
    "https://nginx.yihong1031.com/read_bill_api/upload",
)
READ_BILL_ALLOWED_MODELS = {"auto", "byteplus", "local"}
READ_BILL_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
CLAIM_EDIT_FIELD_LABELS = {
    "applicant_name": "申请人",
    "request_date": "日期",
    "amount": "金额",
    "department_name": "部门",
    "purpose": "用途说明",
    "ref1": "AI说明",
    "ref2": "AI项目内容",
    "vendor_name": "商家名称",
    "vendor_address": "商家地址",
    "vendor_contact_number": "商家联络号码",
    "purchase_datetime": "采购日期",
    "event_id": "活动",
    "attachment": "附件",
}


def _get_claim_or_raise(request_id):
    request_obj = ReimbursementRequest.query.get(request_id)
    if not request_obj:
        raise NotFound("找不到申请")
    return request_obj


def _get_claim_attachment_or_raise(attachment_id):
    attachment = ReimbursementAttachment.query.get(attachment_id)
    if not attachment:
        raise NotFound("找不到附件")
    return attachment


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


def _is_read_bill_image(file_name, mime_type):
    if str(mime_type or "").split(";")[0].strip().lower().startswith("image/"):
        return True
    return os.path.splitext(file_name or "")[1].lower() in READ_BILL_IMAGE_EXTENSIONS


def _build_multipart_payload(fields, files):
    boundary = f"----XinyaReadBill{uuid.uuid4().hex}"
    chunks = []

    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}".encode("utf-8"),
                f'Content-Disposition: form-data; name="{name}"'.encode("utf-8"),
                b"",
                str(value).encode("utf-8"),
            ]
        )

    for name, file_info in files.items():
        filename = str(file_info["filename"]).replace('"', '\\"')
        content_type = file_info.get("content_type") or "application/octet-stream"
        chunks.extend(
            [
                f"--{boundary}".encode("utf-8"),
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"'.encode("utf-8"),
                f"Content-Type: {content_type}".encode("utf-8"),
                b"",
                file_info["content"],
            ]
        )

    chunks.append(f"--{boundary}--".encode("utf-8"))
    chunks.append(b"")
    return boundary, b"\r\n".join(chunks)


def _extract_read_bill_error(payload, fallback):
    if isinstance(payload, dict):
        return payload.get("message") or payload.get("error") or fallback
    return fallback


def read_bill_from_file(uploaded_file, model=None):
    if not (uploaded_file and uploaded_file.filename):
        raise ValidationError("请先选择图片附件")

    selected_model = str(model or os.environ.get("READ_BILL_DEFAULT_MODEL") or "byteplus").strip().lower()
    if selected_model not in READ_BILL_ALLOWED_MODELS:
        raise ValidationError("AI 识别模型错误")

    filename, _extension = _normalize_attachment_name(uploaded_file.filename, uploaded_file.mimetype)
    if not _is_read_bill_image(filename, uploaded_file.mimetype):
        raise ValidationError("AI fillin 只支持图片附件")

    content = uploaded_file.read()
    if not content:
        raise ValidationError("图片内容为空")

    boundary, body = _build_multipart_payload(
        {"model": selected_model},
        {
            "file": {
                "filename": filename,
                "content_type": uploaded_file.mimetype or "application/octet-stream",
                "content": content,
            }
        },
    )
    request_obj = urllib.request.Request(
        READ_BILL_UPLOAD_URL,
        data=body,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "Mozilla/5.0 XinyaClaimAI/1.0",
        },
    )

    try:
        with urllib.request.urlopen(request_obj, timeout=60) as response:
            response_text = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        response_text = exc.read().decode("utf-8", errors="replace")
        try:
            error_payload = json.loads(response_text)
        except Exception:
            error_payload = None
        raise ValidationError(_extract_read_bill_error(error_payload, f"AI fillin 失败（{exc.code}）")) from exc
    except urllib.error.URLError as exc:
        raise ValidationError(f"AI fillin 服务暂时无法连接：{exc.reason}") from exc

    try:
        payload = json.loads(response_text)
    except Exception as exc:
        raise ValidationError("AI fillin 返回格式错误") from exc

    if not isinstance(payload, dict):
        raise ValidationError("AI fillin 返回格式错误")
    if payload.get("success") is False or payload.get("status") == "error":
        raise ValidationError(_extract_read_bill_error(payload, "AI fillin 失败"))

    return payload


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


def _stringify_change_value(value):
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _record_claim_change(request_obj, field_name, old_value, new_value, user):
    old_text = _stringify_change_value(old_value)
    new_text = _stringify_change_value(new_value)
    if old_text == new_text:
        return

    db.session.add(
        ReimbursementRequestChangeLog(
            request_id=request_obj.id,
            changed_by_user_id=getattr(user, "id", None),
            field_name=CLAIM_EDIT_FIELD_LABELS.get(field_name, field_name),
            old_value=old_text,
            new_value=new_text,
        )
    )


def _optional_text(value, max_length=None, field_name="字段"):
    text = str(value or "").strip()
    if max_length and len(text) > max_length:
        raise ValidationError(f"{field_name}过长")
    return text or None


def _parse_optional_datetime(value, field_name):
    text = str(value or "").strip()
    if not text:
        return None

    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
        return parsed.replace(tzinfo=None)
    except Exception:
        pass

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except Exception:
            continue

    raise ValidationError(f"{field_name}格式错误")


def _require_payment_voucher_access(request_obj, user):
    permissions = resolve_user_permissions(user)
    can_account = "account_read" in permissions or "account_edit" in permissions
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


def _resolve_claim_department_name(form):
    department_name = str(form.get("department_name") or "").strip()
    if department_name:
        if len(department_name) > 100:
            raise ValidationError("部门名称过长")
        return department_name

    department_id_raw = form.get("department_id")
    if not department_id_raw:
        raise ValidationError("请选择部门")

    try:
        department_id = int(department_id_raw)
    except Exception as exc:
        raise ValidationError("部门格式错误") from exc

    department = Department.query.get(department_id)
    if not department or not str(department.name or "").strip():
        raise ValidationError("部门不存在")

    return str(department.name).strip()


def _save_claim_attachment(request_obj, uploaded_file, current_user=None):
    if not (uploaded_file and uploaded_file.filename):
        return None

    base_upload_path = DATA_ROOT / "NAS" / "UTBA" / "claim"
    os.makedirs(base_upload_path, exist_ok=True)

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
    return attachment


def create_claim_from_form(form, files, current_user=None):
    applicant_name = form.get("applicant_name")
    request_date_raw = form.get("request_date")
    amount_raw = form.get("amount")
    purpose = form.get("purpose")
    event_id_raw = form.get("event_id")
    sign_json_data_raw = form.get("sign_json_data")
    department_name = _resolve_claim_department_name(form)
    ref1 = _optional_text(form.get("ref1"))
    ref2 = _optional_text(form.get("ref2"))
    vendor_name = _optional_text(form.get("vendor_name"), 255, "商家名称")
    vendor_address = _optional_text(form.get("vendor_address"))
    vendor_contact_number = _optional_text(form.get("vendor_contact_number"), 80, "商家联络号码")
    purchase_datetime = _parse_optional_datetime(form.get("purchase_datetime"), "采购日期")

    if not all(
        [
            applicant_name,
            request_date_raw,
            amount_raw,
            purpose,
            sign_json_data_raw,
        ]
    ):
        raise ValidationError("缺少必要字段")

    sign_json_data = _normalize_sign_json(sign_json_data_raw)

    try:
        request_date = datetime.strptime(request_date_raw, "%Y-%m-%d").date()
        amount = float(amount_raw)
        event_id = int(event_id_raw) if event_id_raw else None
    except Exception as exc:
        raise ValidationError("数据格式错误") from exc
    if amount <= 0:
        raise ValidationError("金额必须大于 0")

    request_obj = ReimbursementRequest(
        applicant_user_id=getattr(current_user, "id", None),
        applicant_name=applicant_name,
        request_date=request_date,
        amount=amount,
        department_name=department_name,
        purpose=purpose,
        ref1=ref1,
        ref2=ref2,
        vendor_name=vendor_name,
        vendor_address=vendor_address,
        vendor_contact_number=vendor_contact_number,
        purchase_datetime=purchase_datetime,
        public_token=uuid.uuid4().hex,
        event_id=event_id,
        sign_json_data=sign_json_data,
        status="submitted",
    )
    db.session.add(request_obj)
    db.session.flush()

    for uploaded_file in files.getlist("files"):
        _save_claim_attachment(request_obj, uploaded_file, current_user)

    db.session.commit()
    return request_obj


def list_claims_for_user(user):
    query = ReimbursementRequest.query
    can_view_all = user_can_read_all_claims(user)
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


def update_claim(request_id, payload, user):
    request_obj = _get_claim_or_raise(request_id)
    if not user_can_manage_claims(user):
        raise PermissionDenied("没有权限编辑该申请")
    if request_obj.is_locked:
        raise PermissionDenied("该申请已锁定，不能修改")

    payload = payload or {}

    if "applicant_name" in payload:
        applicant_name = str(payload.get("applicant_name") or "").strip()
        if not applicant_name:
            raise ValidationError("申请人不能为空")
        if len(applicant_name) > 128:
            raise ValidationError("申请人名称过长")
        _record_claim_change(request_obj, "applicant_name", request_obj.applicant_name, applicant_name, user)
        request_obj.applicant_name = applicant_name

    if "request_date" in payload:
        try:
            request_date = datetime.strptime(str(payload.get("request_date") or ""), "%Y-%m-%d").date()
        except Exception as exc:
            raise ValidationError("日期格式错误") from exc
        _record_claim_change(request_obj, "request_date", request_obj.request_date, request_date, user)
        request_obj.request_date = request_date

    if "amount" in payload:
        try:
            amount = float(payload.get("amount"))
        except Exception as exc:
            raise ValidationError("金额格式错误") from exc
        if amount <= 0:
            raise ValidationError("金额必须大于 0")
        _record_claim_change(request_obj, "amount", request_obj.amount, amount, user)
        request_obj.amount = amount

    if "department_name" in payload:
        department_name = str(payload.get("department_name") or "").strip()
        if not department_name:
            raise ValidationError("部门不能为空")
        if len(department_name) > 100:
            raise ValidationError("部门名称过长")
        _record_claim_change(request_obj, "department_name", request_obj.department_name, department_name, user)
        request_obj.department_name = department_name

    if "purpose" in payload:
        purpose = str(payload.get("purpose") or "").strip()
        if not purpose:
            raise ValidationError("用途说明不能为空")
        _record_claim_change(request_obj, "purpose", request_obj.purpose, purpose, user)
        request_obj.purpose = purpose

    optional_field_limits = {
        "vendor_name": (255, "商家名称"),
        "vendor_contact_number": (80, "商家联络号码"),
    }
    for optional_field in ("ref1", "ref2", "vendor_name", "vendor_address", "vendor_contact_number"):
        if optional_field in payload:
            max_length, field_label = optional_field_limits.get(optional_field, (None, "字段"))
            next_value = _optional_text(payload.get(optional_field), max_length, field_label)
            _record_claim_change(request_obj, optional_field, getattr(request_obj, optional_field), next_value, user)
            setattr(request_obj, optional_field, next_value)

    if "purchase_datetime" in payload:
        purchase_datetime = _parse_optional_datetime(payload.get("purchase_datetime"), "采购日期")
        _record_claim_change(request_obj, "purchase_datetime", request_obj.purchase_datetime, purchase_datetime, user)
        request_obj.purchase_datetime = purchase_datetime

    if "event_id" in payload:
        raw_event_id = payload.get("event_id")
        if raw_event_id in (None, "", 0, "0"):
            _record_claim_change(request_obj, "event_id", request_obj.event_id, None, user)
            request_obj.event_id = None
        else:
            try:
                event_id = int(raw_event_id)
            except Exception as exc:
                raise ValidationError("event_id 格式错误") from exc
            event = EventData.query.get(event_id)
            if not event:
                raise ValidationError("活动不存在")
            _record_claim_change(request_obj, "event_id", request_obj.event_id, event.id, user)
            request_obj.event_id = event.id

    request_obj.updated_at = datetime.utcnow()
    db.session.commit()
    return request_obj


def add_claim_attachments(request_id, files, user):
    request_obj = _get_claim_or_raise(request_id)
    can_manage = user_can_manage_claims(user)
    if request_obj.applicant_user_id != user.id and not can_manage:
        raise PermissionDenied("没有权限编辑该申请")
    if request_obj.is_locked:
        raise PermissionDenied("该申请已锁定，不能新增附件")

    attachments = []
    for uploaded_file in files.getlist("files"):
        attachment = _save_claim_attachment(request_obj, uploaded_file, user)
        if attachment:
            attachments.append(attachment)
            _record_claim_change(request_obj, "attachment", "", f"新增附件：{attachment.file_name or attachment.file_path}", user)

    if not attachments:
        raise ValidationError("请先选择附件")

    request_obj.updated_at = datetime.utcnow()
    db.session.commit()
    return request_obj


def delete_claim_attachment(attachment_id, user):
    attachment = _get_claim_attachment_or_raise(attachment_id)
    request_obj = attachment.request
    can_manage = user_can_manage_claims(user)
    if request_obj.applicant_user_id != user.id and not can_manage:
        raise PermissionDenied("没有权限删除该附件")
    if request_obj.is_locked:
        raise PermissionDenied("该申请已锁定，不能删除附件")

    request_id = request_obj.id
    relative_path = str(attachment.file_path or "").strip()
    display_name = attachment.file_name or attachment.file_path or f"附件 #{attachment.id}"
    _record_claim_change(request_obj, "attachment", f"删除附件：{display_name}", "", user)
    request_obj.updated_at = datetime.utcnow()
    db.session.delete(attachment)
    db.session.commit()

    if relative_path:
        file_path = DATA_ROOT / Path(relative_path)
        try:
            if file_path.is_file():
                file_path.unlink()
        except OSError:
            pass

    return _get_claim_or_raise(request_id)


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


def delete_claim(request_id, user):
    request_obj = _get_claim_or_raise(request_id)

    if not user_can_manage_claims(user):
        raise PermissionDenied("没有权限删除该申请")

    attachment_paths = [
        str(item.file_path or "").strip()
        for item in (request_obj.attachments or [])
        if str(item.file_path or "").strip()
    ]

    db.session.delete(request_obj)
    db.session.commit()

    for relative_path in attachment_paths:
        file_path = DATA_ROOT / Path(relative_path)
        try:
            if file_path.is_file():
                file_path.unlink()
        except OSError:
            continue


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
