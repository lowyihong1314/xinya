"""add login_only to event_flow_data

Revision ID: e1b8d4f26a70
Revises: d7c3a1f0e592
Create Date: 2026-07-24 09:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "e1b8d4f26a70"
down_revision = "d7c3a1f0e592"
branch_labels = None
depends_on = None

TABLE = "event_flow_data"
COLUMN = "login_only"


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
