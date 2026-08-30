"""D.I.Y 牌位：选一张模板底图，自己往上摆文字块，直接出单张 PDF。

专门应对法会当天临时加的牌位，或者格式特殊、套不进现成模板的那种。
和正常牌位（order_items → print_pdf → 看板）完全分开：不挂订单、不分版本、
不发牌位单号、不进贴板流程，就是一张纸。

坐标约定（前后端唯一的一份约定，改之前先看清楚）：
    x, y 单位都是 PDF 点（1/72 英寸），原点在**页面左上角**，y 向下为正。
    这样前端画布（左上角原点）可以按同一个数直接乘缩放比例，不用来回翻转。
    翻成 reportlab 的左下角原点只在 _draw_element 里做一次。

    竖排：y 是第一个字的顶边，往下逐字排。
    横排：y 是这一行文字的顶边。
"""

from __future__ import annotations

import io

from flask import Blueprint, jsonify, request, send_file
from flask_login import current_user

from app.form.permissions import permission_required_any
from app.paths import STATIC_ROOT
from models import db
from models.fahui import FahuiDiyPaiwei

from ..common.access import FAHUI_READ_PERMISSION_NAMES
from ..common.ylp_storage import preferred_dir
from .print_generator import _compress_pdf, _merge_overlay_with_background
from .print_points import load_location_points, resolve_paiwei_pdf_template

diy_paiwei_bp = Blueprint("diy_paiwei", __name__)

# 模板底图的页面尺寸（PDF 点）。和 database/paiwei_template/pdf/*.pdf 对应，
# 前端画布按这个比例铺背景图，所见即所得。
TEMPLATES = [
    {"source_name": "paiwei_SS", "label": "超大牌位", "width": 595.5, "height": 842.2},
    {"source_name": "paiwei_1", "label": "大牌位", "width": 595.5, "height": 842.2},
    {"source_name": "paiwei_5", "label": "小牌位", "width": 842.2, "height": 595.5},
    {"source_name": "paiwei_10", "label": "冤亲债主", "width": 595.5, "height": 842.2},
]
TEMPLATE_BY_NAME = {entry["source_name"]: entry for entry in TEMPLATES}

# 底图 PDF 的 MediaBox 左下角不在 (0,0)：paiwei_5 是 y0=8.58，另外两张是 7.83。
# overlay 盖上去的时候，文字相对「看得见的那块画面」会整体往下挪 y0 那么多。
# 正常牌位的生成器也吃这一份偏移（同一个 _merge_overlay_with_background），
# 所以 PDF 那头不用动 —— 动了反而和现有牌位对不上。
# 但网页画布铺的是按 CropBox 渲出来的图，不补这个偏移，画布就会比印出来的高一截。
_OFFSET_CACHE: dict = {}


def template_offset_y(source_name: str) -> float:
    """底图 MediaBox 的下边距，画布要拿它对齐 PDF 的实际落位。"""
    if source_name in _OFFSET_CACHE:
        return _OFFSET_CACHE[source_name]

    offset = 0.0
    background = resolve_paiwei_pdf_template(source_name)
    if background is not None and background.exists():
        try:
            import fitz  # PyMuPDF

            doc = fitz.open(str(background))
            if doc.page_count:
                offset = float(doc.load_page(0).mediabox.y0)
            doc.close()
        except Exception:  # noqa: BLE001
            offset = 0.0

    _OFFSET_CACHE[source_name] = offset
    return offset

MAX_ELEMENTS = 200
MIN_FONT_SIZE = 6.0
MAX_FONT_SIZE = 200.0

# 可选字体。file 指 static/font 下的文件名，浏览器也从同一个文件取 @font-face，
# 所以编辑器画布和印出来的 PDF 用的是同一套字形，不是「差不多的替代字体」。
#
# 只收 .ttf：reportlab 的 TTFont 认不了 CFF 轮廓的 .otf（NotoSansCJKsc / NotoSerifTC
# 都是这种，试过直接 TTFError），列进来只会在出图时炸。
# song 是 reportlab 内置的 CID 字体，没有文件可以喂给浏览器，网页端只能退回系统宋体。
DIY_FONTS = [
    {"id": "kai", "label": "新华楷体", "file": "XinHuaKaiTi-1.ttf", "rl_name": "DiyXinHuaKai"},
    {"id": "hakusyu", "label": "白舟楷书", "file": "HakusyuKaisyo_kk.ttf", "rl_name": "DiyHakusyuKai"},
    {"id": "zhuyan", "label": "仓耳竹言体", "file": "仓耳竹言体.ttf", "rl_name": "DiyCangErZhuYan"},
    {"id": "zengguofan", "label": "仓耳曾国藩体", "file": "仓耳曾国藩体.ttf", "rl_name": "DiyCangErZengGuoFan"},
    {"id": "keai", "label": "Aa 可爱体", "file": "AaKeAiNORiXiZhongWen2WanZi-2.ttf", "rl_name": "DiyAaKeAi"},
    {"id": "song", "label": "宋体（系统内置）", "file": None, "rl_name": "STSong-Light"},
]
FONT_BY_ID = {entry["id"]: entry for entry in DIY_FONTS}
DEFAULT_FONT_ID = "kai"

