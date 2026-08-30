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
    SOURCE_NAME_BY_PAIWEI_TYPE,
    get_deceased_point,
    get_owner_point,
    get_point_data,
    resolve_paiwei_pdf_template,
)
from .shared import item_price_int


# 单号标识：左上角二维码，右上角条码（条码自带下方号码）。
# 左右边距和上边距分开：顶上留白多，可以再往上贴一些。
CODE_MARGIN = 12
CODE_TOP_MARGIN = 5
QR_SIZE = 28
BARCODE_HEIGHT = 12
BARCODE_BAR_WIDTH = 0.9
BARCODE_FONT_SIZE = 8


# 有人拿「-」当「这里留空」填。原样印出来就是牌位上多一个横杠 ——
# 订单 781 就印成了「佛力超度 无缘子女-」和「显考 -」「显妣 -」。
# 全角／各种破折号都算，只由这类符号和空白组成的值一律当空。
_DASH_ONLY = re.compile(r"^[\s\-\u2010-\u2015\uFF0D\u30FC]*$")


def _clean_print_value(value):
    """打印用的值清洗：占位横杠当空值。空值在下游要么被 if 挡掉、要么被 filter 掉。"""
    if value is None:
        return value
    return "" if _DASH_ONLY.match(str(value)) else value


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
        value = _clean_print_value(field.field_value)
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

    preferred_font_path = STATIC_ROOT / "font" / "XinHuaKaiTi-1.ttf"
    if preferred_font_path.exists():
        try:
            pdfmetrics.registerFont(TTFont("XinHuaKaiTi", str(preferred_font_path)))
            font_name = "XinHuaKaiTi"
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

    # 牌位单号取「最小空缺号」而不是自增：清空未上板后号码可以回收复用，不会越长越大。
    used_ids = [pdf_id for (pdf_id,) in db.session.query(FahuiPrintPdf.id).order_by(FahuiPrintPdf.id).all()]
    next_id = 1
    for used in used_ids:
        if used > next_id:
            break
        next_id = used + 1

    new_pdf = FahuiPrintPdf(id=next_id, width=int(width), height=int(height))
    db.session.add(new_pdf)
    db.session.flush()
    for order_item_id in order_item_ids:
        db.session.add(FahuiPdfPageData(print_pdf_id=new_pdf.id, order_item_id=order_item_id))
    return new_pdf.id


def _draw_page_codes(c, barcode_id, page_width, page_height):
    """单号标识：左上角二维码，右上角条码 + 条码下方的号码。

    这里不吞异常：以前 except 掉之后牌位上会静悄悄地什么都没有，
    缺 qrcode 依赖这种问题要一直到看实体打印件才会发现。
    """
    import qrcode
    from reportlab.graphics.barcode import code128
    from reportlab.lib.utils import ImageReader

    value = str(barcode_id)

    buf = io.BytesIO()
    qrcode.make(value).save(buf, format="PNG")
    buf.seek(0)
    # drawImage 的 y 是图片底边，贴顶要减掉边长。
    c.drawImage(
        ImageReader(buf),
        CODE_MARGIN,
        page_height - CODE_TOP_MARGIN - QR_SIZE,
        width=QR_SIZE,
        height=QR_SIZE,
    )

    # humanReadable 让 reportlab 自己在条码下方排号码，省得手动对齐。
    barcode = code128.Code128(
        value,
        barHeight=BARCODE_HEIGHT,
        barWidth=BARCODE_BAR_WIDTH,
        humanReadable=True,
        fontSize=BARCODE_FONT_SIZE,
    )
    # drawOn 的 y 是条杠底边，号码画在它下面；对齐顶边要再减掉条杠高度。
    barcode.drawOn(
        c,
        page_width - CODE_MARGIN - barcode.width,
        page_height - CODE_TOP_MARGIN - BARCODE_HEIGHT,
    )


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
                    _draw_page_codes(c, barcode_id, width, height)
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
            _draw_page_codes(c, barcode_id, width, height)

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


# 同一列的格心在 point.json 里会差个一两点（例如 paiwei_10 的 292 / 293），
# 不聚类的话一列会被拆成两列，裁出来的图宽窄不一。
_GRID_CLUSTER_TOLERANCE = 8.0

