import io
import json
import mimetypes
import os
import re
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from flask import request

from app.account.exceptions import NotFound, PermissionDenied, ValidationError
from app.account.permissions import resolve_user_permissions, user_can_manage_claims, user_can_read_all_claims
from app.email.service import env_value
from app.account.serializers import serialize_request_data
from app.paths import DATA_ROOT
from models import db
from models.form import RegisForm, RegisPayment
from models.event_data import EventBudgetData, EventData
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
READ_BILL_PARSE_TEXT_URL = os.environ.get(
    "READ_BILL_PARSE_TEXT_URL",
    READ_BILL_UPLOAD_URL.rstrip("/").removesuffix("/upload") + "/parse-text",
)
READ_BILL_ALLOWED_MODELS = {"auto", "byteplus", "local"}
READ_BILL_DEFAULT_MODEL = os.environ.get("READ_BILL_DEFAULT_MODEL", "auto").strip().lower()
READ_BILL_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


class ReadBillAuthError(ValidationError):
    """远程 AI fillin 服务返回 401（未授权）时抛出，用于触发本地 OCR 回退。"""


def _read_bill_auth_headers():
    # read_bill_api 网关要求 Authorization: Bearer <READ_BILL_ADMIN_TOKEN>。
    # 调用时读取（先进程环境变量，再兜底 .flaskenv），适配 gunicorn 启动。
    token = env_value("READ_BILL_ADMIN_TOKEN")
    return {"Authorization": f"Bearer {token}"} if token else {}
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


def _is_read_bill_pdf(file_name, mime_type):
    normalized_mime = str(mime_type or "").split(";")[0].strip().lower()
    return normalized_mime == "application/pdf" or os.path.splitext(file_name or "")[1].lower() == ".pdf"


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


def _is_truthy_form_value(value):
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _build_read_bill_fields(model, debug=None, bypass=None):
    form_fields = {"model": model}
    if _is_truthy_form_value(debug) or _is_truthy_form_value(bypass):
        form_fields["debug"] = "true"
    return form_fields


def _request_read_bill_upload(filename, mimetype, content, form_fields):
    boundary, body = _build_multipart_payload(
        form_fields,
        {
            "file": {
                "filename": filename,
                "content_type": mimetype or "application/octet-stream",
                "content": content,
            }
        },
    )
    upload_headers = {
        "Accept": "application/json",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "User-Agent": "Mozilla/5.0 XinyaClaimAI/1.0",
    }
    upload_headers.update(_read_bill_auth_headers())
    request_obj = urllib.request.Request(
        READ_BILL_UPLOAD_URL,
        data=body,
        method="POST",
        headers=upload_headers,
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
        if exc.code == 401:
            raise ReadBillAuthError(_extract_read_bill_error(error_payload, "AI fillin 未授权（401）")) from exc
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


def _request_read_bill_parse_text(text, form_fields):
    json_fields = dict(form_fields)
    json_fields["text"] = text
    body = json.dumps(json_fields, ensure_ascii=False).encode("utf-8")
    parse_headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 XinyaClaimAI/1.0",
    }
    parse_headers.update(_read_bill_auth_headers())
    request_obj = urllib.request.Request(
        READ_BILL_PARSE_TEXT_URL,
        data=body,
        method="POST",
        headers=parse_headers,
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
        if exc.code == 401:
            raise ReadBillAuthError(_extract_read_bill_error(error_payload, "AI fillin 未授权（401）")) from exc
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


def _extract_pdf_text(content):
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(content))
        chunks = []
        for index, page in enumerate(reader.pages):
            if index >= 5:
                break
            chunks.append(page.extract_text() or "")
        return "\n".join(chunks).strip()
    except Exception:
        return ""


