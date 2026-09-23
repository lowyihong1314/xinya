"""add flexible_time_slot to regis_form

Revision ID: d7c3a1f0e592
Revises: c4e6f8a2b943
Create Date: 2026-07-23 16:40:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "d7c3a1f0e592"
down_revision = "c4e6f8a2b943"
branch_labels = None
depends_on = None

TABLE = "regis_form"
COLUMN = "flexible_time_slot"


def _columns(connection):
    return {c["name"] for c in sa.inspect(connection).get_columns(TABLE)}


def upgrade():
    connection = op.get_bind()
    if COLUMN not in _columns(connection):
        op.add_column(
            TABLE,
            sa.Column(COLUMN, sa.Boolean(), nullable=False, server_default=sa.text("0")),
        )


def downgrade():
    connection = op.get_bind()
    if COLUMN in _columns(connection):
        op.drop_column(TABLE, COLUMN)
