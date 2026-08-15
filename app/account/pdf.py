import os
from datetime import datetime
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.paths import DATA_ROOT


PDF_FONT = "STSong-Light"
PDF_FONT_BOLD = "STSong-Light"
REPORT_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"}


def _register_fonts():
    try:
        pdfmetrics.getFont(PDF_FONT)
    except KeyError:
        pdfmetrics.registerFont(UnicodeCIDFont(PDF_FONT))


def _wrap_text(pdf, text, width, font_name, font_size):
    content = str(text or "")
    if not content:
        return []

    lines = []
    for raw_line in content.split("\n"):
        if raw_line == "":
            lines.append("")
            continue

        current = ""
        for char in raw_line:
            candidate = current + char
            if current and pdf.stringWidth(candidate, font_name, font_size) > width:
                lines.append(current)
                current = char
            else:
                current = candidate
        if current:
            lines.append(current)
    return lines


def _draw_signature(pdf, sign_json, left, bottom, width, height):
    strokes = []
    if isinstance(sign_json, str):
        import json

        try:
            sign_json = json.loads(sign_json)
        except Exception:
            sign_json = None

    if isinstance(sign_json, dict):
        strokes = sign_json.get("strokes") or []

    pdf.setStrokeColor(colors.HexColor("#c9d4e5"))
    pdf.roundRect(left, bottom, width, height, 4 * mm, stroke=1, fill=0)

    pdf.setStrokeColor(colors.black)
    pdf.setLineCap(1)
    pdf.setLineJoin(1)
    pdf.setLineWidth(1.4)

    for stroke in strokes:
        points = stroke.get("points") if isinstance(stroke, dict) else None
        if not isinstance(points, list) or len(points) < 2:
            continue

        first = points[0]
        try:
            first_x = left + float(first.get("x", 0)) * width
            first_y = bottom + (1 - float(first.get("y", 0))) * height
        except Exception:
            continue

        path = pdf.beginPath()
        path.moveTo(first_x, first_y)
        for point in points[1:]:
            try:
                x = left + float(point.get("x", 0)) * width
                y = bottom + (1 - float(point.get("y", 0))) * height
            except Exception:
                continue
            path.lineTo(x, y)
        pdf.drawPath(path, stroke=1, fill=0)


def _format_money(value):
    try:
        return f"RM {float(value or 0):,.2f}"
    except Exception:
        return "RM 0.00"


def _format_datetime(value):
    if not value:
        return "-"
    return str(value).replace("T", " ").split(".")[0][:16]


def _payment_status_label(status):
    return {"checked": "已确认", "fail": "失败", "process": "处理中"}.get(status, status or "处理中")