def _render_pdf_first_page_to_jpeg(content):
    try:
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(content)
        if len(pdf) <= 0:
            raise ValidationError("PDF 内容为空")
        page = pdf[0]
        bitmap = page.render(scale=2)
        image = bitmap.to_pil()
        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="JPEG", quality=92)
        return buffer.getvalue()
    except ValidationError:
        raise
    except Exception:
        pass

    try:
        from pdf2image import convert_from_bytes

        pages = convert_from_bytes(content, dpi=200, first_page=1, last_page=1)
    except Exception as exc:
        raise ValidationError("PDF 无法转换成图片，请改上传图片格式收据") from exc

    if not pages:
        raise ValidationError("PDF 内容为空")

    buffer = io.BytesIO()
    pages[0].save(buffer, format="JPEG", quality=92)
    return buffer.getvalue()


def read_bill_from_file(uploaded_file, model=None, debug=None, bypass=None):
    if not (uploaded_file and uploaded_file.filename):
        raise ValidationError("请先选择图片或 PDF 附件")

    selected_model = str(model or READ_BILL_DEFAULT_MODEL or "auto").strip().lower()
    if selected_model not in READ_BILL_ALLOWED_MODELS:
        raise ValidationError("AI 识别模型错误")

    filename, _extension = _normalize_attachment_name(uploaded_file.filename, uploaded_file.mimetype)
    is_pdf = _is_read_bill_pdf(filename, uploaded_file.mimetype)
    if not (_is_read_bill_image(filename, uploaded_file.mimetype) or is_pdf):
        raise ValidationError("AI fillin 只支持图片或 PDF 附件")

    content = uploaded_file.read()
    if not content:
        raise ValidationError("文件内容为空")

    form_fields = _build_read_bill_fields(selected_model, debug, bypass)

    try:
        return _remote_read_bill(content, filename, uploaded_file.mimetype, is_pdf, form_fields)
    except ReadBillAuthError:
        # 远程 AI fillin 服务返回 401（未授权）→ 自动回退到本机 tesseract OCR。
        return _local_read_bill(content, filename, uploaded_file.mimetype, is_pdf)


def _remote_read_bill(content, filename, mimetype, is_pdf, form_fields):
    # 远程 AI fillin 调用逻辑（未改动）——仅被上层包了一层 401 回退。
    if is_pdf:
        pdf_text = _extract_pdf_text(content)
        if pdf_text:
            try:
                return _request_read_bill_parse_text(pdf_text, form_fields)
            except ReadBillAuthError:
                raise
            except ValidationError:
                pass

        image_content = _render_pdf_first_page_to_jpeg(content)
        image_filename = f"{os.path.splitext(filename)[0] or 'receipt'}.jpg"
        return _request_read_bill_upload(image_filename, "image/jpeg", image_content, form_fields)

    return _request_read_bill_upload(filename, mimetype, content, form_fields)


# =========================
# 本地 OCR 回退（tesseract）
# =========================
def _local_read_bill(content, filename, mimetype, is_pdf):
    del filename, mimetype
    try:
        import pytesseract
        from PIL import Image
    except Exception as exc:  # noqa: BLE001
        raise ValidationError("本地 OCR 不可用（未安装 tesseract / pytesseract）") from exc

    image_bytes = _render_pdf_first_page_to_jpeg(content) if is_pdf else content
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as exc:  # noqa: BLE001
        raise ValidationError("本地 OCR 无法读取图片") from exc

    try:
        text = pytesseract.image_to_string(image, lang="eng+chi_sim")
    except Exception as exc:  # noqa: BLE001
        raise ValidationError(f"本地 OCR 识别失败：{exc}") from exc

    data = _parse_receipt_text_local(text)
    return {
        "success": True,
        "data": data,
        "meta": {
            "source": "local_ocr_fallback",
            "requestedModel": "local",
            "needsReview": True,
            "reviewReasons": ["远程 AI 服务未授权(401)，已使用本地 OCR 回退，请核对金额/日期/商家。"],
        },
    }