# 背景模板扫一遍就够，结果按文件 mtime 缓存在进程里。
_INK_SCAN_DPI = 72
_INK_THRESHOLD = 200
# 裁切留白上限；实际留白还会被相邻格子的空槽压到不超过一半，免得把隔壁带进来。
_CELL_MARGIN_PT = 20.0
_INK_BAND_CACHE: dict = {}


def _cluster_axis(values):
    """把相近的坐标归成同一行/列，返回 {原值: 该组的中心}。"""
    mapping = {}
    group = []
    for value in sorted(values):
        if group and value - group[-1] > _GRID_CLUSTER_TOLERANCE:
            center = sum(group) / len(group)
            mapping.update({item: center for item in group})
            group = []
        group.append(value)
    if group:
        center = sum(group) / len(group)
        mapping.update({item: center for item in group})
    return mapping


def _grid_bounds(values, low, high):
    # 相邻格心的中点当分界，最外侧顶到页边。
    bounds = {}
    for index, value in enumerate(values):
        start = low if index == 0 else (values[index - 1] + value) / 2.0
        end = high if index == len(values) - 1 else (value + values[index + 1]) / 2.0
        bounds[value] = (start, end)
    return bounds


def _flag_bands(flags, scale):
    bands = []
    start = None
    for index, flag in enumerate(flags):
        if flag and start is None:
            start = index
        elif not flag and start is not None:
            bands.append((start * scale, index * scale))
            start = None
    if start is not None:
        bands.append((start * scale, len(flags) * scale))
    return bands


def _merge_bands_to_count(bands, count):
    """把相邻间隙最小的band 依次合并，直到刚好剩 count 条；条数不够就放弃。

    一张牌位的线稿本身会断成好几段（华盖 / 直线 / 莲花 / 编号），段间只差两三点，
    而格与格之间隔着十几点的空槽 —— 从最小间隙开始合并正好先把同一张的碎片并回去。
    """
    bands = list(bands)
    if count <= 0 or len(bands) < count:
        return None
    while len(bands) > count:
        index = min(range(len(bands) - 1), key=lambda i: bands[i + 1][0] - bands[i][1])
        bands[index : index + 2] = [(bands[index][0], bands[index + 1][1])]
    return bands


def _band_margins(bands, low, high, maximum):
    """每条 band 能往外扩多少：不超过上限，也不超过和邻居空槽的一半。

    背景模板量到的只是线稿，牌位编号这类叠上去的字会落在线稿外面一点，
    所以要留白；但留过头就会把隔壁那张的边角带进来。
    """
    margins = []
    for index, (start, end) in enumerate(bands):
        before = start - low if index == 0 else start - bands[index - 1][1]
        after = high - end if index == len(bands) - 1 else bands[index + 1][0] - end
        margins.append(max(0.0, min(maximum, before / 2.0, after / 2.0)))
    return margins


def _template_ink_bands(source_name):
    """量出背景模板上每一格牌位的实际范围（PDF 点，top-origin）。

    直接按格心中点切会把隔壁那张的边角也带进来（格距 115pt，牌位本身只有 100pt），
    所以改成扫背景模板的墨迹投影，拿到真正的列 / 行范围。
    """
    path = resolve_paiwei_pdf_template(source_name)
    if not path:
        return None

    try:
        stamp = (str(path), path.stat().st_mtime_ns)
    except OSError:
        return None
    cached = _INK_BAND_CACHE.get(source_name)
    if cached and cached[0] == stamp:
        return cached[1]

    try:
        import fitz  # PyMuPDF
        from PIL import Image
    except ImportError:
        return None

    try:
        document = fitz.open(str(path))
        try:
            page = document[0]
            width, height = page.rect.width, page.rect.height
            pixmap = page.get_pixmap(dpi=_INK_SCAN_DPI, colorspace=fitz.csGRAY)
            image = Image.frombytes("L", (pixmap.width, pixmap.height), pixmap.samples)
        finally:
            document.close()
        mask = image.point(lambda value: 1 if value < _INK_THRESHOLD else 0, mode="1")
        col_flags, row_flags = mask.getprojection()
    except Exception:  # noqa: BLE001
        return None

    result = (
        _flag_bands(col_flags, width / max(1, len(col_flags))),
        _flag_bands(row_flags, height / max(1, len(row_flags))),
    )
    _INK_BAND_CACHE[source_name] = (stamp, result)
    return result


