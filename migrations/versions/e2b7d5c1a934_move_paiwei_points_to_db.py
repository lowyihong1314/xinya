"""牌位坐标从 location_json 挪进 DB（fahui_paiwei_point），并把现有 json 灌进去

那几个 json 在 DATA_ROOT 不在仓库里，每次改坐标线上都要手动同步，环境之间很容易漂。

Revision ID: e2b7d5c1a934
Revises: d8e1f4a2c7b9
Create Date: 2026-08-30 00:00:00.000000
"""
import json

from alembic import op
import sqlalchemy as sa


revision = "e2b7d5c1a934"
down_revision = "d8e1f4a2c7b9"
branch_labels = None
depends_on = None

TABLE = "fahui_paiwei_point"
SOURCES = ("paiwei_1", "paiwei_2", "paiwei_5", "paiwei_10")


def _has_table(connection) -> bool:
    return TABLE in sa.inspect(connection).get_table_names()


def _location_dir():
    """迁移里单独解析路径，避免依赖 app 包的导入顺序。"""
    from app.paths import DATA_ROOT

    return DATA_ROOT / "paiwei_template" / "location_json"


def _read(path):
    try:
        with open(path, "r", encoding="utf-8") as fp:
            return json.load(fp)
    except (OSError, ValueError):
        return None


def _rows_from_json():
    """把三种 json 摊平成表里的行。文件缺了就跳过（那个模板留空，不影响其它）。"""
    directory = _location_dir()
    rows = []

    for source in SOURCES:
        layout = _read(directory / f"{source}.json")
        for block in layout or []:
            if not isinstance(block, dict):
                continue
            for block_key, points in block.items():
                order = 0
                for point in points or []:
                    if not isinstance(point, dict):
                        continue
                    for raw_field, value in point.items():
                        if not value or len(value) < 4:
                            continue
                        field = raw_field[:-6] if raw_field.endswith("_point") else raw_field
                        rows.append({
                            "source_name": source, "kind": "layout", "block_key": str(block_key),
                            "field": field, "dx": float(value[0]), "dy": float(value[1]),
                            "size": float(value[2]), "spacing": float(value[3]), "sort_order": order,
                        })
                        order += 1

        for kind, suffix in (("owner", "owner"), ("deceased", "deceased")):
            data = _read(directory / f"{source}.{suffix}.json")
            for count, entries in (data or {}).items():
                for index, value in enumerate(entries or []):
                    if not value or len(value) < 4:
                        continue
                    rows.append({
                        "source_name": source, "kind": kind, "block_key": str(count),
                        "field": str(index), "dx": float(value[0]), "dy": float(value[1]),
                        "size": float(value[2]), "spacing": float(value[3]), "sort_order": index,
                    })
    return rows


def upgrade():
    connection = op.get_bind()
    if _has_table(connection):
        return

    table = op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("source_name", sa.String(length=32), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("block_key", sa.String(length=16), nullable=False),
        sa.Column("field", sa.String(length=32), nullable=False),
        sa.Column("dx", sa.Float(), nullable=False, server_default="0"),
        sa.Column("dy", sa.Float(), nullable=False, server_default="0"),
        sa.Column("size", sa.Float(), nullable=False, server_default="0"),
        sa.Column("spacing", sa.Float(), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at", sa.TIMESTAMP(), nullable=True,
            server_default=sa.text("current_timestamp() ON UPDATE current_timestamp()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_name", "kind", "block_key", "field", name="uq_paiwei_point"),
    )
    op.create_index("ix_paiwei_point_lookup", TABLE, ["source_name", "kind"])

    rows = _rows_from_json()
    if rows:
        op.bulk_insert(table, rows)
    else:
        # 没找到 json（例如新环境）：表建好但空着，print_points 会退回读文件，
        # 等真有文件的机器上跑这个迁移再灌进来。
        print("[e2b7d5c1a934] 没读到 location_json，表建好但没灌数据")


def downgrade():
    connection = op.get_bind()
    if not _has_table(connection):
        return
    op.drop_index("ix_paiwei_point_lookup", table_name=TABLE)
    op.drop_table(TABLE)