def build_payment_report_pdf(payments):
    """Tabular收款审核 report — one row per payment plus a summary line."""
    _register_fonts()
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    pdf.setTitle("Payment Report")

    margin = 16 * mm
    # column layout: (label, x-offset from margin, width)
    columns = [
        ("#", 0, 14 * mm),
        ("付款人", 15 * mm, 34 * mm),
        ("来源", 50 * mm, 40 * mm),
        ("金额", 91 * mm, 26 * mm),
        ("状态", 118 * mm, 20 * mm),
        ("日期", 139 * mm, 39 * mm),
    ]

    def draw_header(y):
        pdf.setFont(PDF_FONT_BOLD, 16)
        pdf.setFillColor(colors.HexColor("#1f2d3d"))
        pdf.drawString(margin, y, "收款审核 Report")
        pdf.setFont(PDF_FONT, 9)
        pdf.setFillColor(colors.HexColor("#5d6678"))
        pdf.drawString(margin, y - 6 * mm, f"生成时间：{datetime.utcnow().isoformat(timespec='seconds')} UTC · 共 {len(payments)} 笔")
        row_y = y - 14 * mm
        pdf.setFont(PDF_FONT_BOLD, 9)
        pdf.setFillColor(colors.HexColor("#1f2d3d"))
        for label, dx, _w in columns:
            pdf.drawString(margin + dx, row_y, label)
        pdf.setStrokeColor(colors.HexColor("#c9d2e0"))
        pdf.line(margin, row_y - 2 * mm, width - margin, row_y - 2 * mm)
        return row_y - 8 * mm

    y = draw_header(height - margin)
    pdf.setFont(PDF_FONT, 9)
    pdf.setFillColor(colors.HexColor("#1f2d3d"))

    total_amount = 0.0
    checked_total = 0.0
    for payment in payments:
        if y < margin + 20 * mm:
            pdf.showPage()
            y = draw_header(height - margin)
            pdf.setFont(PDF_FONT, 9)
            pdf.setFillColor(colors.HexColor("#1f2d3d"))

        amount = float(payment.get("amount") or payment.get("price") or 0)
        total_amount += amount
        if payment.get("status") == "checked":
            checked_total += amount

        source = " / ".join(
            part for part in [payment.get("source_scope_label"), payment.get("source_label")] if part
        ) or "-"
        cells = [
            str(payment.get("id") or "-"),
            payment.get("name") or payment.get("nric") or "-",
            source,
            _format_money(amount),
            _payment_status_label(payment.get("status")),
            payment.get("date") or _format_datetime(payment.get("created_at")),
        ]
        for (label, dx, col_w), value in zip(columns, cells):
            text = str(value)
            while text and pdf.stringWidth(text, PDF_FONT, 9) > col_w - 2 * mm:
                text = text[:-1]
            pdf.drawString(margin + dx, y, text)
        y -= 6.5 * mm

    y -= 3 * mm
    pdf.setStrokeColor(colors.HexColor("#c9d2e0"))
    pdf.line(margin, y + 2 * mm, width - margin, y + 2 * mm)
    pdf.setFont(PDF_FONT_BOLD, 10)
    pdf.drawString(margin, y - 4 * mm, f"合计金额：{_format_money(total_amount)}")
    pdf.drawString(margin + 70 * mm, y - 4 * mm, f"已确认金额：{_format_money(checked_total)}")

    pdf.showPage()
    pdf.save()
    buffer.seek(0)
    return buffer


def _claim_report_status(claim):
    approvers = claim.get("approver_data") or []
    if any(item.get("reject") for item in approvers):
        return "已拒绝"
    if any(item.get("reject") is False for item in approvers):
        return "已批准"
    return "待处理"


def _safe_attachment_path(attachment):
    relative_path = str((attachment or {}).get("file_path") or "").strip()
    if not relative_path:
        return None

    root = DATA_ROOT.resolve()
    candidate = (root / Path(relative_path)).resolve()
    try:
        if not candidate.is_relative_to(root):
            return None
    except AttributeError:
        if root not in candidate.parents and candidate != root:
            return None

    return candidate if candidate.is_file() else None


def _is_pdf_attachment(attachment, path):
    mime_type = str((attachment or {}).get("mime_type") or "").split(";")[0].strip().lower()
    return mime_type == "application/pdf" or path.suffix.lower() == ".pdf"


def _is_image_attachment(attachment, path):
    mime_type = str((attachment or {}).get("mime_type") or "").split(";")[0].strip().lower()
    return mime_type.startswith("image/") or path.suffix.lower() in REPORT_IMAGE_EXTENSIONS


def _pdf_first_page_to_image(path):
    content = path.read_bytes()
    try:
        import pypdfium2 as pdfium

        document = pdfium.PdfDocument(content)
        if len(document) <= 0:
            return None
        page = document[0]
        bitmap = page.render(scale=2)
        return bitmap.to_pil().convert("RGB")
    except Exception:
        pass

    try:
        from pdf2image import convert_from_bytes

        pages = convert_from_bytes(content, dpi=180, first_page=1, last_page=1)
        if pages:
            return pages[0].convert("RGB")
    except Exception:
        return None

    return None


