"""add type to event_budget_data

Revision ID: f3a1c8d2e6b4
Revises: e1b8d4f26a70
Create Date: 2026-07-25 09:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "f3a1c8d2e6b4"
down_revision = "e1b8d4f26a70"
branch_labels = None
depends_on = None

TABLE = "event_budget_data"
COLUMN = "type"


def _columns(connection):
    return {c["name"] for c in sa.inspect(connection).get_columns(TABLE)}


def upgrade():
    connection = op.get_bind()
    if COLUMN not in _columns(connection):
        op.add_column(
            TABLE,
            sa.Column(COLUMN, sa.String(length=16), nullable=False, server_default="expense"),
        )


def downgrade():
    connection = op.get_bind()
    if COLUMN in _columns(connection):
        op.drop_column(TABLE, COLUMN)
