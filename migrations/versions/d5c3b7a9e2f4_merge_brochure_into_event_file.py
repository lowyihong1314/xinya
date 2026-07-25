"""merge brochure into event_file (event_data.brochure_file_id)

简章不再是 event_data.brochure_path 独立列，而是"被选中的某个活动附件"。
- 新增 event_data.brochure_file_id -> event_file.id (SET NULL)
- 旧 brochure_path 迁移成 event_file 记录并指向
- 删除 event_data.brochure_path

Revision ID: d5c3b7a9e2f4
Revises: c7f2a9e4d8b1
Create Date: 2026-07-25 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "d5c3b7a9e2f4"
down_revision = "c7f2a9e4d8b1"
branch_labels = None
depends_on = None

TABLE = "event_data"


def _columns(conn):
    return {c["name"] for c in sa.inspect(conn).get_columns(TABLE)}


def _fk_names(conn):
    return {fk["name"] for fk in sa.inspect(conn).get_foreign_keys(TABLE)}


def upgrade():
    conn = op.get_bind()

    if "brochure_file_id" not in _columns(conn):
        op.add_column(TABLE, sa.Column("brochure_file_id", sa.Integer(), nullable=True))

    # 迁移旧简章：brochure_path -> 一条 event_file 记录，并把 brochure_file_id 指向它
    if "brochure_path" in _columns(conn):
        conn.execute(sa.text(
            """
            INSERT INTO event_file (event_id, file_path, file_name, mime_type, created_at)
            SELECT e.id, e.brochure_path, SUBSTRING_INDEX(e.brochure_path, '/', -1), NULL, NOW()
            FROM event_data e
            WHERE e.brochure_path IS NOT NULL AND e.brochure_path <> ''
            """
        ))
        conn.execute(sa.text(
            """
            UPDATE event_data e
            JOIN event_file f ON f.event_id = e.id AND f.file_path = e.brochure_path
            SET e.brochure_file_id = f.id
            WHERE e.brochure_path IS NOT NULL AND e.brochure_path <> ''
            """
        ))

    if "fk_event_brochure_file" not in _fk_names(conn):
        op.create_foreign_key(
            "fk_event_brochure_file",
            TABLE,
            "event_file",
            ["brochure_file_id"],
            ["id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
        )

    if "brochure_path" in _columns(conn):
        op.drop_column(TABLE, "brochure_path")


def downgrade():
    conn = op.get_bind()

    if "brochure_path" not in _columns(conn):
        op.add_column(TABLE, sa.Column("brochure_path", sa.String(length=255), nullable=True))

    # 尽力还原：把当前简章附件的 file_path 写回 brochure_path
    conn.execute(sa.text(
        """
        UPDATE event_data e
        JOIN event_file f ON f.id = e.brochure_file_id
        SET e.brochure_path = f.file_path
        WHERE e.brochure_file_id IS NOT NULL
        """
    ))

    if "fk_event_brochure_file" in _fk_names(conn):
        op.drop_constraint("fk_event_brochure_file", TABLE, type_="foreignkey")

    if "brochure_file_id" in _columns(conn):
        op.drop_column(TABLE, "brochure_file_id")