def paiwei_cell_boxes(point_data, source_name):
    """算出模板每一格在页面里的范围，返回比例值 (x0, y0, x1, y1)、左上角原点。

    顺序和 generate_paiwei 里 sorted(point_dict) 的排版顺序一致。
    优先用背景模板的墨迹范围；量不出来（模板缺失 / 段数对不上）就回落成按格心中点切。
    """
    from reportlab.lib.pagesizes import A4, landscape

    width, height = landscape(A4) if source_name == "paiwei_5" else A4

    point_dict = {}
    for block in point_data or []:
        point_dict.update(block)
    positions = sorted(point_dict.keys())
    if not positions:
        return []

    centers = {}
    for key in positions:
        for point in point_dict.get(key, []):
            if "center_point" in point:
                centers[key] = (float(point["center_point"][0]), float(point["center_point"][1]))
                break
    if len(centers) != len(positions):
        return []

    x_groups = _cluster_axis({center[0] for center in centers.values()})
    y_groups = _cluster_axis({center[1] for center in centers.values()})
    columns = sorted(set(x_groups.values()))            # 左 → 右
    rows = sorted(set(y_groups.values()), reverse=True)  # 上 → 下（PDF 的 y 越大越靠上）

    measured = _template_ink_bands(source_name)
    col_bands = row_bands = None
    if measured:
        col_bands = _merge_bands_to_count(measured[0], len(columns))
        row_bands = _merge_bands_to_count(measured[1], len(rows))

    if col_bands and row_bands:
        col_margins = _band_margins(col_bands, 0.0, width, _CELL_MARGIN_PT)
        row_margins = _band_margins(row_bands, 0.0, height, _CELL_MARGIN_PT)
        boxes = []
        for key in positions:
            col_index = columns.index(x_groups[centers[key][0]])
            row_index = rows.index(y_groups[centers[key][1]])
            cx0, cx1 = col_bands[col_index]
            ry0, ry1 = row_bands[row_index]
            cm, rm = col_margins[col_index], row_margins[row_index]
            boxes.append(
                (
                    max(0.0, cx0 - cm) / width,
                    max(0.0, ry0 - rm) / height,
                    min(width, cx1 + cm) / width,
                    min(height, ry1 + rm) / height,
                )
            )
        return boxes

    x_bounds = _grid_bounds(columns, 0.0, width)
    y_bounds = _grid_bounds(sorted(set(y_groups.values())), 0.0, height)
    boxes = []
    for key in positions:
        x0, x1 = x_bounds[x_groups[centers[key][0]]]
        y0, y1 = y_bounds[y_groups[centers[key][1]]]
        # PDF 原点在左下，图片在左上：y 要翻过来
        boxes.append((x0 / width, (height - y1) / height, x1 / width, (height - y0) / height))
    return boxes


def generate_paiwei_preview_cells(order_item_ids):
    """预览用：生成合并 PDF，并算出每一张牌位落在第几页的哪一格。

    分组方式和 generate_paiwei_using_order_item_ids 完全一样，只是额外记下
    「第 N 张牌位 → 第几页第几格」，好把 5 联 / 10 联的整版裁成单张。
    返回 (buffer, cells)；cell["box"] 为 None 表示这一页没有格子概念，整页当一张。
    """
    items = FahuiOrderItem.query.filter(FahuiOrderItem.id.in_(order_item_ids)).all()
    if not items:
        return None, []

    filtered_data = filter_fahui_data(items)
    if not filtered_data:
        return None, []

    try:
        from pypdf import PdfReader
        from pypdf import PdfWriter as _PdfMerger
    except ImportError:
        return None, []

    grouped_data = defaultdict(list)
    for item in filtered_data:
        grouped_data[item.get("code")].append(item)

    merger = _PdfMerger()
    cells = []
    page_offset = 0
    for code, grouped_items in grouped_data.items():
        point_data, source_name = get_point_data(code)
        if point_data:
            buffer = generate_paiwei(code, grouped_items, point_data, source_name)
            boxes = paiwei_cell_boxes(point_data, source_name)
        else:
            buffer = _generate_simple_paiwei_pdf(code, grouped_items)
            boxes = []

        buffer.seek(0)
        page_count = len(PdfReader(buffer).pages)
        buffer.seek(0)
        merger.append(buffer)

        if boxes:
            per_page = len(boxes)
            for index, entry in enumerate(grouped_items):
                page = page_offset + index // per_page
                if page >= page_offset + page_count:
                    break
                cells.append(
                    {
                        "order_id": entry.get("order_id"),
                        "item_id": entry.get("id"),
                        "code": code,
                        "page": page,
                        "box": boxes[index % per_page],
                    }
                )
        else:
            for offset in range(page_count):
                entry = grouped_items[offset] if offset < len(grouped_items) else grouped_items[-1]
                cells.append(
                    {
                        "order_id": entry.get("order_id"),
                        "item_id": entry.get("id"),
                        "code": code,
                        "page": page_offset + offset,
                        "box": None,
                    }
                )

        page_offset += page_count

    output = io.BytesIO()
    merger.write(output)
    merger.close()
    output.seek(0)
    return output, cells


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