_MONEY_RE = re.compile(r"(?:RM|MYR)?\s*([0-9][0-9,]*\.[0-9]{2})", re.IGNORECASE)
_TOTAL_HINT_RE = re.compile(r"(grand\s*total|total|amount\s*due|amount|nett?|balance)", re.IGNORECASE)
_DATE_DMY_RE = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b")
_DATE_YMD_RE = re.compile(r"\b(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\b")
_TIME_RE = re.compile(r"\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\b")
_PHONE_HINT_RE = re.compile(r"(?:tel|phone|h\s*/?\s*p|hp|fax|contact)[:.\s]*([+0-9][0-9\s\-]{6,})", re.IGNORECASE)
_PHONE_BARE_RE = re.compile(r"\b(0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{3,4})\b")
_RECEIPT_NO_RE = re.compile(r"(?:receipt|invoice|bill|ref|doc)\s*(?:no|number|#|:)[:.#\s]*([A-Za-z0-9\-/]+)", re.IGNORECASE)


def _normalize_local_date(day, month, year):
    try:
        d, m, y = int(day), int(month), int(year)
    except (TypeError, ValueError):
        return ""
    if y < 100:
        y += 2000
    if not (1 <= m <= 12 and 1 <= d <= 31 and 2000 <= y <= 2100):
        return ""
    return f"{y:04d}-{m:02d}-{d:02d}"


def _parse_receipt_text_local(text):
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]

    # 商家名：第一条“像名字”的行（含字母、不是纯数字/符号）。
    merchant_name = ""
    for ln in lines[:6]:
        letters = sum(ch.isalpha() for ch in ln)
        if letters >= 3 and not _DATE_DMY_RE.search(ln) and not _DATE_YMD_RE.search(ln):
            merchant_name = ln
            break

    # 金额：优先取含 TOTAL 等关键词的行里的钱数；否则取全文最大的钱数。
    total_amount = ""
    hinted = []
    for ln in lines:
        if _TOTAL_HINT_RE.search(ln) and not re.search(r"sub\s*total", ln, re.IGNORECASE):
            hinted.extend(_MONEY_RE.findall(ln))
    candidates = hinted or _MONEY_RE.findall(text or "")
    money_values = []
    for raw in candidates:
        try:
            money_values.append(float(raw.replace(",", "")))
        except ValueError:
            continue
    if money_values:
        total_amount = f"{max(money_values):.2f}"

    # 日期
    receipt_date = ""
    ymd = _DATE_YMD_RE.search(text or "")
    if ymd:
        receipt_date = _normalize_local_date(ymd.group(3), ymd.group(2), ymd.group(1))
    if not receipt_date:
        dmy = _DATE_DMY_RE.search(text or "")
        if dmy:
            receipt_date = _normalize_local_date(dmy.group(1), dmy.group(2), dmy.group(3))

    # 日期时间（日期 + 首个时间）
    purchase_datetime = ""
    if receipt_date:
        tm = _TIME_RE.search(text or "")
        if tm:
            hour = int(tm.group(1))
            minute = tm.group(2)
            meridiem = (tm.group(3) or "").lower()
            if meridiem == "pm" and hour < 12:
                hour += 12
            elif meridiem == "am" and hour == 12:
                hour = 0
            if 0 <= hour <= 23:
                purchase_datetime = f"{receipt_date}T{hour:02d}:{minute}"

    # 电话
    merchant_phone = ""
    phone_hit = _PHONE_HINT_RE.search(text or "") or _PHONE_BARE_RE.search(text or "")
    if phone_hit:
        merchant_phone = re.sub(r"\s+", " ", phone_hit.group(1)).strip()

    # 收据号
    receipt_number = ""
    rn = _RECEIPT_NO_RE.search(text or "")
    if rn:
        receipt_number = rn.group(1).strip()

    return {
        "merchant_name": merchant_name,
        "merchant_address": "",
        "merchant_phone": merchant_phone,
        "receipt_number": receipt_number,
        "total_amount": total_amount,
        "receipt_date": receipt_date,
        "purchase_datetime": purchase_datetime,
        "description": "",
        "receipt_items": [],
        "ocr_text": (text or "").strip()[:2000],
    }


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

    event_budget_id_raw = form.get("event_budget_id")
    try:
        request_date = datetime.strptime(request_date_raw, "%Y-%m-%d").date()
        amount = float(amount_raw)
        event_id = int(event_id_raw) if event_id_raw else None
        event_budget_id = int(event_budget_id_raw) if event_budget_id_raw else None
    except Exception as exc:
        raise ValidationError("数据格式错误") from exc
    if amount <= 0:
        raise ValidationError("金额必须大于 0")

    # 关联预算行：校验其属于所选活动；活动缺省时用预算行的活动补上。
    if event_budget_id is not None:
        budget_line = EventBudgetData.query.get(event_budget_id)
        if budget_line is None:
            raise ValidationError("关联的预算行不存在")
        if event_id is not None and budget_line.event_id != event_id:
            raise ValidationError("关联的预算行不属于该活动")
        if event_id is None:
            event_id = budget_line.event_id

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
        event_budget_id=event_budget_id,
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