# 牌位一律黑字；留个白名单是给「朱笔」这类特殊写法用的，不开放任意 hex 免得印出一张彩色的。
ALLOWED_COLORS = {"#000000", "#8b0000", "#c2410c", "#1d4ed8"}
DEFAULT_COLOR = "#000000"


# 正常牌位每个字段印在哪 —— 拖动吸附和「一键落位」用的就是这份坐标，
# 和 print_generator 画正常牌位时读的是同一个 location_json，位置一定对得上。
ANCHOR_FIELD_LABELS = {
    "center": "中心主文",
    "folichaodu": "佛力超度",
    "baijian": "拜荐",
    "lianwei": "莲位",
    "yangshang": "阳上",
    "owner": "阳上名",
    "deceased": "对象 / 子女",
    "father": "显考 / 父",
    "mother": "显妣 / 母",
    "order_id": "单号",
}
# 出场顺序，面板上按这个排，找起来顺手
ANCHOR_FIELD_ORDER = list(ANCHOR_FIELD_LABELS.keys())


def build_anchors(source_name: str) -> list[dict]:
    """把 location_json 翻成 D.I.Y 这边的坐标（PDF 点 + 左上角原点）。

    location_json 里存的是：
        center_point = [绝对 x, 绝对 y(基线, 左下角原点), 字号, 字距]
        其余字段     = [相对 center 的 dx, dy, 字号, 字距]
    所以某字段的绝对基线 = center + 偏移，再翻成「第一个字的顶边」：
        y_topleft = 页高 - 基线 - 字号
    这条式子和 _draw_element 是互逆的，落上去就和正常牌位印的位置一模一样。
    """
    template = TEMPLATE_BY_NAME.get(source_name)
    blocks = load_location_points(source_name)
    if not template or not blocks:
        return []

    page_height = float(template["height"])
    anchors: list[dict] = []

    for block in blocks:
        if not isinstance(block, dict):
            continue
        for block_key, points in block.items():
            merged: dict[str, list] = {}
            for point in points or []:
                if isinstance(point, dict):
                    merged.update(point)

            center = merged.get("center_point")
            if not center or len(center) < 4:
                continue
            center_x, center_baseline = float(center[0]), float(center[1])

            for field in ANCHOR_FIELD_ORDER:
                raw = merged.get(f"{field}_point")
                if not raw or len(raw) < 4:
                    continue
                if field == "center":
                    x, baseline = center_x, center_baseline
                else:
                    x, baseline = center_x + float(raw[0]), center_baseline + float(raw[1])
                size = float(raw[2] or 20)
                anchors.append(
                    {
                        "key": f"{block_key}.{field}",
                        "block": str(block_key),
                        "field": field,
                        "label": f"{block_key} · {ANCHOR_FIELD_LABELS.get(field, field)}",
                        "x": round(x, 1),
                        "y": round(page_height - baseline - size, 1),
                        "font_size": round(size, 1),
                        "spacing": round(float(raw[3] or size), 1),
                    }
                )

    return anchors


# 新建一张牌位时先摆好的字块。位置直接取 A 格的锚点，所以和正常牌位印出来的一模一样，
# 开局就是一张能直接打印的牌位，只差把人名填上。
DEFAULT_FIELD_TEXTS = {
    "folichaodu": "佛力超度",
    "baijian": "拜荐",
    "lianwei": "莲位",
    "yangshang": "阳上",
}
# 中心主文：冤亲债主那张是固定四个字（和 print_generator 里 code C 的 center_text 一致）；
# 大/小牌位的中心是「X 门堂上历代祖先」，跟着姓氏走，留空让人自己填。
DEFAULT_CENTER_TEXT = {"paiwei_10": "冤亲债主"}


