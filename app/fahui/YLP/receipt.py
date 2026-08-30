from __future__ import annotations

import os
import socket

from .shared import item_price_decimal


PRINTER_IP = os.getenv("XINYA_RECEIPT_PRINTER_IP", "192.168.68.43")
PRINTER_PORT = int(os.getenv("XINYA_RECEIPT_PRINTER_PORT", "9100"))

FAHUI_TYPE = {
    "SS": "超大牌位_超度历代祖先",
    "A1": "大牌位_超度历代祖先",
    "A2": "大牌位_超度亡灵",
    "A3": "大牌位_无缘子女",
    "B1": "小牌位_超度历代祖先",
    "B2": "小牌位_超度亡灵",
    "B3": "小牌位_无缘子女",
    "D1": "普度贡品",
    "C": "超度冤亲债主",
    "D": "随缘供斋",
}


def _escpos_init():
    return b"\x1b\x40"


def _escpos_align(mode="left"):
    mapping = {"left": 0, "center": 1, "right": 2}
    return b"\x1b\x61" + bytes([mapping.get(mode, 0)])


def _escpos_bold(on=True):
    return b"\x1b\x45" + (b"\x01" if on else b"\x00")


def _escpos_size(width=1, height=1):
    width = max(1, min(8, width)) - 1
    height = max(1, min(8, height)) - 1
    value = (height << 4) | width
    return b"\x1d\x21" + bytes([value])


def _escpos_cut():
    return b"\x1d\x56\x41\x00"


def _escpos_hr(char="-", width=45):
    return ((char * width) + "\n").encode("gb18030", errors="ignore")


def _fmt_money(value):
    try:
        return f"{float(value or 0):.2f}"
    except Exception:
        return "0.00"


def _wrap_text(text, width=22):
    text = text or ""
    lines = []
    line = ""
    for char in text:
        line += char
        if len(line) >= width:
            lines.append(line)
            line = ""
    if line:
        lines.append(line)
    return lines


def _item_price(item):
    return float(item_price_decimal(item))


def get_fahui_type(value):
    return FAHUI_TYPE.get(value, value)


def build_receipt_bytes(order, payment=None) -> bytes:
    line_width = 35
    left_width = 18

    payload = bytearray()
    payload += _escpos_init()
    payload += _escpos_align("center")
    payload += _escpos_bold(True) + _escpos_size(2, 2)
    payload += "地南佛学会\n".encode("gb18030", errors="ignore")
    payload += _escpos_bold(False) + _escpos_size(1, 1)

    payload += _escpos_align("left")
    created = order.created_at.strftime("%Y-%m-%d %H:%M") if order.created_at else ""
    payload += f"单号: {order.id}\n".encode("gb18030", errors="ignore")
    payload += f"时间: {created}\n".encode("gb18030", errors="ignore")
    payload += f"施主: {order.customer_name or ''}\n".encode("gb18030", errors="ignore")
    payload += f"电话: {order.phone or ''}\n".encode("gb18030", errors="ignore")
    if payment:
        payload += f"支付方式: {payment.payment_mode or '-'}\n".encode("gb18030", errors="ignore")
        payload += f"单据号: {payment.document or '-'}\n".encode("gb18030", errors="ignore")

    payload += _escpos_hr("-")

    total = 0.0
    print_pdf_groups = {}
    for item in order.items or []:
        name = get_fahui_type(item.code)
        price = _fmt_money(_item_price(item))
        lines = _wrap_text(name, width=left_width) or [""]
        left = lines[0]
        space = max(1, line_width - len(left) - len(price))
        payload += (left + (" " * space) + price + "\n").encode("gb18030", errors="ignore")
        for continuation in lines[1:]:
            payload += (continuation + (" " * (line_width - len(continuation))) + "\n").encode(
                "gb18030",
                errors="ignore",
            )

        total += _item_price(item)
        for pdf_page in item.pdf_pages or []:
            print_pdf = pdf_page.print_pdf
            if not print_pdf:
                continue

            for board_data in print_pdf.board_entries or []:
                board_header = board_data.board
                if not board_header or not board_header.board_width:
                    continue

                row = (board_data.location - 1) // board_header.board_width + 1
                col = (board_data.location - 1) % board_header.board_width + 1

                owner_or_deceased = None
                for field in item.form_data or []:
                    if field.field_name == "owner":
                        owner_or_deceased = field.field_value
                        break
                if not owner_or_deceased:
                    for field in item.form_data or []:
                        if field.field_name == "deceased":
                            owner_or_deceased = field.field_value
                            break

                print_pdf_groups.setdefault(print_pdf.id, []).append(
                    {
                        "board_name": board_header.board_name,
                        "location": board_data.location,
                        "row": row,
                        "col": col,
                        "owner_or_deceased": owner_or_deceased,
                    }
                )

    for print_pdf_id, boards in print_pdf_groups.items():
        payload += _escpos_align("left")
        payload += _escpos_hr("-")
        payload += f"QR: {print_pdf_id}\n".encode("gb18030", errors="ignore")

        printed_boards = set()
        for board in boards:
            board_key = (board["board_name"], board["location"])
            if board_key not in printed_boards:
                payload += f"板名: {board['board_name']}\n".encode("gb18030", errors="ignore")
                payload += f"位置: 第{board['row']}排，第{board['col']}个\n".encode(
                    "gb18030",
                    errors="ignore",
                )
                printed_boards.add(board_key)
            if board["owner_or_deceased"]:
                payload += f"施主/故人: {board['owner_or_deceased']}\n".encode("gb18030", errors="ignore")
        payload += _escpos_hr("-")

    payload += _escpos_hr("=")
    payload += _escpos_bold(True)
    total_str = _fmt_money(total)
    label = "合计"
    space = max(1, line_width - len(label) - len(total_str))
    payload += (label + (" " * space) + total_str + "\n").encode("gb18030", errors="ignore")
    payload += _escpos_bold(False)
    payload += _escpos_hr("-")
    payload += _escpos_align("center")
    payload += "感谢您的随喜，功德无量\n".encode("gb18030", errors="ignore")
    payload += "\n\n".encode("gb18030", errors="ignore")
    payload += _escpos_cut()

    return bytes(payload)