def build_claim_report_context(claim_ids, user):
    normalized_ids = []
    seen_ids = set()
    for raw_id in claim_ids or []:
        try:
            claim_id = int(raw_id)
        except Exception as exc:
            raise ValidationError("报销申请单号格式错误") from exc
        if claim_id <= 0 or claim_id in seen_ids:
            continue
        normalized_ids.append(claim_id)
        seen_ids.add(claim_id)

    if not normalized_ids:
        raise ValidationError("请先选择要导出的报销申请")
    if len(normalized_ids) > 100:
        raise ValidationError("一次最多导出 100 笔报销申请")

    query = ReimbursementRequest.query.filter(ReimbursementRequest.id.in_(normalized_ids))
    if not user_can_read_all_claims(user):
        query = query.filter(ReimbursementRequest.applicant_user_id == user.id)

    request_map = {request_obj.id: request_obj for request_obj in query.all()}
    missing_ids = [claim_id for claim_id in normalized_ids if claim_id not in request_map]
    if missing_ids:
        raise PermissionDenied("部分报销申请不存在或没有权限导出")

    requests = [request_map[claim_id] for claim_id in normalized_ids]
    return [serialize_request_data(request_obj, with_children=True) for request_obj in requests]


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

    if "event_budget_id" in payload:
        raw_budget_id = payload.get("event_budget_id")
        if raw_budget_id in (None, "", 0, "0"):
            _record_claim_change(request_obj, "event_budget_id", request_obj.event_budget_id, None, user)
            request_obj.event_budget_id = None
        else:
            try:
                budget_id = int(raw_budget_id)
            except Exception as exc:
                raise ValidationError("event_budget_id 格式错误") from exc
            budget_line = EventBudgetData.query.get(budget_id)
            if not budget_line:
                raise ValidationError("预算行不存在")
            if request_obj.event_id is not None and budget_line.event_id != request_obj.event_id:
                raise ValidationError("预算行不属于该活动")
            _record_claim_change(request_obj, "event_budget_id", request_obj.event_budget_id, budget_line.id, user)
            request_obj.event_budget_id = budget_line.id

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


# ---------------------------------------------------------------------------
# 财政收款（Finance collections）：跨 scope 汇总所有报名付款（RegisPayment）
# ---------------------------------------------------------------------------

FINANCE_SCOPE_LABELS = {
    "form": "报名表单",
    "membership": "会员",
    "youth_class": "青少年佛学班",
    "fahui_ylp": "法会 YLP",
    "fahui_lamp": "法会 Lamp",
    "sales": "销售收入",
}
_FINANCE_PAYMENT_SCOPES = ("form", "membership", "youth_class")
_FINANCE_PAYMENT_STATUSES = ("process", "checked", "fail")

