"""add event_organizing_unit table (进行单位)

Revision ID: b6d2f8a4c1e7
Revises: a4c7e9f2b5d8
Create Date: 2026-08-12 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "b6d2f8a4c1e7"
down_revision = "a4c7e9f2b5d8"
branch_labels = None
depends_on = None

TABLE = "event_organizing_unit"


def _has_table(connection) -> bool:
    return sa.inspect(connection).has_table(TABLE)


def upgrade():
    connection = op.get_bind()
    if _has_table(connection):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("unit_name", sa.String(length=200), nullable=False),
        sa.Column("logo_path", sa.String(length=255), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["event_id"], ["event_data.id"], name="fk_event_unit_event", ondelete="CASCADE"),
    )
    op.create_index("ix_event_organizing_unit_event_id", TABLE, ["event_id"])


def downgrade():
    connection = op.get_bind()
    if _has_table(connection):
        op.drop_index("ix_event_organizing_unit_event_id", table_name=TABLE)
        op.drop_table(TABLE)