def send_raw_to_printer(data_bytes: bytes):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(5)
        sock.connect((PRINTER_IP, PRINTER_PORT))
        sock.sendall(data_bytes)
        sock.shutdown(socket.SHUT_WR)


# ---------------------------------------------------------------------------
# 收据图片（PNG）：付款全部审核通过后，CRM 与公开链接页都可下载。
# ---------------------------------------------------------------------------

_RECEIPT_WIDTH = 720
_RECEIPT_MARGIN = 44


def _receipt_font(size: int):
    from PIL import ImageFont

    from app.paths import STATIC_ROOT

    font_path = STATIC_ROOT / "font" / "NotoSansCJKsc-Regular.otf"
    try:
        return ImageFont.truetype(str(font_path), size)
    except OSError:
        return ImageFont.load_default()


def _wrap_by_width(draw, text: str, font, max_width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for char in str(text or ""):
        candidate = current + char
        if draw.textlength(candidate, font=font) > max_width and current:
            lines.append(current)
            current = char
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines or [""]


def build_receipt_image(order, payments=None):
    """渲染 PNG 收据，返回 BytesIO。payments 传「已审核通过」的付款列表。"""
    from io import BytesIO

    from PIL import Image, ImageDraw

    title_font = _receipt_font(40)
    sub_font = _receipt_font(22)
    body_font = _receipt_font(26)
    small_font = _receipt_font(22)
    total_font = _receipt_font(32)

    inner_width = _RECEIPT_WIDTH - _RECEIPT_MARGIN * 2

    # 先在草稿画布上排版量高度，再按实际高度输出。
    draft = Image.new("RGB", (_RECEIPT_WIDTH, 10), "white")
    draw = ImageDraw.Draw(draft)

    # rows: (kind, payload)
    rows: list[tuple[str, object]] = []
    rows.append(("title", "地南佛学会"))
    rows.append(("sub", "UTBA · 收据 Official Receipt"))
    rows.append(("gap", 10))
    rows.append(("hr", None))

    created = order.created_at.strftime("%Y-%m-%d %H:%M") if order.created_at else "-"
    for label, value in (
        ("单号", f"#{order.id}"),
        ("时间", created),
        ("施主", order.customer_name or order.name or "-"),
        ("电话", order.phone or "-"),
        ("版本", order.version or "-"),
    ):
        rows.append(("kv", (label, value)))

    rows.append(("hr", None))

    total = 0.0
    for item in order.items or []:
        name = get_fahui_type(item.code)
        price = _item_price(item)
        total += price
        rows.append(("item", (name, f"RM {_fmt_money(price)}")))

    rows.append(("hr2", None))
    rows.append(("total", ("合计", f"RM {_fmt_money(total)}")))
    rows.append(("hr", None))

    mode_labels = {"bank": "银行转账", "qr": "扫码", "cash": "现金"}
    for payment in payments or []:
        raw_mode = (payment.payment_mode or "").strip()
        mode = mode_labels.get(raw_mode.lower(), raw_mode or "-")
        amount = _fmt_money(float(payment.total_price or 0))
        when = payment.valid_at or payment.paid_at or payment.created_at
        when_text = when.strftime("%Y-%m-%d %H:%M") if when else "-"
        rows.append(("kv", ("付款", f"{mode} · RM {amount}")))
        rows.append(("kv", ("审核", f"已通过 · {when_text}")))
    if payments:
        rows.append(("hr", None))

    rows.append(("gap", 6))
    rows.append(("center", "感谢您的随喜，功德无量"))

    # 量高
    def line_height(font):
        ascent, descent = font.getmetrics()
        return ascent + descent + 8

    height = _RECEIPT_MARGIN
    measured: list[tuple[str, object, int]] = []
    for kind, payload in rows:
        if kind == "gap":
            step = int(payload)
        elif kind in ("hr", "hr2"):
            step = 26
        elif kind == "title":
            step = line_height(title_font)
        elif kind == "sub":
            step = line_height(sub_font)
        elif kind == "total":
            step = line_height(total_font)
        elif kind == "item":
            name, price = payload
            price_width = int(draw.textlength(str(price), font=body_font)) + 20
            wrapped = _wrap_by_width(draw, name, body_font, inner_width - price_width)
            payload = (wrapped, price)
            step = line_height(body_font) * len(wrapped)
        elif kind == "center":
            step = line_height(small_font)
        else:  # kv
            step = line_height(body_font)
        measured.append((kind, payload, step))
        height += step
    height += _RECEIPT_MARGIN

    image = Image.new("RGB", (_RECEIPT_WIDTH, height), "white")
    draw = ImageDraw.Draw(image)
    ink = (23, 23, 23)
    muted = (110, 110, 110)

    y = _RECEIPT_MARGIN
    for kind, payload, step in measured:
        if kind == "gap":
            pass
        elif kind == "hr":
            draw.line((_RECEIPT_MARGIN, y + 12, _RECEIPT_WIDTH - _RECEIPT_MARGIN, y + 12), fill=(200, 200, 200), width=2)
        elif kind == "hr2":
            draw.line((_RECEIPT_MARGIN, y + 12, _RECEIPT_WIDTH - _RECEIPT_MARGIN, y + 12), fill=ink, width=3)
        elif kind == "title":
            text = str(payload)
            x = (_RECEIPT_WIDTH - draw.textlength(text, font=title_font)) / 2
            draw.text((x, y), text, font=title_font, fill=ink)
        elif kind == "sub":
            text = str(payload)
            x = (_RECEIPT_WIDTH - draw.textlength(text, font=sub_font)) / 2
            draw.text((x, y), text, font=sub_font, fill=muted)
        elif kind == "center":
            text = str(payload)
            x = (_RECEIPT_WIDTH - draw.textlength(text, font=small_font)) / 2
            draw.text((x, y), text, font=small_font, fill=muted)
        elif kind == "kv":
            label, value = payload
            draw.text((_RECEIPT_MARGIN, y), f"{label}", font=body_font, fill=muted)
            draw.text((_RECEIPT_MARGIN + 110, y), str(value), font=body_font, fill=ink)
        elif kind == "item":
            wrapped, price = payload
            price_x = _RECEIPT_WIDTH - _RECEIPT_MARGIN - draw.textlength(str(price), font=body_font)
            draw.text((price_x, y), str(price), font=body_font, fill=ink)
            line_y = y
            for line in wrapped:
                draw.text((_RECEIPT_MARGIN, line_y), line, font=body_font, fill=ink)
                line_y += step // len(wrapped)
        elif kind == "total":
            label, value = payload
            draw.text((_RECEIPT_MARGIN, y), label, font=total_font, fill=ink)
            value_x = _RECEIPT_WIDTH - _RECEIPT_MARGIN - draw.textlength(str(value), font=total_font)
            draw.text((value_x, y), str(value), font=total_font, fill=ink)
        y += step

    buffer = BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return buffer
