"""活动是否公开 event_data.is_public：默认全部公开

Revision ID: c5f2a8b7d1e3
Revises: a4d7e9f1c3b2
Create Date: 2026-08-28 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "c5f2a8b7d1e3"
down_revision = "a4d7e9f1c3b2"
branch_labels = None
depends_on = None

TABLE = "event_data"
COLUMN = "is_public"


def _has_column(connection) -> bool:
    return COLUMN in {col["name"] for col in sa.inspect(connection).get_columns(TABLE)}


def upgrade():
    connection = op.get_bind()
    if _has_column(connection):
        return

    # server_default 保证存量行直接变成「公开」，不用另外跑回填。
    op.add_column(
        TABLE,
        sa.Column(COLUMN, sa.Boolean(), nullable=False, server_default=sa.text("1")),
    )


def downgrade():
    connection = op.get_bind()
    if not _has_column(connection):
        return
    op.drop_column(TABLE, COLUMN)