def _compress_pdf(pdf_bytes: bytes) -> bytes:
    """用 PyMuPDF 的 garbage=4 去重相同对象（重复的牌位底图）+ deflate 压缩。

    底图 PDF 在逐页 merge 时被重复嵌入，去重后体积通常可缩小数倍。
    PyMuPDF 不可用或压缩失败时原样返回。
    """
    if not pdf_bytes:
        return pdf_bytes
    try:
        import fitz  # PyMuPDF
    except Exception:  # noqa: BLE001
        return pdf_bytes
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        buffer = io.BytesIO()
        doc.save(buffer, garbage=4, deflate=True, deflate_images=True, deflate_fonts=True, clean=True)
        doc.close()
        compressed = buffer.getvalue()
        return compressed if compressed and len(compressed) < len(pdf_bytes) else pdf_bytes
    except Exception:  # noqa: BLE001
        return pdf_bytes


def group_source_items(order_ids, source_name, item_ids=None):
    """挑出属于某牌位模板的 items，按 code 分组。返回 (grouped_dict, total_item_count)。

    item_ids 给了就按 item 精确取（打印弹窗算完张数后提交的就是这份 id 列表，
    保证「弹窗上看到几张」和「实际印出几张」永远一致）；否则按整张订单取。
    """
    source_name = str(source_name or "").strip()
    if source_name not in {"paiwei_1", "paiwei_5", "paiwei_10"}:
        return {}, 0

    query = FahuiOrderItem.query.join(FahuiOrder)
    if item_ids is not None:
        query = query.filter(FahuiOrderItem.id.in_([int(value) for value in item_ids]))
    else:
        query = query.filter(FahuiOrder.id.in_(order_ids))
    items = query.all()
    if not items:
        return {}, 0

    filtered_data = filter_fahui_data(items)
    grouped_data = defaultdict(list)
    for item in filtered_data:
        code = str(item.get("code") or "")
        if SOURCE_NAME_BY_PAIWEI_TYPE.get(code) == source_name:
            grouped_data[code].append(item)

    total = sum(len(items) for items in grouped_data.values())
    return grouped_data, total


def generate_paiwei_pdf_by_source(order_ids, source_name, need_barcode=False, progress_cb=None, item_ids=None):
    """按牌位模板分组（paiwei_1 大 / paiwei_5 小 / paiwei_10 冤亲债主）生成单个合并 PDF。

    复用既有的定位配置（location_json / point.json），只挑出属于该模板的 code。
    progress_cb(n) 会在渲染过程中被调用（n=本次新增的已处理项数），用于进度上报。
    """
    grouped_data, _total = group_source_items(order_ids, source_name, item_ids=item_ids)
    if not grouped_data:
        return None

    try:
        from pypdf import PdfWriter as _PdfMerger
    except ImportError:
        try:
            from pypdf import PdfMerger as _PdfMerger
        except ImportError:
            from PyPDF2 import PdfMerger as _PdfMerger

    merger = _PdfMerger()
    for code, grouped_items in grouped_data.items():
        point_data, resolved_source = get_point_data(code)
        if point_data:
            buffer = generate_paiwei(
                code, grouped_items, point_data, resolved_source, need_barcode=need_barcode, progress_cb=progress_cb
            )
        else:
            buffer = _generate_simple_paiwei_pdf(code, grouped_items, need_barcode=need_barcode)
            if progress_cb:
                progress_cb(len(grouped_items))
        buffer.seek(0)
        merger.append(buffer)

    output = io.BytesIO()
    merger.write(output)
    merger.close()
    return io.BytesIO(_compress_pdf(output.getvalue()))


