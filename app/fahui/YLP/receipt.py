from __future__ import annotations

import os
import socket

from .shared import item_price_decimal


PRINTER_IP = os.getenv("XINYA_RECEIPT_PRINTER_IP", "192.168.68.43")
PRINTER_PORT = int(os.getenv("XINYA_RECEIPT_PRINTER_PORT", "9100"))

FAHUI_TYPE = {
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
