from __future__ import annotations

import io
import re
import zipfile
from collections import defaultdict
from io import BytesIO

from flask import jsonify, send_file

from app.paths import STATIC_ROOT
from models import db
from models.fahui import FahuiOrder, FahuiOrderItem, FahuiPdfPageData, FahuiPrintPdf

from ..common.ylp_storage import preferred_dir, resolve_existing_path
from .print_points import (
    get_deceased_point,
    get_owner_point,
    get_point_data,
    resolve_paiwei_pdf_template,
)
from .shared import item_price_int


def _serialize_print_item(item: FahuiOrderItem) -> dict:
    data = {
        "id": item.id,
        "order_id": item.order_id,
        "code": item.code,
        "item_name": item.item_name,
        "price": item_price_int(item),
        "item_form_data": {},
    }
    for field in item.form_data or []:
        key = field.field_name or ""
        value = field.field_value
        if key in data["item_form_data"]:
            existing = data["item_form_data"][key]
            if isinstance(existing, list):
                existing.append(value)
            else:
                data["item_form_data"][key] = [existing, value]
        else:
            data["item_form_data"][key] = value
    return data


def filter_fahui_data(items):
    items_sorted = sorted(items, key=lambda item: item.id or 0)
    fahui_data = [_serialize_print_item(item) for item in items_sorted]
    return [item for item in fahui_data if not str(item.get("code", "")).startswith("D")]


def _ensure_font():
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.pdfbase.ttfonts import TTFont

    font_name = "STSong-Light"
    try:
        pdfmetrics.getFont(font_name)
    except KeyError:
        pdfmetrics.registerFont(UnicodeCIDFont(font_name))

    preferred_font_path = STATIC_ROOT / "font" / "仓耳曾国藩体.ttf"
    if preferred_font_path.exists():
        try:
            pdfmetrics.registerFont(TTFont("CangEr-ZengGuoFan", str(preferred_font_path)))
            font_name = "CangEr-ZengGuoFan"
        except Exception:
            pass
    else:
        kai_path = resolve_existing_path("kai.ttf")
        if kai_path:
            try:
                pdfmetrics.registerFont(TTFont("TW-Kai", str(kai_path)))
                font_name = "TW-Kai"
            except Exception:
                pass
    return font_name


def _get_or_create_print_pdf(order_item_ids, width, height):
    if not order_item_ids:
        return None

    order_item_id_set = set(order_item_ids)
    candidate_pdfs = (
        db.session.query(FahuiPrintPdf)
        .join(FahuiPdfPageData)
        .filter(FahuiPdfPageData.order_item_id.in_(order_item_ids))
        .all()
    )
    for pdf in candidate_pdfs:
        existing_ids = {page.order_item_id for page in (pdf.pages or [])}
        if existing_ids == order_item_id_set:
            return pdf.id

    new_pdf = FahuiPrintPdf(width=int(width), height=int(height))
    db.session.add(new_pdf)
    db.session.flush()
    for order_item_id in order_item_ids:
        db.session.add(FahuiPdfPageData(print_pdf_id=new_pdf.id, order_item_id=order_item_id))
    return new_pdf.id


def _draw_qr(c, barcode_id, font_name):
    try:
        import qrcode
        from reportlab.lib.utils import ImageReader

        buf = io.BytesIO()
        img = qrcode.make(str(barcode_id))
        img.save(buf, format="PNG")
        buf.seek(0)
        qr_img = ImageReader(buf)
        c.drawImage(qr_img, 5, 5, width=50, height=50)
    except Exception:
        pass

    c.setFont(font_name, 10)
    c.drawString(22, 50, str(barcode_id))


