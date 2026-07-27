from __future__ import annotations

import json
from pathlib import Path

from app.paths import DATA_ROOT


# 排位模板（PDF + 坐标 json）是后台可以上传 / 编辑的内容，统一放 DATA_ROOT。
# 以前放在仓库的 paiwei_template/ 下，deploy 时会被 git 覆盖或删掉。
PAIWEI_TEMPLATE_ROOT = DATA_ROOT / "paiwei_template"
PAIWEI_PDF_DIR = PAIWEI_TEMPLATE_ROOT / "pdf"
PAIWEI_LOCATION_DIR = PAIWEI_TEMPLATE_ROOT / "location_json"

SOURCE_NAME_BY_PAIWEI_TYPE = {
    "A1": "paiwei_1",
    "A2": "paiwei_1",
    "A3": "paiwei_1",
    "B1": "paiwei_5",
    "B2": "paiwei_5",
    "B3": "paiwei_5",
    "C": "paiwei_10",
}

SOURCE_ORDER = ("paiwei_1", "paiwei_2", "paiwei_5", "paiwei_10")


def _load_json_file(path, default):
    if not path:
        return default
    try:
        with open(path, "r", encoding="utf-8") as file:
            return json.load(file)
    except (OSError, TypeError, json.JSONDecodeError):
        return default


def _write_json_file(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def _location_file(source_name: str) -> Path:
    return PAIWEI_LOCATION_DIR / f"{source_name}.json"


def _owner_point_file(source_name: str) -> Path:
    return PAIWEI_LOCATION_DIR / f"{source_name}.owner.json"


def _deceased_point_file(source_name: str) -> Path:
    return PAIWEI_LOCATION_DIR / f"{source_name}.deceased.json"


def resolve_paiwei_pdf_template(source_name: str):
    template_path = PAIWEI_PDF_DIR / f"{source_name}.pdf"
    if template_path.exists():
        return template_path
    return None


def load_point_json():
    entries = []
    for source_name in SOURCE_ORDER:
        point_data = _load_json_file(_location_file(source_name), None)
        if point_data is not None:
            entries.append({source_name: point_data})
    return entries


def save_point_json(data):
    for entry in data or []:
        if not isinstance(entry, dict):
            continue
        for source_name, point_data in entry.items():
            _write_json_file(_location_file(source_name), point_data)


def get_point_data(paiwei_type):
    source_name = SOURCE_NAME_BY_PAIWEI_TYPE.get(str(paiwei_type))
    if not source_name:
        return None, None
    return _load_json_file(_location_file(source_name), None), source_name


def get_owner_point(source_name: str):
    return _load_json_file(_owner_point_file(source_name), {}) or {}


def get_deceased_point(source_name: str):
    return _load_json_file(_deceased_point_file(source_name), {}) or {}
