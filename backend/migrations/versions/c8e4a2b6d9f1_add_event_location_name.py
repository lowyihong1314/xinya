"""add location_name to event_data

Revision ID: c8e4a2b6d9f1
Revises: b6d2f8a4c1e7
Create Date: 2026-08-12 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "c8e4a2b6d9f1"
down_revision = "b6d2f8a4c1e7"
branch_labels = None
depends_on = None

TABLE = "event_data"


def _columns(connection):
    return {column["name"] for column in sa.inspect(connection).get_columns(TABLE)}


def upgrade():
    if "location_name" not in _columns(op.get_bind()):
        op.add_column(TABLE, sa.Column("location_name", sa.String(length=255), nullable=True))


def downgrade():
    if "location_name" in _columns(op.get_bind()):
        op.drop_column(TABLE, "location_name")