def build_default_elements(source_name: str) -> list[dict]:
    anchors = {a["field"]: a for a in build_anchors(source_name) if a["block"] == "A"}
    fields = list(DEFAULT_FIELD_TEXTS.keys())
    center_text = DEFAULT_CENTER_TEXT.get(source_name)
    if center_text:
        fields = ["center", *fields]

    elements = []
    for index, field in enumerate(fields):
        anchor = anchors.get(field)
        if not anchor:
            continue
        text = center_text if field == "center" else DEFAULT_FIELD_TEXTS[field]
        elements.append(
            {
                "id": f"d{index}_{field}",
                "text": text,
                "x": anchor["x"],
                "y": anchor["y"],
                "font_size": anchor["font_size"],
                "spacing": anchor["spacing"],
                "vertical": True,
                "font": DEFAULT_FONT_ID,
                "bold": False,
                "color": DEFAULT_COLOR,
            }
        )
    return elements


def _font_path(entry) -> "object | None":
    if not entry or not entry.get("file"):
        return None
    path = STATIC_ROOT / "font" / entry["file"]
    return path if path.exists() else None


def resolve_font(font_id: str) -> str:
    """把字体 id 换成 reportlab 里注册好的名字。注册过就直接用，注册不上退回楷体/宋体。"""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.pdfbase.ttfonts import TTFont

    entry = FONT_BY_ID.get(str(font_id or "")) or FONT_BY_ID[DEFAULT_FONT_ID]
    name = entry["rl_name"]
    try:
        pdfmetrics.getFont(name)
        return name
    except KeyError:
        pass

    path = _font_path(entry)
    if path is not None:
        try:
            pdfmetrics.registerFont(TTFont(name, str(path)))
            return name
        except Exception:  # noqa: BLE001
            pass

    # 没文件（宋体）或者文件坏了：退回 reportlab 内置的 CID 宋体，至少不会出不了图
    try:
        pdfmetrics.getFont("STSong-Light")
    except KeyError:
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    return "STSong-Light"


def _clamp(value, low, high, fallback):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if number != number:  # NaN
        return fallback
    return max(low, min(high, number))


def _normalize_element(raw, index: int) -> dict | None:
    """前端来的东西一律不信：数字夹到合理范围，文字砍长度，坏的直接丢掉。"""
    if not isinstance(raw, dict):
        return None

    text = str(raw.get("text") or "")
    if not text.strip():
        return None

    font_size = _clamp(raw.get("font_size"), MIN_FONT_SIZE, MAX_FONT_SIZE, 24.0)
    # 行距/字距默认按字号的 1.15 倍，够用又不会挤在一起
    spacing = _clamp(raw.get("spacing"), 1.0, MAX_FONT_SIZE * 2, round(font_size * 1.15, 2))

    font_id = str(raw.get("font") or "")
    color = str(raw.get("color") or "").lower()

    return {
        "id": str(raw.get("id") or f"e{index}")[:64],
        "text": text[:200],
        "x": _clamp(raw.get("x"), -2000, 4000, 0.0),
        "y": _clamp(raw.get("y"), -2000, 4000, 0.0),
        "font_size": font_size,
        "spacing": spacing,
        "vertical": bool(raw.get("vertical", True)),
        "font": font_id if font_id in FONT_BY_ID else DEFAULT_FONT_ID,
        "bold": bool(raw.get("bold")),
        "color": color if color in ALLOWED_COLORS else DEFAULT_COLOR,
    }


def _normalize_elements(raw_list) -> list[dict]:
    if not isinstance(raw_list, list):
        return []
    elements = []
    for index, raw in enumerate(raw_list[:MAX_ELEMENTS]):
        element = _normalize_element(raw, index)
        if element:
            elements.append(element)
    return elements


def _normalize_source(raw) -> str:
    name = str(raw or "").strip()
    return name if name in TEMPLATE_BY_NAME else "paiwei_1"


def _draw_element(canvas, element: dict, page_height: float):
    """把一个文字块画到 canvas 上。

    传进来的 y 是左上角原点，这里翻成 PDF 的左下角原点：
    第 i 个字的基线 = page_height - (y + font_size + i * spacing)。
    前端画布用的是同一条式子，所以所见即所得。
    """
    from reportlab.lib.colors import HexColor

    size = float(element.get("font_size") or 24.0)
    spacing = float(element.get("spacing") or size * 1.15)
    x = float(element.get("x") or 0.0)
    y_top = float(element.get("y") or 0.0)
    text = str(element.get("text") or "")
    font_name = resolve_font(element.get("font"))
    color = HexColor(element.get("color") or DEFAULT_COLOR)
    bold = bool(element.get("bold"))

    def put(line: str, index: int):
        baseline = page_height - y_top - size - index * spacing
        textobject = canvas.beginText(x, baseline)
        textobject.setFont(font_name, size)
        textobject.setFillColor(color)
        if bold:
            # 没有真正的粗体字重，用「填充 + 描边」把笔画加粗（PDF 文字渲染模式 2）。
            textobject.setStrokeColor(color)
            canvas.setLineWidth(max(0.3, size * 0.028))
            textobject.setTextRenderMode(2)
        textobject.textOut(line)
        canvas.drawText(textobject)

    if element.get("vertical"):
        # 竖排：一个字一行往下走
        for index, char in enumerate(char for char in text if char != "\n"):
            put(char, index)
        return

    # 横排：\n 手动分行，行距同 spacing
    for line_index, line in enumerate(text.split("\n")):
        put(line, line_index)


