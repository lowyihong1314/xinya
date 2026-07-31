"""法会报名开放时间：按「每年 MM-DD 至 MM-DD」循环窗口判断是否开放。"""

import re
from datetime import datetime, timedelta

from models import db
from models.fahui import FahuiOpenWindow


# 服务器为 UTC，马来西亚为 UTC+8；开放判断按大马当地日期。
_MYT_OFFSET = timedelta(hours=8)
_MD_PATTERN = re.compile(r"^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")

VALID_KEYS = {"ylp", "lamp"}


def today_md():
    return (datetime.utcnow() + _MYT_OFFSET).strftime("%m-%d")


def _validate_md(value, label):
    value = str(value or "").strip()
    if not _MD_PATTERN.match(value):
        raise ValueError(f"{label} 格式必须为 MM-DD，例如 07-01")
    return value


def _window_contains(window, md):
    # start <= end：同年区间；start > end：跨年区间（如 12-15 至 01-15）。均含首尾当天。
    if window.start_md <= window.end_md:
        return window.start_md <= md <= window.end_md
    return md >= window.start_md or md <= window.end_md


def is_open(fahui_key):
    md = today_md()
    windows = FahuiOpenWindow.query.filter_by(fahui_key=fahui_key).all()
    return any(_window_contains(w, md) for w in windows)


def list_windows(fahui_key):
    if fahui_key not in VALID_KEYS:
        raise ValueError("fahui_key 无效")
    windows = (
        FahuiOpenWindow.query.filter_by(fahui_key=fahui_key)
        .order_by(FahuiOpenWindow.start_md, FahuiOpenWindow.id)
        .all()
    )
    md = today_md()
    return {
        "fahui_key": fahui_key,
        "today_md": md,
        "is_open": any(_window_contains(w, md) for w in windows),
        "windows": [w.to_dict() for w in windows],
    }


def list_all_status():
    return {
        "today_md": today_md(),
        "items": [list_windows(key) for key in sorted(VALID_KEYS)],
    }


def create_window(data):
    fahui_key = str(data.get("fahui_key") or "").strip()
    if fahui_key not in VALID_KEYS:
        raise ValueError("fahui_key 无效")
    start_md = _validate_md(data.get("start_md"), "开始日期")
    end_md = _validate_md(data.get("end_md"), "结束日期")
    note = str(data.get("note") or "").strip() or None

    window = FahuiOpenWindow(fahui_key=fahui_key, start_md=start_md, end_md=end_md, note=note)
    db.session.add(window)
    db.session.commit()
    return window.to_dict()


def delete_window(window_id):
    window = FahuiOpenWindow.query.get(window_id)
    if not window:
        raise ValueError("开放时间段不存在")
    db.session.delete(window)
    db.session.commit()