def _load_report_attachment_image(claim):
    try:
        from PIL import Image, ImageOps
    except Exception:
        return None, None

    for attachment in claim.get("attachments") or []:
        path = _safe_attachment_path(attachment)
        if not path:
            continue

        display_name = attachment.get("file_name") or os.path.basename(str(path))
        if _is_pdf_attachment(attachment, path):
            image = _pdf_first_page_to_image(path)
            if image:
                return image, f"{display_name} (PDF 第 1 页)"
            continue

        if not _is_image_attachment(attachment, path):
            continue

        try:
            with Image.open(path) as raw_image:
                image = ImageOps.exif_transpose(raw_image).convert("RGB").copy()
            return image, display_name
        except Exception:
            continue

    return None, None


def _draw_centered_image(pdf, image, left, bottom, width, height):
    image_width, image_height = image.size
    if image_width <= 0 or image_height <= 0:
        return

    scale = min(width / image_width, height / image_height)
    draw_width = image_width * scale
    draw_height = image_height * scale
    draw_left = left + (width - draw_width) / 2
    draw_bottom = bottom + (height - draw_height) / 2
    pdf.drawImage(ImageReader(image), draw_left, draw_bottom, width=draw_width, height=draw_height)


def _format_claim_line_items(line_items):
    """明细行渲染成「1. 项目 x2 RM 12.00」这样的多行文本。"""
    lines = []
    for index, item in enumerate(line_items or [], start=1):
        quantity = item.get("quantity")
        quantity_text = ""
        if quantity not in (None, ""):
            quantity_value = float(quantity)
            quantity_text = f"x{quantity_value:g}"
        parts = [
            f"{index}.",
            str(item.get("description") or "").replace("\n", " ").strip(),
            quantity_text,
            f"RM {float(item.get('amount') or 0):.2f}",
        ]
        lines.append(" ".join(part for part in parts if part))
    return "\n".join(lines)


def _claim_purpose_note(claim):
    return str(claim.get("purpose") or "").strip()


