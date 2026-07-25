"""add place_id/lat/lng to event_data

Revision ID: b2e5f9a4c7d1
Revises: a4d7e9b1c3f5
Create Date: 2026-07-25 11:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "b2e5f9a4c7d1"
down_revision = "a4d7e9b1c3f5"
branch_labels = None
depends_on = None

TABLE = "event_data"
COLUMNS = [
    ("place_id", sa.String(length=255)),
    ("lat", sa.Float()),
    ("lng", sa.Float()),
]


def _columns(connection):
    return {c["name"] for c in sa.inspect(connection).get_columns(TABLE)}


def upgrade():
    connection = op.get_bind()
    existing = _columns(connection)
    for name, coltype in COLUMNS:
        if name not in existing:
            op.add_column(TABLE, sa.Column(name, coltype, nullable=True))


def downgrade():
    connection = op.get_bind()
    existing = _columns(connection)
    for name, _ in COLUMNS:
        if name in existing:
            op.drop_column(TABLE, name)