# 销售单据（AssetStockDocument, sale_out/sale_return）POST 到收款审核后并入聚合列表。
# 用大偏移量与 RegisPayment / FahuiPayment 的 id 空间区分。
SALES_FINANCE_ID_OFFSET = 2_000_000_000


def _sales_document_amount(document):
    total = 0.0
    for line in document.lines or []:
        if line.line_amount is not None:
            total += float(line.line_amount)
        elif line.unit_price is not None:
            total += float(line.unit_price) * int(line.quantity or 0)
    return total


def _serialize_sales_finance_payment(document):
    created = document.confirmed_at or document.created_at
    amount = _sales_document_amount(document)
    status = document.finance_payment_status if document.finance_payment_status in _FINANCE_PAYMENT_STATUSES else "process"
    return {
        "id": SALES_FINANCE_ID_OFFSET + document.id,
        "payment_scope": "sales",
        "regis_form_id": None,
        "membership_registration_id": None,
        "youth_class_registration_id": None,
        "nric_asset_id": None,
        "nric": None,
        "nric_snapshot": None,
        "name": document.counterparty_name or "-",
        "phone": None,
        "payment_mode": "销售出库" if document.document_type == "sale_out" else "销售退回",
        "price": amount,
        "amount": amount,
        "created_at": created.isoformat() if created else None,
        "date": created.date().isoformat() if created else None,
        "time": created.time().isoformat() if created else None,
        "status": status,
        "counter": document.taken_by_name,
        "proof_image_path": None,
        "proof_image_url": None,
        "source_scope": "sales",
        "source_scope_label": FINANCE_SCOPE_LABELS["sales"],
        "source_label": document.document_no,
        "registration_id": document.id,
    }


def _list_sales_finance_payments(status=None):
    from models.asset import AssetStockDocument

    query = AssetStockDocument.query.filter(
        AssetStockDocument.finance_payment_status.isnot(None),
        AssetStockDocument.status != "cancelled",
    )
    if status in _FINANCE_PAYMENT_STATUSES:
        query = query.filter(AssetStockDocument.finance_payment_status == status)
    documents = query.order_by(AssetStockDocument.confirmed_at.desc(), AssetStockDocument.id.desc()).all()
    return [_serialize_sales_finance_payment(document) for document in documents]


def _update_sales_finance_payment_status(payment_id, data):
    from flask import jsonify

    from models.asset import AssetStockDocument

    real_id = payment_id - SALES_FINANCE_ID_OFFSET
    document = AssetStockDocument.query.get(real_id)
    if document is None or not document.finance_payment_status:
        raise NotFound("收款记录不存在")

    status = str((data or {}).get("status") or "").strip()
    if status not in _FINANCE_PAYMENT_STATUSES:
        raise ValidationError("付款状态无效")

    document.finance_payment_status = status
    db.session.commit()
    return jsonify(
        {
            "status": "success",
            "message": "付款状态已更新",
            "payment": _serialize_sales_finance_payment(document),
        }
    )

# 法会付款（FahuiPayment）统一并入财政收款审核。法会付款的 id 与 RegisPayment
# 分属不同表、会冲突，这里给法会付款加一个大偏移量做命名空间。
FAHUI_FINANCE_ID_OFFSET = 1_000_000_000
_FAHUI_FINANCE_SCOPES = {"fahui_ylp": "ylp", "fahui_lamp": "lamp"}
# 法会状态 pending/approved/rejected <-> 财政状态 process/checked/fail
_FAHUI_STATUS_TO_FINANCE = {"approved": "checked", "rejected": "fail", "pending": "process"}
_FINANCE_STATUS_TO_FAHUI = {"checked": "approved", "fail": "rejected", "process": "pending"}


