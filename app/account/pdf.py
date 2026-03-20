from datetime import datetime
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


def build_payment_voucher_pdf(data, approver_list):
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    margin = 18 * mm
    x = margin
    y = height - margin

    def draw_title(text):
        nonlocal y
        pdf.setFont("Helvetica-Bold", 16)
        pdf.drawString(x, y, text)
        y -= 10 * mm

    def draw_kv(label, value):
        nonlocal y
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawString(x, y, f"{label}:")
        pdf.setFont("Helvetica", 10)
        pdf.drawString(x + 32 * mm, y, str(value if value is not None else "-"))
        y -= 6.5 * mm

    def draw_section(text):
        nonlocal y
        y -= 2 * mm
        pdf.setFont("Helvetica-Bold", 12)
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
    draw_title(f"PAYMENT VOUCHER  (#{data['id']})")

    draw_section("Request Info")
    draw_kv("Applicant", data.get("applicant_name"))
    draw_kv("Date", data.get("request_date"))
    draw_kv("Amount", f"RM {float(data.get('amount') or 0):.2f}")
    draw_kv("Department", data.get("department_name") or f"ID {data.get('department_id')}")
    draw_kv(
        "Event",
        data.get("event_name")
        or (f"#{data.get('event_id')}" if data.get("event_id") else "-"),
    )
    draw_kv("Created", data.get("created_at"))

    ensure_space()
    draw_section("Purpose")
    purpose = data.get("purpose") or ""
    pdf.setFont("Helvetica", 10)
    max_width = width - 2 * margin
    lines = []
    for raw_line in purpose.split("\n"):
        line = raw_line.strip()
        if not line:
            lines.append("")
            continue

        buffer_line = ""
        for char in line:
            candidate = buffer_line + char
            if pdf.stringWidth(candidate, "Helvetica", 10) > max_width:
                lines.append(buffer_line)
                buffer_line = char
            else:
                buffer_line = candidate
        if buffer_line:
            lines.append(buffer_line)

    for line in lines[:80]:
        ensure_space()
        pdf.drawString(x, y, line)
        y -= 5.5 * mm

    ensure_space()
    draw_section("Attachments")
    attachments = data.get("attachments") or []
    if not attachments:
        pdf.setFont("Helvetica", 10)
        pdf.drawString(x, y, "- None -")
        y -= 6.5 * mm
    else:
        pdf.setFont("Helvetica", 10)
        for index, attachment in enumerate(attachments, 1):
            ensure_space()
            name = attachment.get("file_name") or attachment.get("file_path")
            pdf.drawString(x, y, f"{index}. {name}")
            y -= 5.5 * mm

    ensure_space()
    draw_section("Approvals (latest per user)")
    if not approver_list:
        pdf.setFont("Helvetica", 10)
        pdf.drawString(x, y, "- None -")
        y -= 6.5 * mm
    else:
        for approver in approver_list:
            ensure_space()
            rejected = bool(approver.get("reject"))
            pdf.setFillColor(colors.red if rejected else colors.green)
            pdf.rect(x, y - 3.2 * mm, 4 * mm, 4 * mm, fill=1, stroke=0)
            pdf.setFillColor(colors.black)
            pdf.setFont("Helvetica", 10)
            pdf.drawString(
                x + 6 * mm,
                y,
                f"user_id={approver.get('user_id')}  |  "
                f"{'REJECT' if rejected else 'APPROVE'}  |  "
                f"{approver.get('decided_at') or '-'}",
            )
            y -= 6.5 * mm

    ensure_space()
    y -= 3 * mm
    pdf.setFont("Helvetica-Oblique", 9)
    pdf.setFillColor(colors.gray)
    pdf.drawString(x, y, f"Generated at {datetime.utcnow().isoformat()} UTC")
    pdf.setFillColor(colors.black)

    pdf.showPage()
    pdf.save()
    buffer.seek(0)
    return buffer
