"""订单牌位清单 PDF：按牌位类型分段列表，供核对 / 存档 / 交给法师念诵。

和导出 xlsx 走同一份数据（list_orders_for_export），只是排成人看的表格：
每种牌位一个段落，段内一行一张牌位。

只收三类正式牌位；随缘供斋（D/D1）不印牌位，无缘子女（A3/B3）内容格式不同，
都不放进这份清单。

排版是给法师现场念的，不是给后台对账的：不印单号（念的时候没人看单号），
字号按老花眼放大到 19pt，一页少放几行没关系。段落标题做成表格的重复表头，
翻到第几页都还看得见现在念的是哪一段。

这份只用黑白机印，所以整份就是纯黑白：文字和格线一律 #000，不留任何浅灰
或带蓝的调子（屏幕上分得出的 2%~5% 网点，印到纸上就是白纸一张）。
底色只保留两级中性灰——表头 20%、斑马纹 10%——够分行又不糊字。
"""

from __future__ import annotations

import io

# 版心宽度：A4 减左右各 14mm 页边距，约 515pt，各段列宽都按这个数分。
CONTENT_WIDTH = 515

SECTIONS = [
    {
        "title": "超度历代祖先",
        "codes": ("SS", "A1", "B1"),
        "headers": ["堂号", "阳上", "显考", "显妣"],
        "widths": [165, 160, 95, 95],
    },
    {
        "title": "超度亡灵",
        "codes": ("A2", "B2"),
        "headers": ["亡者", "阳上"],
        "widths": [315, 200],
    },
    {
        # 牌位内容固定是「冤亲债主」，一张牌位只有阳上姓名，
        # 所以不按牌位一行一行排，把名字铺成方格，一行放 4 个，省纸也好扫。
        "title": "超度冤亲债主",
        "codes": ("C",),
        "headers": ["阳上"],
        "grid_columns": 4,
        "unit": "人",
    },
]

_CODE_SECTION = {code: index for index, section in enumerate(SECTIONS) for code in section["codes"]}


def _values(item: dict, key: str) -> list[str]:
    """一个字段可能有多行（阳上、亡者都能填多个人）。"""
    out = []
    for entry in (item.get("item_form_data") or {}).get(key) or []:
        text = str((entry or {}).get("val") or "").strip()
        if text:
            out.append(text)
    return out


def _joined(item: dict, key: str) -> str:
    return "、".join(_values(item, key))


def _row(item: dict, section_index: int) -> list[str]:
    title = SECTIONS[section_index]["title"]

    if title == "超度历代祖先":
        surname = "".join(_values(item, "surname"))
        suffix = "".join(_values(item, "suffix")) or "门堂上历代祖先"
        return [f"{surname}{suffix}", _joined(item, "owner"),
                _joined(item, "father"), _joined(item, "mother")]

    if title == "超度亡灵":
        # 关系和名字一一对应，配不齐的就只写名字
        names = _values(item, "deceased")
        relations = _values(item, "relation")
        people = [
            f"{relations[index]} {name}".strip() if index < len(relations) else name
            for index, name in enumerate(names)
        ]
        return ["、".join(people), _joined(item, "owner")]

    # 冤亲债主：一张牌位可能填了好几个阳上，这里拆成一个个名字，后面再铺格子。
    return _values(item, "owner")


def _grid_rows(names: list[str], columns: int) -> list[list[str]]:
    """把名字按每行 columns 个铺开，最后一行不满就补空格子（补齐才画得出边框）。"""
    rows = []
    for start in range(0, len(names), columns):
        row = names[start:start + columns]
        rows.append(row + [""] * (columns - len(row)))
    return rows