def _serialize_fahui_finance_payment(payment):
    from app.fahui.common.payment import normalize_fahui_payment_status

    order = getattr(payment, "order", None)
    scope = "fahui_lamp" if payment.payment_type == "lamp" else "fahui_ylp"
    finance_status = _FAHUI_STATUS_TO_FINANCE.get(
        normalize_fahui_payment_status(payment.status), "process"
    )
    amount = float(payment.total_price or 0)
    created = payment.created_at
    proof = f"/api/payment/payments/{payment.id}/document" if payment.document else None

    if scope == "fahui_lamp":
        regs = list(getattr(payment, "lamp_registrations", None) or [])
        source_label = regs[0].devotee_name if regs else None
        registration_id = regs[0].id if regs else None
        phone_fallback = regs[0].phone if regs else None
    else:
        grouped = list(getattr(payment, "grouped_orders", None) or [])
        if order:
            source_label = order.customer_name or order.name or f"订单 #{order.id}"
            registration_id = order.id
            phone_fallback = order.phone
        elif grouped:
            first = grouped[0]
            base = first.customer_name or first.name or f"订单 #{first.id}"
            source_label = base + (f" 等 {len(grouped)} 张订单" if len(grouped) > 1 else "")
            registration_id = first.id
            phone_fallback = first.phone
        else:
            source_label = None
            registration_id = None
            phone_fallback = None

    return {
        "id": FAHUI_FINANCE_ID_OFFSET + payment.id,
        "payment_scope": scope,
        "regis_form_id": None,
        "membership_registration_id": None,
        "youth_class_registration_id": None,
        "nric_asset_id": None,
        "nric": None,
        "nric_snapshot": None,
        "name": payment.payer_name or source_label,
        "phone": payment.phone or phone_fallback,
        "payment_mode": payment.payment_mode,
        "price": amount,
        "amount": amount,
        "created_at": created.isoformat() if created else None,
        "date": created.date().isoformat() if created else None,
        "time": created.time().isoformat() if created else None,
        "status": finance_status,
        "counter": payment.valid_by,
        "proof_image_path": proof,
        "proof_image_url": proof,
        "source_scope": scope,
        "source_scope_label": FINANCE_SCOPE_LABELS.get(scope, scope),
        "source_label": source_label,
        "registration_id": registration_id,
    }


def _list_fahui_finance_payments(scope=None, status=None):
    from models.fahui import FahuiPayment

    payment_types = None
    if scope in _FAHUI_FINANCE_SCOPES:
        payment_types = [_FAHUI_FINANCE_SCOPES[scope]]
    else:
        payment_types = list(_FAHUI_FINANCE_SCOPES.values())

    query = FahuiPayment.query.filter(FahuiPayment.payment_type.in_(payment_types))
    if status in _FINANCE_PAYMENT_STATUSES:
        fahui_status = _FINANCE_STATUS_TO_FAHUI[status]
        query = query.filter(FahuiPayment.status == fahui_status)
    payments = query.order_by(FahuiPayment.created_at.desc(), FahuiPayment.id.desc()).all()
    return [_serialize_fahui_finance_payment(payment) for payment in payments]


def _finance_payment_source(payment, form_titles):
    scope = payment.payment_scope or "form"
    label = None
    registration_id = None
    if scope == "membership":
        reg = payment.membership_registration
        if reg is not None:
            registration_id = reg.id
            member = getattr(reg, "member", None) or getattr(reg, "nric_asset", None)
            label = (
                getattr(getattr(reg, "user", None), "display_name", None)
                or getattr(member, "name_nric", None)
                or getattr(reg, "requested_username", None)
            )
    elif scope == "youth_class":
        reg = payment.youth_class_registration
        if reg is not None:
            registration_id = reg.id
            label = reg.chinese_name or reg.english_name
    else:
        registration_id = payment.regis_form_id
        if payment.regis_form_id is not None:
            label = form_titles.get(payment.regis_form_id)
    return scope, FINANCE_SCOPE_LABELS.get(scope, scope), label, registration_id


def _serialize_finance_payment(payment, form_titles):
    data = payment.to_dict()
    scope, scope_label, source_label, registration_id = _finance_payment_source(payment, form_titles)
    data["source_scope"] = scope
    data["source_scope_label"] = scope_label
    data["source_label"] = source_label
    data["registration_id"] = registration_id
    return data