def _draw_claim_report_page(pdf, claim, index, total, page_width, page_height):
    margin = 14 * mm
    title_height = 13 * mm
    image_height = 155 * mm
    gap = 5 * mm
    info_top = page_height - margin - title_height - image_height - gap
    info_bottom = margin
    content_width = page_width - 2 * margin
    image_bottom = info_top + gap

    pdf.setFont(PDF_FONT_BOLD, 14)
    pdf.setFillColor(colors.HexColor("#1f2d3d"))
    pdf.drawString(margin, page_height - margin - 5 * mm, f"报销申请 Report #{claim.get('id')}")
    pdf.setFont(PDF_FONT, 9)
    pdf.setFillColor(colors.HexColor("#5d6b7a"))
    pdf.drawRightString(
        page_width - margin,
        page_height - margin - 5 * mm,
        f"{index} / {total}",
    )

    image, image_name = _load_report_attachment_image(claim)
    pdf.setStrokeColor(colors.HexColor("#d8e0ea"))
    pdf.setFillColor(colors.HexColor("#f8fafc"))
    pdf.roundRect(margin, image_bottom, content_width, image_height, 3 * mm, stroke=1, fill=1)

    image_padding = 4 * mm
    if image:
        _draw_centered_image(
            pdf,
            image,
            margin + image_padding,
            image_bottom + image_padding,
            content_width - 2 * image_padding,
            image_height - 2 * image_padding,
        )
    else:
        pdf.setFillColor(colors.HexColor("#7b8794"))
        pdf.setFont(PDF_FONT, 12)
        pdf.drawCentredString(margin + content_width / 2, image_bottom + image_height / 2, "没有可预览的图片或 PDF 附件")

    if image_name:
        pdf.setFillColor(colors.HexColor("#5d6b7a"))
        pdf.setFont(PDF_FONT, 8)
        pdf.drawString(margin + image_padding, image_bottom + 2 * mm, str(image_name)[:120])

    info_height = info_top - info_bottom
    pdf.setStrokeColor(colors.HexColor("#d8e0ea"))
    pdf.setFillColor(colors.white)
    pdf.roundRect(margin, info_bottom, content_width, info_height, 3 * mm, stroke=1, fill=1)

    left = margin + 5 * mm
    right = margin + content_width / 2 + 5 * mm
    y = info_top - 7 * mm
    col_width = content_width / 2 - 10 * mm

    def draw_kv(label, value, x, current_y):
        pdf.setFillColor(colors.HexColor("#5d6b7a"))
        pdf.setFont(PDF_FONT_BOLD, 8)
        pdf.drawString(x, current_y, label)
        pdf.setFillColor(colors.black)
        pdf.setFont(PDF_FONT, 9)
        lines = _wrap_text(pdf, value or "-", col_width - 24 * mm, PDF_FONT, 9)[:2]
        for offset, line in enumerate(lines or ["-"]):
            pdf.drawString(x + 23 * mm, current_y - offset * 4.2 * mm, line)
        return current_y - max(5.5 * mm, len(lines or ["-"]) * 4.2 * mm)

    left_y = y
    right_y = y
    left_y = draw_kv("申请人", claim.get("applicant_name"), left, left_y)
    left_y = draw_kv("金额", _format_money(claim.get("amount")), left, left_y)
    left_y = draw_kv("申请日期", claim.get("request_date"), left, left_y)
    left_y = draw_kv("部门", claim.get("department_name"), left, left_y)
    right_y = draw_kv("状态", _claim_report_status(claim), right, right_y)
    right_y = draw_kv("活动", claim.get("event_name") or (f"#{claim.get('event_id')}" if claim.get("event_id") else "-"), right, right_y)
    right_y = draw_kv("商家", claim.get("vendor_name"), right, right_y)
    right_y = draw_kv("采购日期", _format_datetime(claim.get("purchase_datetime")), right, right_y)

    y = min(left_y, right_y) - 2 * mm
    pdf.setStrokeColor(colors.HexColor("#eef2f6"))
    pdf.line(left, y, page_width - margin - 5 * mm, y)
    y -= 5 * mm

    def draw_block(label, value, current_y, max_lines):
        pdf.setFillColor(colors.HexColor("#5d6b7a"))
        pdf.setFont(PDF_FONT_BOLD, 8)
        pdf.drawString(left, current_y, label)
        current_y -= 4.2 * mm
        pdf.setFillColor(colors.black)
        pdf.setFont(PDF_FONT, 8.5)
        lines = _wrap_text(pdf, value or "-", content_width - 10 * mm, PDF_FONT, 8.5)[:max_lines]
        for line in lines or ["-"]:
            pdf.drawString(left, current_y, line)
            current_y -= 4 * mm
        return current_y - 1 * mm

    # 用途明细（line item）优先占版面，剩余空间才放文字说明
    line_items = claim.get("line_items") or []
    if line_items:
        y = draw_block("用途明细", _format_claim_line_items(line_items), y, 6)
    purpose_text = _claim_purpose_note(claim)
    if purpose_text and y > info_bottom + 13 * mm:
        draw_block("说明", purpose_text, y, 3)