def build_orders_pdf(orders: list[dict], version: str = "") -> io.BytesIO:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Table, TableStyle

    # 正文用宋体：这是给人看的清单，不是牌位，楷体反而不好认。
    font_name = "STSong-Light"
    try:
        pdfmetrics.getFont(font_name)
    except KeyError:
        pdfmetrics.registerFont(UnicodeCIDFont(font_name))

    title_style = ParagraphStyle("t", fontName=font_name, fontSize=26, leading=32, spaceAfter=6)
    meta_style = ParagraphStyle("m", fontName=font_name, fontSize=13, leading=18,
                                textColor=colors.black, spaceAfter=10)
    cell_style = ParagraphStyle("c", fontName=font_name, fontSize=19, leading=25)
    head_style = ParagraphStyle("h", fontName=font_name, fontSize=19, leading=25,
                                textColor=colors.black)

    # 前两段一张牌位一行；冤亲债主先攒名字，最后统一铺格子。
    buckets: list[list[list[str]]] = [[] for _ in SECTIONS]
    for order in orders:
        for item in order.get("order_items") or []:
            index = _CODE_SECTION.get(str(item.get("code") or ""))
            if index is None:
                continue
            row = _row(item, index)
            if SECTIONS[index].get("grid_columns"):
                buckets[index].extend([name] for name in row)
            else:
                buckets[index].append(row)

    output = io.BytesIO()
    doc = SimpleDocTemplate(
        output, pagesize=A4,
        leftMargin=14 * mm, rightMargin=14 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
        title=f"牌位清单 {version}".strip(),
    )

    flow = []
    for index, section in enumerate(SECTIONS):
        entries = buckets[index]
        if not entries:
            continue
        if flow:
            flow.append(PageBreak())

        columns = section.get("grid_columns")
        if columns:
            rows = _grid_rows([entry[0] for entry in entries], columns)
            widths = [CONTENT_WIDTH / columns] * columns
        else:
            rows = entries
            widths = section["widths"]

        # 标题和小计做成表格的前两行，连同抬头一起进 repeatRows —— 翻页时
        # reportlab 会自己重画，法师念到第几页都知道现在念的是哪一段。
        def _span_row(text: str, style_: object) -> list:
            return [Paragraph(text, style_)] + [""] * (len(widths) - 1)

        header_row = [Paragraph(h, head_style) for h in section["headers"]]
        header_row += [""] * (len(widths) - len(header_row))

        data = [
            _span_row(section["title"], title_style),
            _span_row(f"{version}　共 {len(entries)} {section.get('unit', '张')}", meta_style),
            header_row,
        ]
        data += [[Paragraph(cell or "", cell_style) for cell in row] for row in rows]

        style = [
            ("FONTNAME", (0, 0), (-1, -1), font_name),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            # 标题 / 小计两行横跨整行，且不画格线，看着还是「段落抬头」不是表格内容
            ("SPAN", (0, 0), (-1, 0)),
            ("SPAN", (0, 1), (-1, 1)),
            ("LEFTPADDING", (0, 0), (-1, 1), 0),
            ("TOPPADDING", (0, 0), (-1, 1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 0),
            ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
            ("BACKGROUND", (0, 2), (-1, 2), colors.HexColor("#cccccc")),
            ("LINEBELOW", (0, 2), (-1, 2), 1.5, colors.black),
            ("GRID", (0, 2), (-1, -1), 0.75, colors.black),
            ("TOPPADDING", (0, 2), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 2), (-1, -1), 6),
            ("ROWBACKGROUNDS", (0, 3), (-1, -1), [colors.white, colors.HexColor("#e5e5e5")]),
        ]
        if columns:
            # 方格排法只有「阳上」一个抬头，横跨整行
            style.append(("SPAN", (0, 2), (-1, 2)))

        table = Table(data, colWidths=widths, repeatRows=3)
        table.setStyle(TableStyle(style))
        flow.append(table)

    if not flow:
        flow.append(Paragraph("没有可列出的牌位", title_style))

    def _footer(canvas, _doc):
        canvas.saveState()
        canvas.setFont(font_name, 9)
        canvas.setFillColor(colors.black)
        canvas.drawRightString(A4[0] - 14 * mm, 8 * mm, f"第 {canvas.getPageNumber()} 页")
        canvas.restoreState()

    doc.build(flow, onFirstPage=_footer, onLaterPages=_footer)
    output.seek(0)
    return output