def _merge_overlay_with_background(overlay_buffer: BytesIO, background_path) -> BytesIO:
    if not background_path or not background_path.exists():
        overlay_buffer.seek(0)
        return overlay_buffer

    try:
        from pypdf import PdfReader, PdfWriter
    except ModuleNotFoundError:
        try:
            from PyPDF2 import PdfReader, PdfWriter
        except ModuleNotFoundError:
            overlay_buffer.seek(0)
            return overlay_buffer

    overlay_buffer.seek(0)
    overlay_reader = PdfReader(overlay_buffer)
    writer = PdfWriter()
    for overlay_page in overlay_reader.pages:
        background_reader = PdfReader(str(background_path))
        background_page = background_reader.pages[0]
        background_page.merge_page(overlay_page)
        writer.add_page(background_page)

    output = BytesIO()
    writer.write(output)
    output.seek(0)
    return output


def _generate_simple_paiwei_pdf(code, fahui_data, need_barcode=False):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    font_name = _ensure_font()
    output = BytesIO()
    c = canvas.Canvas(output, pagesize=A4)
    width, height = A4
    y = height - 50
    page_order_item_ids = []

    for index, item in enumerate(fahui_data, start=1):
        if y < 100:
            if need_barcode and page_order_item_ids:
                barcode_id = _get_or_create_print_pdf(page_order_item_ids, width, height)
                if barcode_id:
                    _draw_qr(c, barcode_id, font_name)
            c.showPage()
            c.setFont(font_name, 11)
            y = height - 50
            page_order_item_ids = []

        page_order_item_ids.append(item["id"])
        c.setFont(font_name, 14)
        c.drawString(36, y, f"{code} / {item.get('item_name') or '-'} / 订单 {item.get('order_id')}")
        y -= 20
        c.setFont(font_name, 11)
        grouped = item.get("item_form_data", {})
        for key, raw_value in grouped.items():
            values = raw_value if isinstance(raw_value, list) else [raw_value]
            joined = " / ".join(str(value) for value in values if value not in (None, ""))
            c.drawString(48, y, f"{key}: {joined}")
            y -= 15
            if y < 80:
                break
        y -= 10

    if need_barcode and page_order_item_ids:
        barcode_id = _get_or_create_print_pdf(page_order_item_ids, width, height)
        if barcode_id:
            _draw_qr(c, barcode_id, font_name)

    db.session.commit()
    c.save()
    output.seek(0)
    return output


def generate_paiwei_using_order_item_ids(order_item_ids, need_barcode=False):
    items = FahuiOrderItem.query.filter(FahuiOrderItem.id.in_(order_item_ids)).all()
    if not items:
        return None

    filtered_data = filter_fahui_data(items)
    if not filtered_data:
        return None

    # pypdf 3+ 移除了 PdfMerger，用 PdfWriter 代替（支持 append / write）。
    try:
        from pypdf import PdfWriter as _PdfMerger
    except ImportError:
        try:
            from pypdf import PdfMerger as _PdfMerger
        except ImportError:
            try:
                from PyPDF2 import PdfMerger as _PdfMerger
            except ImportError:
                return _generate_simple_paiwei_pdf("preview", filtered_data, need_barcode=need_barcode)

    grouped_data = defaultdict(list)
    for item in filtered_data:
        grouped_data[item.get("code")].append(item)

    merger = _PdfMerger()
    for code, grouped_items in grouped_data.items():
        point_data, source_name = get_point_data(code)
        if point_data:
            buffer = generate_paiwei(code, grouped_items, point_data, source_name, need_barcode=need_barcode)
        else:
            buffer = _generate_simple_paiwei_pdf(code, grouped_items, need_barcode=need_barcode)
        buffer.seek(0)
        merger.append(buffer)

    output = io.BytesIO()
    merger.write(output)
    merger.close()
    output.seek(0)
    return output