def pdf_pages_for_reprint(pdf_ids, source_name):
    """按牌位单号（print_pdf.id）取每一页的 item 列表，只保留属于该模板的页。

    返回 [(pdf_id, [order_item_id, ...]), ...]，顺序照调用方给的单号。
    重印必须一页一页单独渲染：`_get_or_create_print_pdf` 是拿「这一页的 item 集合」
    去匹配已有记录的，混在一起重新分页会凑出别的组合，于是又发一个新单号出来。
    """
    source_name = str(source_name or "").strip()
    wanted = [int(value) for value in (pdf_ids or [])]
    if source_name not in {"paiwei_1", "paiwei_5", "paiwei_10"} or not wanted:
        return []

    pages = (
        db.session.query(FahuiPdfPageData)
        .join(FahuiOrderItem, FahuiPdfPageData.order_item_id == FahuiOrderItem.id)
        .filter(FahuiPdfPageData.print_pdf_id.in_(wanted))
        .all()
    )
    by_pdf = defaultdict(list)
    for page in pages:
        item = page.order_item
        if not item:
            continue
        if SOURCE_NAME_BY_PAIWEI_TYPE.get(str(item.code or "")) != source_name:
            continue
        by_pdf[page.print_pdf_id].append(item.id)

    result = []
    for pdf_id in dict.fromkeys(wanted):  # 去重且保持调用方给的顺序
        item_ids = sorted(by_pdf.get(pdf_id, []))
        if item_ids:
            result.append((pdf_id, item_ids))
    return result


def generate_paiwei_pdf_by_pdf_ids(pdf_ids, source_name, need_barcode=True, progress_cb=None):
    """按牌位单号重印：逐页渲染再合并，单号原样复用，不会重新发号。"""
    groups = pdf_pages_for_reprint(pdf_ids, source_name)
    if not groups:
        return None

    try:
        from pypdf import PdfWriter as _PdfMerger
    except ImportError:
        try:
            from pypdf import PdfMerger as _PdfMerger
        except ImportError:
            from PyPDF2 import PdfMerger as _PdfMerger

    merger = _PdfMerger()
    for _pdf_id, item_ids in groups:
        buffer = generate_paiwei_using_order_item_ids(item_ids, need_barcode=need_barcode)
        if buffer is None:
            continue
        buffer.seek(0)
        merger.append(buffer)
        if progress_cb:
            progress_cb(1)

    output = io.BytesIO()
    merger.write(output)
    merger.close()
    return io.BytesIO(_compress_pdf(output.getvalue()))


