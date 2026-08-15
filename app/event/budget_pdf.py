"""活动财政报告 PDF：汇总预算页全部内容（不区分审批状态，全额计入）。"""

import os
from datetime import datetime, timedelta
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas
from werkzeug.utils import secure_filename

from app.paths import DATA_ROOT, STATIC_ROOT

# 优先用可内嵌的楷体 TTF（保证任何查看器都渲染一致），失败退回 Adobe CID 字体。
PDF_FONT = "STSong-Light"
EMBED_FONT_NAME = "XinHuaKaiTi"
EMBED_FONT_PATH = STATIC_ROOT / "font" / "XinHuaKaiTi-1.ttf"

INK = colors.HexColor("#1f2d3d")
MUTED = colors.HexColor("#5d6678")
LINE = colors.HexColor("#d8dfeb")
PANEL = colors.HexColor("#f2f6fb")
GREEN = colors.HexColor("#15803d")
RED = colors.HexColor("#b42318")

CLAIM_STATUS_LABELS = {"pending": "已提交", "approved": "已批准", "rejected": "被拒"}
PAYMENT_STATUS_LABELS = {"process": "处理中", "checked": "已确认", "fail": "失败"}


def _register_fonts():
    global PDF_FONT
    if EMBED_FONT_PATH.exists():
        try:
            pdfmetrics.getFont(EMBED_FONT_NAME)
            PDF_FONT = EMBED_FONT_NAME
            return
        except KeyError:
            pass
        try:
            from reportlab.pdfbase.ttfonts import TTFont

            pdfmetrics.registerFont(TTFont(EMBED_FONT_NAME, str(EMBED_FONT_PATH)))
            PDF_FONT = EMBED_FONT_NAME
            return
        except Exception:  # noqa: BLE001
            pass
    try:
        pdfmetrics.getFont("STSong-Light")
    except KeyError:
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    PDF_FONT = "STSong-Light"


def _money(value):
    if value is None:
        return "—"
    try:
        return f"{float(value):,.2f}"
    except Exception:  # noqa: BLE001
        return "—"


def _poster_reader(event):
    """活动海报（与 event_poster_response 同一路径规则），读不到返回 None。
    打印尺寸只有 24mm，先压成小图（JPEG）再嵌入，避免整张原图撑爆 PDF 体积。"""
    image = getattr(event, "event_image", None)
    if not image or not getattr(image, "id", None):
        return None
    try:
        from PIL import Image

        from models.event_data import AlbumFiles

        file = AlbumFiles.query.get(image.id)
        if not file:
            return None
        full_path = os.path.join(
            str(DATA_ROOT), "NAS", "UTBA", "event_photo",
            file.event.event_code, secure_filename(file.file_name),
        )
        if not os.path.exists(full_path):
            return None

        with Image.open(full_path) as img:
            img = img.convert("RGB")
            img.thumbnail((360, 360))
            thumb = BytesIO()
            img.save(thumb, format="JPEG", quality=82)
        thumb.seek(0)
        return ImageReader(thumb)
    except Exception:  # noqa: BLE001
        return None


def _row_status(row):
    if row.get("source") == "claim":
        return CLAIM_STATUS_LABELS.get((row.get("claim") or {}).get("status"), "")
    if row.get("source") == "manual_income":
        return PAYMENT_STATUS_LABELS.get((row.get("payment") or {}).get("status"), "")
    if row.get("source") == "registration":
        stats = row.get("stats") or {}
        text = f"{stats.get('total', 0)}人/付{stats.get('paid', 0)}/批{stats.get('approved', 0)}"
        if stats.get("removed_paid"):
            text += f"/移{stats['removed_paid']}"
        return text
    if row.get("source") == "fahui_ylp":
        stats = row.get("stats") or {}
        return f"{stats.get('total', 0)}单/付{stats.get('paid', 0)}/审{stats.get('approved', 0)}"
    return ""


def _full_actual(row):
    """实际金额（不检查 status，全额计入）。"""
    if row.get("source") == "manual_income":
        return float((row.get("payment") or {}).get("amount") or 0)
    value = row.get("actual_amount")
    return None if value is None else float(value or 0)


def _wrap(pdf, text, width, font_size):
    content = str(text or "")
    if not content:
        return [""]
    lines = []
    current = ""
    for char in content:
        candidate = current + char
        if current and pdf.stringWidth(candidate, PDF_FONT, font_size) > width:
            lines.append(current)
            current = char
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines or [""]


