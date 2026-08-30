from __future__ import annotations

import json
from pathlib import Path

from app.paths import DATA_ROOT


# 牌位模板的底图 PDF 放 DATA_ROOT（后台可上传，不进仓库，deploy 不会被覆盖）。
#
# 坐标配置原来也是这里的 location_json/*.json，现在已经挪进数据库表
# fahui_paiwei_point（迁移 e2b7d5c1a934 会把 json 灌进去）—— 那几个 json 不在仓库里，
# 每次改坐标线上都要手动同步一份，环境之间很容易漂。
# 下面的 _location_file / _owner_point_file / _deceased_point_file 只剩一个用途：
# 表里还没有数据时（新环境刚建表）退回读文件兜底，别让打印直接哑掉。
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


def _point_rows(source_name: str, kind: str):
    from models import db
    from models.fahui import FahuiPaiweiPoint

    return (
        db.session.query(FahuiPaiweiPoint)
        .filter(FahuiPaiweiPoint.source_name == source_name, FahuiPaiweiPoint.kind == kind)
        .order_by(FahuiPaiweiPoint.block_key, FahuiPaiweiPoint.sort_order, FahuiPaiweiPoint.id)
        .all()
    )


def load_location_points(source_name: str):
    """某个模板的格子坐标，还原成原来 json 的形状：
    [{"A": [{"center_point": [...]}, {"folichaodu_point": [...]}, ...]}, ...]

    生成器那边一直按这个形状读，换存储不改它，风险最小。
    """
    source_name = str(source_name or "")
    if not source_name:
        return None

    rows = _point_rows(source_name, "layout")
    if not rows:
        # 表还没灌数据（新环境刚建表）时退回读文件，别让打印直接哑掉。
        # 正常情况下走不到这里 —— 迁移会把 json 灌进 DB。
        return _load_json_file(_location_file(source_name), None)

    blocks: dict[str, list] = {}
    order: list[str] = []
    for row in rows:
        if row.block_key not in blocks:
            blocks[row.block_key] = []
            order.append(row.block_key)
        blocks[row.block_key].append({f"{row.field}_point": row.values()})
    return [{key: blocks[key]} for key in order]


def _count_map(source_name: str, kind: str) -> dict:
    """阳上 / 亡者按人数分档的坐标：{"1": [[...]], "2": [[...], [...]], ...}"""
    rows = _point_rows(source_name, kind)
    if not rows:
        path = _owner_point_file(source_name) if kind == "owner" else _deceased_point_file(source_name)
        return _load_json_file(path, {}) or {}

    result: dict[str, list] = {}
    for row in rows:
        result.setdefault(row.block_key, []).append(row.values())
    return result


def load_point_json():
    """配置页用：把所有模板的格子坐标按老格式吐出去。"""
    entries = []
    for source_name in SOURCE_ORDER:
        point_data = load_location_points(source_name)
        if point_data is not None:
            entries.append({source_name: point_data})
    return entries


def save_point_json(data):
    """配置页保存：整块覆盖某个模板的格子坐标。只写 DB，不再回写 json。"""
    from models import db
    from models.fahui import FahuiPaiweiPoint

    for entry in data or []:
        if not isinstance(entry, dict):
            continue
        for source_name, point_data in entry.items():
            source_name = str(source_name)
            FahuiPaiweiPoint.query.filter_by(source_name=source_name, kind="layout").delete()
            for block in point_data or []:
                if not isinstance(block, dict):
                    continue
                for block_key, points in block.items():
                    for order, point in enumerate(points or []):
                        if not isinstance(point, dict):
                            continue
                        for raw_field, value in point.items():
                            if not value or len(value) < 4:
                                continue
                            field = raw_field[:-6] if raw_field.endswith("_point") else raw_field
                            db.session.add(
                                FahuiPaiweiPoint(
                                    source_name=source_name,
                                    kind="layout",
                                    block_key=str(block_key),
                                    field=field,
                                    dx=float(value[0]),
                                    dy=float(value[1]),
                                    size=float(value[2]),
                                    spacing=float(value[3]),
                                    sort_order=order,
                                )
                            )
    db.session.commit()


def get_point_data(paiwei_type):
    source_name = SOURCE_NAME_BY_PAIWEI_TYPE.get(str(paiwei_type))
    if not source_name:
        return None, None
    return load_location_points(source_name), source_name


def get_owner_point(source_name: str):
    return _count_map(str(source_name or ""), "owner")


def get_deceased_point(source_name: str):
    return _count_map(str(source_name or ""), "deceased")