def _draw_summary_page(pdf, claims, page_width, page_height):
    margin = 18 * mm
    content_width = page_width - 2 * margin
    y = page_height - margin

    pdf.setTitle("Claim Report")
    pdf.setFont(PDF_FONT_BOLD, 16)
    pdf.setFillColor(colors.HexColor("#1f2d3d"))
    pdf.drawString(margin, y, "报销申请 Report 总结")
    y -= 10 * mm

    total_amount = sum(float(claim.get("amount") or 0) for claim in claims)
    status_counts = {"已批准": 0, "已拒绝": 0, "待处理": 0}
    department_totals = {}
    for claim in claims:
        status_counts[_claim_report_status(claim)] += 1
        department = claim.get("department_name") or "-"
        department_totals[department] = department_totals.get(department, 0) + float(claim.get("amount") or 0)

    pdf.setFont(PDF_FONT, 11)
    summary_lines = [
        f"报销申请数量：{len(claims)}",
        f"总金额：{_format_money(total_amount)}",
        f"状态：已批准 {status_counts['已批准']}，待处理 {status_counts['待处理']}，已拒绝 {status_counts['已拒绝']}",
        f"生成时间：{datetime.utcnow().isoformat(timespec='seconds')} UTC",
    ]
    for line in summary_lines:
        pdf.drawString(margin, y, line)
        y -= 7 * mm

    y -= 4 * mm
    pdf.setFont(PDF_FONT_BOLD, 12)
    pdf.drawString(margin, y, "部门金额")
    y -= 7 * mm
    pdf.setFont(PDF_FONT, 10)
    for department, amount in sorted(department_totals.items(), key=lambda item: item[0])[:12]:
        pdf.drawString(margin, y, f"{department}: {_format_money(amount)}")
        y -= 5.5 * mm

    y -= 5 * mm
    pdf.setFont(PDF_FONT_BOLD, 12)
    pdf.drawString(margin, y, "单号清单")
    y -= 7 * mm
    pdf.setFont(PDF_FONT, 9)
    claim_ids = "、".join(f"#{claim.get('id')}" for claim in claims)
    for line in _wrap_text(pdf, claim_ids, content_width, PDF_FONT, 9)[:12]:
        pdf.drawString(margin, y, line)
        y -= 5 * mm