def build_event_finance_report_pdf(event, rows):
    """rows：与预算页同一份数据（report 模式，注册收入已含未批准款）。"""
    _register_fonts()
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    pdf.setTitle(f"{event.event_name or 'Event'} 财政报告")

    margin = 16 * mm
    content_w = width - margin * 2

    income = [r for r in rows if r.get("type") == "income"]
    expense = [r for r in rows if (r.get("type") or "expense") == "expense"]

    def sum_amounts(items, getter):
        total = 0.0
        for item in items:
            value = getter(item)
            if value is not None:
                total += value
        return total

    inc_budget = sum_amounts(income, lambda r: None if r.get("budget_amount") is None else float(r.get("budget_amount") or 0))
    exp_budget = sum_amounts(expense, lambda r: None if r.get("budget_amount") is None else float(r.get("budget_amount") or 0))
    inc_actual = sum_amounts(income, _full_actual)
    exp_actual = sum_amounts(expense, _full_actual)

    page_number = [1]

    def draw_footer():
        pdf.setFont(PDF_FONT, 8)
        pdf.setFillColor(MUTED)
        pdf.drawString(margin, 10 * mm, "本报告含全部预算记录（不区分审批状态），金额单位 RM。")
        pdf.drawRightString(width - margin, 10 * mm, f"第 {page_number[0]} 页")

    def new_page():
        draw_footer()
        pdf.showPage()
        page_number[0] += 1
        return height - margin

    # ---- 页眉：海报（左上小图）+ 标题 ----
    y = height - margin
    poster = _poster_reader(event)
    poster_box = 24 * mm
    text_x = margin
    if poster:
        try:
            iw, ih = poster.getSize()
            scale = min(poster_box / iw, poster_box / ih)
            dw, dh = iw * scale, ih * scale
            pdf.saveState()
            pdf.setStrokeColor(LINE)
            pdf.roundRect(margin, y - poster_box, poster_box, poster_box, 2 * mm, stroke=1, fill=0)
            pdf.drawImage(
                poster,
                margin + (poster_box - dw) / 2,
                y - poster_box + (poster_box - dh) / 2,
                dw,
                dh,
                preserveAspectRatio=True,
                mask="auto",
            )
            pdf.restoreState()
            text_x = margin + poster_box + 6 * mm
        except Exception:  # noqa: BLE001
            text_x = margin

    pdf.setFillColor(INK)
    pdf.setFont(PDF_FONT, 17)
    pdf.drawString(text_x, y - 7 * mm, f"{event.event_name or ''}")
    pdf.setFont(PDF_FONT, 12)
    pdf.setFillColor(MUTED)
    pdf.drawString(text_x, y - 13 * mm, "活动财政报告")

    meta_parts = []
    if getattr(event, "datetime", None):
        meta_parts.append(f"活动日期：{str(event.datetime)[:16]}")
    if getattr(event, "location", None):
        meta_parts.append(f"地点：{event.location}")
    generated = (datetime.utcnow() + timedelta(hours=8)).strftime("%Y-%m-%d %H:%M")
    meta_parts.append(f"生成：{generated} (MYT)")
    pdf.setFont(PDF_FONT, 9)
    pdf.drawString(text_x, y - 19 * mm, " · ".join(meta_parts)[:110])

    y -= max(poster_box, 21 * mm) + 7 * mm
    pdf.setStrokeColor(LINE)
    pdf.setLineWidth(0.8)
    pdf.line(margin, y, width - margin, y)
    y -= 8 * mm

    # ---- 表格列 ----
    col_cat_w = 72 * mm
    col_status_w = 26 * mm
    col_amt_w = 23 * mm
    remark_gap = 6 * mm
    col_remark_w = content_w - col_cat_w - col_status_w - col_amt_w * 2 - remark_gap
    x_cat = margin
    x_status = x_cat + col_cat_w
    x_budget = x_status + col_status_w + col_amt_w   # 右对齐基准
    x_actual = x_budget + col_amt_w
    x_remark = x_actual + remark_gap

    # y_pos 一律表示「行顶」；文字基线 = 行顶 − ascent，保证分隔线永远画在字的下方留白处。
    ascent = 4.0 * mm       # 9.5pt 字高 + 顶部留白
    leading = 4.8 * mm      # 多行行距
    bottom_pad = 2.2 * mm   # 基线到行底（分隔线）的留白

    def draw_table_header(y_pos):
        band_h = 7.5 * mm
        pdf.setFillColor(PANEL)
        pdf.rect(margin, y_pos - band_h, content_w, band_h, stroke=0, fill=1)
        pdf.setFillColor(MUTED)
        pdf.setFont(PDF_FONT, 9)
        base = y_pos - band_h + 2.4 * mm
        pdf.drawString(x_cat + 2 * mm, base, "类别")
        pdf.drawString(x_status, base, "状态")
        pdf.drawRightString(x_budget, base, "预算 RM")
        pdf.drawRightString(x_actual, base, "实际 RM")
        pdf.drawString(x_remark, base, "备注")
        return y_pos - band_h - 1.2 * mm

    def draw_section(y_pos, title, section_rows, subtotal_budget, subtotal_actual, accent):
        if y_pos < 50 * mm:
            y_pos = new_page()
        pdf.setFillColor(accent)
        pdf.setFont(PDF_FONT, 12.5)
        pdf.drawString(margin, y_pos - 4.4 * mm, title)
        y_pos -= 7.5 * mm
        y_pos = draw_table_header(y_pos)

        for row in section_rows:
            cat_lines = _wrap(pdf, row.get("category") or "", col_cat_w - 4 * mm, 9.5)[:2]
            remark_lines = _wrap(pdf, row.get("remark") or "", col_remark_w - 2 * mm, 8.5)[:2]
            line_count = max(len(cat_lines), len(remark_lines), 1)
            row_h = ascent + leading * (line_count - 1) + bottom_pad
            if y_pos - row_h < 24 * mm:
                y_pos = new_page()
                y_pos = draw_table_header(y_pos)

            base = y_pos - ascent
            pdf.setFillColor(INK)
            pdf.setFont(PDF_FONT, 9.5)
            for idx, line in enumerate(cat_lines):
                pdf.drawString(x_cat + 2 * mm, base - leading * idx, line)
            pdf.setFont(PDF_FONT, 8.5)
            pdf.setFillColor(MUTED)
            pdf.drawString(x_status, base, _row_status(row))
            pdf.setFillColor(INK)
            pdf.setFont(PDF_FONT, 9.5)
            pdf.drawRightString(x_budget, base, _money(row.get("budget_amount")))
            pdf.drawRightString(x_actual, base, _money(_full_actual(row)))
            pdf.setFont(PDF_FONT, 8.5)
            pdf.setFillColor(MUTED)
            for idx, line in enumerate(remark_lines):
                pdf.drawString(x_remark, base - leading * idx, line)

            y_pos -= row_h
            pdf.setStrokeColor(LINE)
            pdf.setLineWidth(0.4)
            pdf.line(margin, y_pos, width - margin, y_pos)

        if not section_rows:
            pdf.setFont(PDF_FONT, 9.5)
            pdf.setFillColor(MUTED)
            pdf.drawString(x_cat + 2 * mm, y_pos - ascent, "（无记录）")
            y_pos -= ascent + bottom_pad

        # 小计
        base = y_pos - ascent - 0.6 * mm
        pdf.setFont(PDF_FONT, 10)
        pdf.setFillColor(INK)
        pdf.drawString(x_cat + 2 * mm, base, "小计")
        pdf.drawRightString(x_budget, base, _money(subtotal_budget))
        pdf.drawRightString(x_actual, base, _money(subtotal_actual))
        return base - 10 * mm

    y = draw_section(y, "收入", income, inc_budget, inc_actual, GREEN)
    y = draw_section(y, "支出", expense, exp_budget, exp_actual, RED)

    # ---- 结余汇总框 ----
    if y < 40 * mm:
        y = new_page()
    box_h = 22 * mm
    pdf.setFillColor(PANEL)
    pdf.setStrokeColor(LINE)
    pdf.roundRect(margin, y - box_h, content_w, box_h, 2.5 * mm, stroke=1, fill=1)
    net_actual = inc_actual - exp_actual
    net_budget = inc_budget - exp_budget
    pdf.setFont(PDF_FONT, 11)
    pdf.setFillColor(INK)
    pdf.drawString(margin + 6 * mm, y - 8 * mm, "结余（收入 − 支出）")
    pdf.setFont(PDF_FONT, 14)
    pdf.setFillColor(RED if net_actual < 0 else GREEN)
    pdf.drawRightString(width - margin - 6 * mm, y - 8.5 * mm, f"RM {net_actual:,.2f}")
    pdf.setFont(PDF_FONT, 9)
    pdf.setFillColor(MUTED)
    pdf.drawString(margin + 6 * mm, y - 15.5 * mm, f"收入合计 RM {inc_actual:,.2f} · 支出合计 RM {exp_actual:,.2f}")
    pdf.drawRightString(width - margin - 6 * mm, y - 15.5 * mm, f"预算结余 RM {net_budget:,.2f}")

    draw_footer()
    pdf.save()
    buffer.seek(0)
    return buffer
