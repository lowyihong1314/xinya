from datetime import datetime
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas


PDF_FONT = "STSong-Light"
PDF_FONT_BOLD = "STSong-Light"


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
    draw_kv("Department 部门", data.get("department_name") or f"ID {data.get('department_id')}")
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
