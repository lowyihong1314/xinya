"""add fahui_open_window table with default windows

Revision ID: b3e7f1a9c5d2
Revises: a2d7e9c4b8f1
Create Date: 2026-07-31 09:10:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "b3e7f1a9c5d2"
down_revision = "a2d7e9c4b8f1"
branch_labels = None
depends_on = None

TABLE = "fahui_open_window"


def _table_exists(connection):
    inspector = sa.inspect(connection)
    return TABLE in inspector.get_table_names()


def upgrade():
    connection = op.get_bind()
    if _table_exists(connection):
        return

    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("fahui_key", sa.String(length=32), nullable=False, index=True),
        sa.Column("start_md", sa.String(length=5), nullable=False),
        sa.Column("end_md", sa.String(length=5), nullable=False),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(),
            nullable=True,
            server_default=sa.text("current_timestamp()"),
        ),
    )

    # 预置默认开放时间：盂兰盆每年 7/1–9/1；点灯每年 1/1–2/1 与 4/1–5/1。
    op.bulk_insert(
        sa.table(
            TABLE,
            sa.column("fahui_key", sa.String),
            sa.column("start_md", sa.String),
            sa.column("end_md", sa.String),
            sa.column("note", sa.String),
        ),
        [
            {"fahui_key": "ylp", "start_md": "07-01", "end_md": "09-01", "note": "盂兰盆法会"},
            {"fahui_key": "lamp", "start_md": "01-01", "end_md": "02-01", "note": "点灯（上半年）"},
            {"fahui_key": "lamp", "start_md": "04-01", "end_md": "05-01", "note": "点灯（卫塞节期）"},
        ],
    )


def downgrade():
    connection = op.get_bind()
    if _table_exists(connection):
        op.drop_table(TABLE)
