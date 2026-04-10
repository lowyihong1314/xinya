from __future__ import annotations

import json
from app.paths import PROJECT_ROOT
from ..common.ylp_storage import preferred_path, resolve_existing_path


PAIWEI_TEMPLATE_ROOT = PROJECT_ROOT / "paiwei_template"
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

LEGACY_OWNER_FILE_BY_SOURCE = {
    "paiwei_1": "owner_point_A",
    "paiwei_2": "owner_point_A",
    "paiwei_5": "owner_point_B",
    "paiwei_10": "owner_point_C",
}

LEGACY_DECEASED_FILE_BY_SOURCE = {
    "paiwei_1": "deceased_point_A",
    "paiwei_2": "deceased_point_A",
    "paiwei_5": "deceased_point_B",
    "paiwei_10": "deceased_point_C",
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
    preferred_path = PAIWEI_PDF_DIR / f"{source_name}.pdf"
    if preferred_path.exists():
        return preferred_path
    return None


def _load_legacy_point_map():
    legacy_entries = _load_json_file(resolve_existing_path("point.json"), [])
    point_map = {}
    for entry in legacy_entries:
        if not isinstance(entry, dict):
            continue
        point_map.update(entry)
    return point_map


def _resolve_source_name(value: str, legacy_map: dict[str, str]) -> str:
    if value in legacy_map:
        return legacy_map[value]
    return value


def load_point_json():
    legacy_map = _load_legacy_point_map()
    entries = []

    for source_name in SOURCE_ORDER:
        point_data = _load_json_file(_location_file(source_name), None)
        if point_data is None:
            point_data = legacy_map.get(source_name)
        if point_data is not None:
            entries.append({source_name: point_data})

    return entries


def save_point_json(data):
    point_map = {}
    for entry in data or []:
        if not isinstance(entry, dict):
            continue
        for source_name, point_data in entry.items():
            point_map[source_name] = point_data
            _write_json_file(_location_file(source_name), point_data)

    json_file_path = preferred_path("point.json", ensure_parent=True)
    with open(json_file_path, "w", encoding="utf-8") as file:
        json.dump([{source_name: point_map[source_name]} for source_name in point_map], file, ensure_ascii=False, indent=2)


def get_point_data(paiwei_type):
    source_name = SOURCE_NAME_BY_PAIWEI_TYPE.get(str(paiwei_type))
    if not source_name:
        return None, None

    point_data = _load_json_file(_location_file(source_name), None)
    if point_data is not None:
        return point_data, source_name

    legacy_map = _load_legacy_point_map()
    return legacy_map.get(source_name), source_name


def get_owner_point(source_name: str):
    source_name = _resolve_source_name(source_name, {value: key for key, value in LEGACY_OWNER_FILE_BY_SOURCE.items()})
    point_data = _load_json_file(_owner_point_file(source_name), None)
    if point_data is not None:
        return point_data
    legacy_file = LEGACY_OWNER_FILE_BY_SOURCE.get(source_name)
    return _load_json_file(resolve_existing_path(f"{legacy_file}.json") if legacy_file else None, {})


def get_deceased_point(source_name: str):
    source_name = _resolve_source_name(source_name, {value: key for key, value in LEGACY_DECEASED_FILE_BY_SOURCE.items()})
    point_data = _load_json_file(_deceased_point_file(source_name), None)
    if point_data is not None:
        return point_data
    legacy_file = LEGACY_DECEASED_FILE_BY_SOURCE.get(source_name)
    return _load_json_file(resolve_existing_path(f"{legacy_file}.json") if legacy_file else None, {})
