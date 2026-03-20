import json
import os
import uuid
from datetime import datetime

from werkzeug.utils import secure_filename

from app.account.exceptions import NotFound, ValidationError
from app.account.permissions import resolve_user_permissions, user_can_manage_claims
from app.account.serializers import serialize_request_data
from app.paths import DATA_ROOT
from models import db
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

    try:
        sign_obj = json.loads(sign_json_data_raw)
        sign_json_data = json.dumps(sign_obj, ensure_ascii=False)
    except Exception as exc:
        raise ValidationError("sign_json_data 必须是合法 JSON") from exc

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

        filename = secure_filename(uploaded_file.filename)
        extension = os.path.splitext(filename)[1]

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


def build_payment_voucher_context(request_id, user):
    request_obj = _get_claim_or_raise(request_id)
    data = serialize_request_data(request_obj, with_children=True)
    approver_list = data.get("approver_data") or []

    permissions = resolve_user_permissions(user)
    can_account = "account" in permissions
    is_approved_by_me = any(
        approver.get("user_id") == user.id and approver.get("reject") is False
        for approver in approver_list
    )
    if not (can_account or is_approved_by_me):
        from app.account.exceptions import PermissionDenied

        raise PermissionDenied("没有权限下载 Payment Voucher")

    return data, approver_list