def list_finance_payments(scope=None, status=None):
    """列出所有付款审核记录（报名 form/membership/youth_class + 法会 ylp/lamp + 销售 sales）。"""
    results = []

    include_regis = scope in _FINANCE_PAYMENT_SCOPES or scope in (None, "", "all")
    include_fahui = scope in _FAHUI_FINANCE_SCOPES or scope in (None, "", "all")
    include_sales = scope == "sales" or scope in (None, "", "all")

    if include_regis:
        query = RegisPayment.query
        if scope in _FINANCE_PAYMENT_SCOPES:
            query = query.filter(RegisPayment.payment_scope == scope)
        if status in _FINANCE_PAYMENT_STATUSES:
            query = query.filter(RegisPayment.status == status)
        payments = query.order_by(RegisPayment.created_at.desc(), RegisPayment.id.desc()).all()

        form_ids = {p.regis_form_id for p in payments if p.regis_form_id}
        form_titles = {}
        if form_ids:
            for form in RegisForm.query.filter(RegisForm.id.in_(form_ids)).all():
                form_titles[form.id] = getattr(form, "title", None)

        results.extend(_serialize_finance_payment(payment, form_titles) for payment in payments)

    if include_fahui:
        results.extend(_list_fahui_finance_payments(scope=scope, status=status))

    if include_sales:
        results.extend(_list_sales_finance_payments(status=status))

    results.sort(key=lambda item: (item.get("created_at") or "", item.get("id") or 0), reverse=True)
    return results


def build_payment_report_context(payment_ids, user=None):
    """Return serialized finance payments for the given ids, preserving id order."""
    ids = [int(pid) for pid in (payment_ids or []) if str(pid).strip()]
    if not ids:
        return []
    all_payments = list_finance_payments()
    by_id = {payment.get("id"): payment for payment in all_payments}
    ordered = [by_id[pid] for pid in ids if pid in by_id]
    return ordered


def update_finance_payment_status(payment_id, data):
    """按 scope 分发到对应的付款状态更新流程，保留会员 / 青少年 / 法会 / 销售 的生效副作用。"""
    # 销售偏移量 (2e9) 大于法会偏移量 (1e9)，必须先判销售。
    if payment_id >= SALES_FINANCE_ID_OFFSET:
        return _update_sales_finance_payment_status(payment_id, data)
    if payment_id >= FAHUI_FINANCE_ID_OFFSET:
        return _update_fahui_finance_payment_status(payment_id, data)

    payment = RegisPayment.query.get(payment_id)
    if payment is None:
        raise NotFound("付款记录不存在")

    scope = payment.payment_scope or "form"
    if scope == "membership":
        from app.user_control import membership as membership_service

        return membership_service.update_membership_payment_status(payment_id, data)
    if scope == "youth_class":
        from app.form import services as form_services

        return form_services.update_youth_class_payment_status(payment_id, data)

    from app.form import services as form_services

    return form_services.update_payment_status(payment_id, data)


def _update_fahui_finance_payment_status(payment_id, data):
    from flask import jsonify
    from flask_login import current_user

    from app.fahui.common.payment_review import get_payment_or_404, set_payment_review_status

    real_id = payment_id - FAHUI_FINANCE_ID_OFFSET
    payment = get_payment_or_404(real_id)
    if payment is None:
        raise NotFound("付款记录不存在")

    finance_status = str((data or {}).get("status") or "").strip()
    fahui_status = _FINANCE_STATUS_TO_FAHUI.get(finance_status)
    if not fahui_status:
        raise ValidationError("付款状态无效")

    try:
        set_payment_review_status(payment, status=fahui_status, reviewer_user=current_user)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise

    return jsonify(
        {
            "status": "success",
            "message": "付款状态已更新",
            "payment": _serialize_fahui_finance_payment(payment),
        }
    )