def build_payment_voucher_pdf(data, approver_list):
    _register_fonts()
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    margin = 18 * mm
    x = margin
    y = height - margin

    def draw_title(text):
        nonlocal y
        pdf.setFont(PDF_FONT_BOLD, 16)
        pdf.drawString(x, y, text)
        y -= 10 * mm

    def draw_kv(label, value):
        nonlocal y
        pdf.setFont(PDF_FONT_BOLD, 10)
        pdf.drawString(x, y, f"{label}:")
        pdf.setFont(PDF_FONT, 10)
        wrapped = _wrap_text(pdf, value if value is not None else "-", width - 2 * margin - 34 * mm, PDF_FONT, 10)[:4]
        for index, line in enumerate(wrapped):
            pdf.drawString(x + 32 * mm, y - index * 5.5 * mm, line)
        y -= max(6.5 * mm, 5.5 * mm * max(1, len(wrapped)))

    def draw_section(text):
        nonlocal y
        y -= 2 * mm
        pdf.setFont(PDF_FONT_BOLD, 12)
        pdf.setFillColor(colors.HexColor("#1f2d3d"))
        pdf.drawString(x, y, text)
        pdf.setFillColor(colors.black)
        y -= 7 * mm

    def ensure_space(min_y=35 * mm):
        nonlocal y
        if y < min_y:
            pdf.showPage()
            y = height - margin

    pdf.setTitle(f"Payment Voucher #{data['id']}")
    draw_title(f"Payment Voucher 付款凭证  (#{data['id']})")

    draw_section("Request Info 基础资料")
    draw_kv("Applicant 申请人", data.get("applicant_name"))
    draw_kv("Date 日期", data.get("request_date"))
    draw_kv("Amount 金额", f"RM {float(data.get('amount') or 0):.2f}")
    draw_kv("Department 部门", data.get("department_name") or "-")
    draw_kv(
        "Event 活动",
        data.get("event_name")
        or (f"#{data.get('event_id')}" if data.get("event_id") else "-"),
    )
    draw_kv("Created 建立时间", data.get("created_at"))

    ensure_space()
    draw_section("Purpose 用途")
    purpose = data.get("purpose") or ""
    pdf.setFont(PDF_FONT, 10)
    max_width = width - 2 * margin
    lines = _wrap_text(pdf, purpose, max_width, PDF_FONT, 10)

    for line in lines[:80]:
        ensure_space()
        pdf.drawString(x, y, line)
        y -= 5.5 * mm

    line_items = data.get("line_items") or []
    if line_items:
        ensure_space()
        draw_section("Items 用途明细")
        pdf.setFont(PDF_FONT, 10)
        for line in _format_claim_line_items(line_items).split("\n"):
            for wrapped in _wrap_text(pdf, line, max_width, PDF_FONT, 10)[:3]:
                ensure_space()
                pdf.drawString(x, y, wrapped)
                y -= 5.5 * mm
        ensure_space()
        pdf.setFont(PDF_FONT_BOLD, 10)
        pdf.drawString(x, y, f"Total 合计: RM {float(data.get('amount') or 0):.2f}")
        y -= 6.5 * mm

    ensure_space()
    draw_section("Attachments 附件")
    attachments = data.get("attachments") or []
    if not attachments:
        pdf.setFont(PDF_FONT, 10)
        pdf.drawString(x, y, "- None -")
        y -= 6.5 * mm
    else:
        pdf.setFont(PDF_FONT, 10)
        for index, attachment in enumerate(attachments, 1):
            ensure_space()
            name = attachment.get("file_name") or attachment.get("file_path")
            wrapped = _wrap_text(pdf, f"{index}. {name}", max_width, PDF_FONT, 10)[:3]
            for line in wrapped:
                pdf.drawString(x, y, line)
                y -= 5.5 * mm

    ensure_space()
    draw_section("Approvals 审批记录")
    if not approver_list:
        pdf.setFont(PDF_FONT, 10)
        pdf.drawString(x, y, "- None -")
        y -= 6.5 * mm
    else:
        for approver in approver_list:
            ensure_space()
            rejected = bool(approver.get("reject"))
            pdf.setFillColor(colors.red if rejected else colors.green)
            pdf.rect(x, y - 3.2 * mm, 4 * mm, 4 * mm, fill=1, stroke=0)
            pdf.setFillColor(colors.black)
            pdf.setFont(PDF_FONT, 10)
            pdf.drawString(
                x + 6 * mm,
                y,
                f"user_id={approver.get('user_id')}  |  "
                f"{'REJECT' if rejected else 'APPROVE'}  |  "
                f"{approver.get('decided_at') or '-'}",
            )
            y -= 6.5 * mm

    ensure_space()
    draw_section("Recipient Confirmation 收款确认")
    draw_kv("Full Name 全名", data.get("voucher_recipient_name") or "-")
    draw_kv("Signed At 签名时间", data.get("voucher_signed_at") or "-")
    ensure_space(65 * mm)
    pdf.setFont(PDF_FONT_BOLD, 10)
    pdf.drawString(x, y, "Recipient Signature 收款人签名:")
    y -= 4 * mm
    signature_height = 28 * mm
    _draw_signature(pdf, data.get("voucher_recipient_sign_json"), x, y - signature_height, width - 2 * margin, signature_height)
    y -= signature_height + 6 * mm

    ensure_space()
    y -= 3 * mm
    pdf.setFont(PDF_FONT, 9)
    pdf.setFillColor(colors.gray)
    pdf.drawString(x, y, f"Generated at {datetime.utcnow().isoformat()} UTC")
    pdf.setFillColor(colors.black)

    pdf.showPage()
    pdf.save()
    buffer.seek(0)
    return buffer


def build_claim_report_pdf(claims):
    _register_fonts()
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    total_claims = len(claims)

    pdf.setTitle("Claim Report")
    for index, claim in enumerate(claims, 1):
        _draw_claim_report_page(pdf, claim, index, total_claims, width, height)
        pdf.showPage()

    _draw_summary_page(pdf, claims, width, height)
    pdf.showPage()
    pdf.save()
    buffer.seek(0)
    return buffer