def generate_paiwei(paiwei_type, fahui_data, point_data, source_name, need_barcode=False, progress_cb=None):
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
                # 冤亲债主：阳上是从固定的顶点往下写的，名字越长整列越往下坠
                # （5 个字的末字比 3 个字低两个字距）。超过 3 个字就每多一个字往上提半个字，
                # 让这一列看着还是居中的。3 个字及以内保持原位 —— 那是最常见的情况，
                # 动了等于把现有牌位的版式全改了。
                if source_name == "paiwei_10" and len(name) > 3:
                    y_start += (len(name) - 3) * ospace / 2.0
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

            # 超度亡灵刚好「一考一妣」时，左右是固定的：妣在右、考在左，不跟录入顺序走。
            #
            # 以前这里是无脑 reversed()，等于假定录入一定是「考在前」；录成
            # ['显妣','显考'] 的（例如订单 674 / item 3915）就被翻反了。
            # 而且 points[0] 到底是左还是右，两套模板还相反：
            #     大牌位 deceased '2' -> [[-30,..],[+30,..]]   points[0] 在左
            #     小牌位 deceased '2' -> [[+10,..],[-10,..]]   points[0] 在右
            # 所以不能按下标排，要按点位实际的 x 排。
            forced = False
            if len(people) == 2 and len(points) >= 2:
                for male, female in (("显考", "显妣"), ("祖考", "祖妣")):
                    pair = [str(rel).strip() for rel in relations[:2]]
                    if male not in pair or female not in pair:
                        continue
                    right_slot = 0 if points[0][0] >= points[1][0] else 1
                    slots: list = [None, None]
                    slots[right_slot] = pair.index(female)
                    slots[1 - right_slot] = pair.index(male)
                    people = [people[i] for i in slots]
                    relations = [relations[i] for i in slots]
                    forced = True
                    break

            if not forced:
                for first, second in [("显考", "显妣"), ("祖考", "祖妣")]:
                    if first in relations and second in relations:
                        people = list(reversed(people))
                        relations = list(reversed(relations))
                        break

            # 同一个人挂多个关系（例如 曹振华 既是「亡夫」又是「亡父」）：
            # 关系还是排在原来那两栏的位置，名字只印一次、接在关系下面并左右居中。
            named_relations = [str(rel).strip() for rel in relations[: len(people)] if str(rel or "").strip()]
            if len(people) > 1 and len(set(people)) == 1 and len(named_relations) > 1:
                name = people[0]
                side_points = deceased_point.get(str(len(named_relations))) or points
                if len(side_points) < len(named_relations):
                    side_points = points
                # point.json 里 3 人以上的位置全是同一个 x（等于没排版），
                # 真撞上就按字号自己均分成几栏，免得几个关系叠在一起。
                used = side_points[: len(named_relations)]
                if len({round(point[0], 3) for point in used}) < len(used):
                    _ox, oy, osize, ospace = used[0]
                    step = osize + max(2.0, osize * 0.2)
                    first = -step * (len(used) - 1) / 2.0 - osize / 2.0
                    side_points = [
                        (first + index * step, oy, osize, ospace) for index in range(len(used))
                    ]

                c.setFillColor(colors.black)
                columns = []
                for index, relation in enumerate(named_relations[: len(side_points)]):
                    ox, oy, osize, ospace = side_points[index]
                    c.setFont(font_name, osize)
                    for char_index, char in enumerate(relation):
                        c.drawString(x_base + ox, y_base + oy - char_index * ospace, char)
                    columns.append((ox, osize, oy - (len(relation) - 1) * ospace))

                # 名字用单人牌位的字号（就一个名字），横向落在几栏关系的正中间，
                # 纵向接在最低的那栏关系下面。「关系 名字」本来就是靠一个空格分开的，
                # 这里照样空开一格：关系的行距 + 名字自己的行距。
                center_points = deceased_point.get("1") or side_points
                _cx, _cy, name_size, name_space = center_points[0]
                left = min(ox for ox, _size, _bottom in columns)
                right = max(ox + _size for ox, _size, _bottom in columns)
                blank = max(size for _ox, size, _bottom in columns)
                name_x = (left + right - name_size) / 2.0
                name_y = min(bottom for _ox, _size, bottom in columns) - blank - name_space

                c.setFont(font_name, name_size)
                for char_index, char in enumerate(name):
                    c.drawString(x_base + name_x, y_base + name_y - char_index * name_space, char)
                return

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
            elif paiwei_type in ["A2", "B2"]:
                xiankao = xianbi = " "
                center_text = ""
            elif paiwei_type in ["A3", "B3"]:
                # 无缘子女没有显考/显妣；父母作为阳上另外排（见下方 owner 分支）。
                xiankao = xianbi = " "
                center_text = " "
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

            owner_text = info.get("owner", "")
            if paiwei_type in ["A3", "B3"]:
                # 无缘子女：父母是在生的阳上，要排在「阳上」下面，
                # 不能占显考/显妣那两个点位（那是给历代祖先牌位用的）。
                owner_names = owner_text if isinstance(owner_text, list) else [
                    name for name in re.split(r"[,\s]+", str(owner_text).strip()) if name
                ]
                for label, key in (("父", "father"), ("母", "mother")):
                    value = info.get(key)
                    if not value:
                        continue
                    values = value if isinstance(value, list) else [value]
                    owner_names += [f"{label} {str(one).strip()}" for one in values if str(one).strip()]
                draw_text_vertical(position, "owner", owner_names, base_x, base_y, info)
            else:
                draw_text_vertical(position, "owner", owner_text, base_x, base_y, info)
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
                _draw_page_codes(c, barcode_id, width, height)

        if drew_on_page:
            c.showPage()

        if progress_cb:
            progress_cb(min(items_per_page, total_items - page_start))

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