def generate_paiwei_using_order_ids(order_ids, need_barcode=False):
    items = FahuiOrderItem.query.join(FahuiOrder).filter(FahuiOrder.id.in_(order_ids)).all()
    if not items:
        return jsonify({"status": "error", "message": "没有找到对应的订单数据"}), 400

    filtered_data = filter_fahui_data(items)
    if not filtered_data:
        return jsonify({"status": "error", "message": "没有有效的法会数据"}), 400

    grouped_data = defaultdict(list)
    for item in filtered_data:
        grouped_data[item.get("code")].append(item)

    buffers = []
    for code, grouped_items in grouped_data.items():
        point_data, source_name = get_point_data(code)
        if point_data:
            buffer = generate_paiwei(code, grouped_items, point_data, source_name, need_barcode=need_barcode)
        else:
            buffer = _generate_simple_paiwei_pdf(code, grouped_items, need_barcode=need_barcode)
        buffers.append((code, buffer))

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zipf:
        for code, buffer in buffers:
            zipf.writestr(f"paiwei_{code}.pdf", buffer.getvalue())

    zip_buffer.seek(0)
    return send_file(
        zip_buffer,
        mimetype="application/zip",
        as_attachment=True,
        download_name="paiwei_files.zip",
    )


def generate_paiwei(paiwei_type, fahui_data, point_data, source_name, need_barcode=False):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas

    font_name = _ensure_font()

    if source_name == "paiwei_5":
        page_size = landscape(A4)
        owner_point = get_owner_point(source_name)
        deceased_point = get_deceased_point(source_name)
    elif source_name == "paiwei_1":
        page_size = A4
        owner_point = get_owner_point(source_name)
        deceased_point = get_deceased_point(source_name)
    else:
        page_size = A4
        owner_point = get_owner_point(source_name)
        deceased_point = get_deceased_point(source_name)

    overlay_buffer = BytesIO()
    c = canvas.Canvas(overlay_buffer, pagesize=page_size)
    width, height = page_size

    point_dict = {}
    for block in point_data or []:
        point_dict.update(block)

    positions = sorted(point_dict.keys())
    if not positions:
        return _generate_simple_paiwei_pdf(paiwei_type, fahui_data, need_barcode=need_barcode)

    def get_point(block_key, key):
        for point in point_dict.get(block_key, []):
            if f"{key}_point" in point:
                return point[f"{key}_point"]
        return None

    def draw_text_vertical(block_key, key, text, base_x, base_y, info):
        point = get_point(block_key, key)
        if not point:
            return

        dx, dy, size, spacing = point
        x_base = base_x + dx
        y_base = base_y + dy
        c.setFont(font_name, size)

        if key == "owner":
            people = text if isinstance(text, list) else re.split(r"[,\\s]+", str(text).strip())
            people = [name for name in people if name]
            points = owner_point.get(str(len(people)))
            if not points:
                return
            for index, name in enumerate(people[: len(points)]):
                ox, oy, osize, ospace = points[index]
                x = x_base + ox
                y_start = y_base + oy
                c.setFillColor(colors.black)
                c.setFont(font_name, osize)
                for char_index, char in enumerate(name):
                    c.drawString(x, y_start - char_index * ospace, char)
            return

        if key == "deceased":
            people = text if isinstance(text, list) else re.split(r"[,\\s]+", str(text).strip())
            people = [name for name in people if name]
            points = deceased_point.get(str(len(people)))
            if not points:
                return

            relations = info.get("relation", [])
            if isinstance(relations, str):
                relations = re.split(r"[,\\s]+", relations.strip())
            if len(relations) < len(people):
                relations += [""] * (len(people) - len(relations))

            for first, second in [("显考", "显妣"), ("祖考", "祖妣")]:
                if first in relations and second in relations:
                    people = list(reversed(people))
                    relations = list(reversed(relations))
                    break

            for index, name in enumerate(people[: len(points)]):
                relation = relations[index] if index < len(relations) else ""
                ox, oy, osize, ospace = points[index]
                x = x_base + ox
                y_start = y_base + oy
                c.setFillColor(colors.black)
                c.setFont(font_name, osize)
                for char_index, char in enumerate(f"{relation} {name}".strip()):
                    c.drawString(x, y_start - char_index * ospace, char)
            return

        if key == "order_id":
            c.setFillColor(colors.black)
            c.setFont(font_name, size)
            c.drawString(x_base, y_base, str(text))
            return

        c.setFillColor(colors.black)
        for index, char in enumerate(str(text or "")):
            c.drawString(x_base, y_base - index * spacing, char)

    items_per_page = len(positions)
    total_items = len(fahui_data)
    for page_start in range(0, total_items, items_per_page):
        drew_on_page = False
        page_order_item_ids = []

        for index, position in enumerate(positions):
            item_index = page_start + index
            if item_index >= total_items:
                break

            info = fahui_data[item_index]["item_form_data"]
            order_item_id = fahui_data[item_index]["id"]
            order_id = fahui_data[item_index].get("order_id")
            page_order_item_ids.append(order_item_id)

            center = get_point(position, "center")
            if not center:
                continue
            drew_on_page = True

            base_x, base_y, font_size, spacing = center
            if paiwei_type == "C":
                xiankao = xianbi = " "
                center_text = "冤亲债主"
            elif paiwei_type in ["A1", "B1"]:
                xiankao, xianbi = "显考 ", "显妣 "
                center_text = f"{info.get('surname', '')}{info.get('suffix', '门堂上历代祖先')}"
            elif paiwei_type in ["A2", "B2", "A3", "B3"]:
                xiankao = xianbi = " "
                center_text = "" if paiwei_type in ["A2", "B2"] else " "
            else:
                xiankao, xianbi = "显考 ", "显妣 "
                center_text = f"{info.get('surname', '')}{info.get('suffix', '')}"

            c.setFont(font_name, font_size)
            for char_index, char in enumerate(center_text):
                c.drawString(base_x, base_y - char_index * spacing, char)

            folichaodu = "佛力超度"
            if paiwei_type in ["A3", "B3"]:
                deceased = info.get("deceased", "")
                if deceased == "无缘子女":
                    deceased = ""
                folichaodu = f"佛力超度 无缘子女{deceased}"

            draw_text_vertical(position, "folichaodu", folichaodu, base_x, base_y, info)
            draw_text_vertical(position, "baijian", "拜荐", base_x, base_y, info)
            draw_text_vertical(position, "lianwei", "莲位", base_x, base_y, info)
            draw_text_vertical(position, "yangshang", "阳上", base_x, base_y, info)
            draw_text_vertical(position, "owner", info.get("owner", ""), base_x, base_y, info)
            if info.get("father"):
                draw_text_vertical(position, "father", f"{xiankao}{info['father']}", base_x, base_y, info)
            if info.get("mother"):
                draw_text_vertical(position, "mother", f"{xianbi}{info['mother']}", base_x, base_y, info)
            draw_text_vertical(position, "order_id", str(order_id), base_x, base_y, info)
            if paiwei_type not in ["A3", "B3"]:
                draw_text_vertical(position, "deceased", info.get("deceased", ""), base_x, base_y, info)

        if drew_on_page and need_barcode:
            barcode_id = _get_or_create_print_pdf(page_order_item_ids, width, height)
            if barcode_id:
                _draw_qr(c, barcode_id, font_name)

        if drew_on_page:
            c.showPage()

    db.session.commit()
    c.save()
    overlay_buffer.seek(0)

    output_dir = preferred_dir("paiwei_result")
    background_path = resolve_paiwei_pdf_template(source_name)
    final_buffer = _merge_overlay_with_background(overlay_buffer, background_path)

    if background_path:
        final_pdf_path = output_dir / f"{source_name}_{paiwei_type}_output.pdf"
        with open(final_pdf_path, "wb") as output_file:
            output_file.write(final_buffer.getvalue())
        final_buffer.seek(0)

    return final_buffer