def render_diy_pdf(source_name: str, elements: list[dict]) -> io.BytesIO:
    """出图：文字画在一张透明 overlay 上，再盖到模板底图 PDF 上。"""
    from reportlab.lib import colors
    from reportlab.pdfgen import canvas as pdf_canvas

    template = TEMPLATE_BY_NAME.get(source_name) or TEMPLATE_BY_NAME["paiwei_1"]
    width = float(template["width"])
    height = float(template["height"])

    overlay = io.BytesIO()
    canvas = pdf_canvas.Canvas(overlay, pagesize=(width, height))
    canvas.setFillColor(colors.black)

    for element in elements or []:
        _draw_element(canvas, element, height)

    canvas.showPage()
    canvas.save()
    overlay.seek(0)

    background = resolve_paiwei_pdf_template(source_name)
    merged = _merge_overlay_with_background(overlay, background)
    # 底图是 4MB 起跳的扫描件，不压一下单张牌位就是 4.5MB。
    return io.BytesIO(_compress_pdf(merged.getvalue()))


@diy_paiwei_bp.route("/templates", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_templates_route():
    data = [{**entry, "offset_y": round(template_offset_y(entry["source_name"]), 2)} for entry in TEMPLATES]
    return jsonify({"status": "success", "data": data})


@diy_paiwei_bp.route("/templates/<source_name>/anchors", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def template_anchors_route(source_name: str):
    return jsonify({"status": "success", "data": build_anchors(_normalize_source(source_name))})


@diy_paiwei_bp.route("/templates/<source_name>/defaults", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def template_defaults_route(source_name: str):
    return jsonify({"status": "success", "data": build_default_elements(_normalize_source(source_name))})


@diy_paiwei_bp.route("/fonts", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_fonts_route():
    """字体清单。web=True 的可以让浏览器下载同一个字体文件做 @font-face，编辑器所见即所得。"""
    data = []
    for entry in DIY_FONTS:
        path = _font_path(entry)
        data.append(
            {
                "id": entry["id"],
                "label": entry["label"],
                "web": path is not None,
                # 前端拿来提示「这个字体 22MB，第一次要等一下」
                "size_kb": int(path.stat().st_size / 1024) if path is not None else 0,
            }
        )
    return jsonify({"status": "success", "data": data, "default": DEFAULT_FONT_ID, "colors": sorted(ALLOWED_COLORS)})


@diy_paiwei_bp.route("/fonts/<font_id>/file", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def font_file_route(font_id: str):
    entry = FONT_BY_ID.get(str(font_id or ""))
    path = _font_path(entry)
    if path is None:
        return jsonify({"status": "error", "message": "这个字体没有可下载的文件"}), 404
    # 字体文件不会变，缓存 30 天；22MB 的楷体只有第一次要等
    return send_file(path, mimetype="font/ttf", max_age=2592000)


@diy_paiwei_bp.route("/templates/<source_name>/image", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def template_image_route(source_name: str):
    """编辑器画布用的底图。渲一次缓存到磁盘，之后直接走静态文件 + 浏览器缓存。"""
    source_name = _normalize_source(source_name)
    cache_dir = preferred_dir("paiwei_result", "diy_template")
    cache_file = cache_dir / f"{source_name}.png"
    if cache_file.exists():
        return send_file(cache_file, mimetype="image/png", max_age=2592000)

    background = resolve_paiwei_pdf_template(source_name)
    if not background or not background.exists():
        return jsonify({"status": "error", "message": f"缺少模板底图 {source_name}.pdf"}), 404

    try:
        import fitz  # PyMuPDF

        doc = fitz.open(str(background))
        if doc.page_count == 0:
            return jsonify({"status": "error", "message": "模板 PDF 没有内容"}), 500
        # 110 dpi：编辑器上够清楚，文件也不至于几 MB
        doc.load_page(0).get_pixmap(dpi=110).save(str(cache_file))
        doc.close()
    except Exception as exc:  # noqa: BLE001
        return jsonify({"status": "error", "message": str(exc)}), 500

    return send_file(cache_file, mimetype="image/png", max_age=2592000)


@diy_paiwei_bp.route("", methods=["GET"])
@diy_paiwei_bp.route("/", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def list_diy_route():
    keyword = (request.args.get("value") or "").strip()
    query = FahuiDiyPaiwei.query
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(db.or_(FahuiDiyPaiwei.title.like(like), FahuiDiyPaiwei.note.like(like)))
    rows = query.order_by(FahuiDiyPaiwei.updated_at.desc(), FahuiDiyPaiwei.id.desc()).all()
    return jsonify(
        {
            "status": "success",
            "data": {"items": [row.to_dict(with_elements=False) for row in rows], "total": len(rows)},
        }
    )


@diy_paiwei_bp.route("/<int:diy_id>", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def get_diy_route(diy_id: int):
    row = FahuiDiyPaiwei.query.get(diy_id)
    if not row:
        return jsonify({"status": "error", "message": "找不到这张 D.I.Y 牌位"}), 404
    return jsonify({"status": "success", "data": row.to_dict()})


@diy_paiwei_bp.route("", methods=["POST"])
@diy_paiwei_bp.route("/", methods=["POST"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def create_diy_route():
    data = request.get_json(silent=True) or {}
    row = FahuiDiyPaiwei(
        title=str(data.get("title") or "未命名牌位")[:255],
        source_name=_normalize_source(data.get("source_name")),
        note=str(data.get("note") or "")[:500],
        elements=_normalize_elements(data.get("elements")),
        created_by=getattr(current_user, "id", None),
    )
    db.session.add(row)
    db.session.commit()
    return jsonify({"status": "success", "data": row.to_dict()})


@diy_paiwei_bp.route("/<int:diy_id>", methods=["PUT", "POST"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def update_diy_route(diy_id: int):
    row = FahuiDiyPaiwei.query.get(diy_id)
    if not row:
        return jsonify({"status": "error", "message": "找不到这张 D.I.Y 牌位"}), 404

    data = request.get_json(silent=True) or {}
    if "title" in data:
        row.title = str(data.get("title") or "未命名牌位")[:255]
    if "source_name" in data:
        row.source_name = _normalize_source(data.get("source_name"))
    if "note" in data:
        row.note = str(data.get("note") or "")[:500]
    if "elements" in data:
        row.elements = _normalize_elements(data.get("elements"))

    db.session.commit()
    return jsonify({"status": "success", "data": row.to_dict()})


@diy_paiwei_bp.route("/<int:diy_id>", methods=["DELETE"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def delete_diy_route(diy_id: int):
    row = FahuiDiyPaiwei.query.get(diy_id)
    if not row:
        return jsonify({"status": "error", "message": "找不到这张 D.I.Y 牌位"}), 404
    db.session.delete(row)
    db.session.commit()
    return jsonify({"status": "success"})


@diy_paiwei_bp.route("/<int:diy_id>/copy", methods=["POST"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def copy_diy_route(diy_id: int):
    row = FahuiDiyPaiwei.query.get(diy_id)
    if not row:
        return jsonify({"status": "error", "message": "找不到这张 D.I.Y 牌位"}), 404
    clone = FahuiDiyPaiwei(
        title=f"{row.title or '未命名牌位'} 副本"[:255],
        source_name=row.source_name,
        note=row.note,
        elements=list(row.elements or []),
        created_by=getattr(current_user, "id", None),
    )
    db.session.add(clone)
    db.session.commit()
    return jsonify({"status": "success", "data": clone.to_dict()})


@diy_paiwei_bp.route("/<int:diy_id>/pdf", methods=["GET"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def diy_pdf_route(diy_id: int):
    row = FahuiDiyPaiwei.query.get(diy_id)
    if not row:
        return jsonify({"status": "error", "message": "找不到这张 D.I.Y 牌位"}), 404

    output = render_diy_pdf(row.source_name or "paiwei_1", row.elements or [])
    title = (row.title or "diy_paiwei").replace("/", "_").replace("\\", "_")
    return send_file(
        output,
        mimetype="application/pdf",
        as_attachment=False,
        download_name=f"{title}.pdf",
    )


@diy_paiwei_bp.route("/preview", methods=["POST"])
@permission_required_any(*FAHUI_READ_PERMISSION_NAMES)
def diy_preview_route():
    """编辑中直接预览，不用先存。前端把当前画布内容原样发过来。"""
    data = request.get_json(silent=True) or {}
    output = render_diy_pdf(_normalize_source(data.get("source_name")), _normalize_elements(data.get("elements")))
    return send_file(output, mimetype="application/pdf", as_attachment=False, download_name="diy_preview.pdf")
