"""add notes to regis_form

Revision ID: c4e6f8a2b943
Revises: b3d5f7a9c142
Create Date: 2026-07-23 13:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "c4e6f8a2b943"
down_revision = "b3d5f7a9c142"
branch_labels = None
depends_on = None

TABLE = "regis_form"


def _columns(connection):
    return {c["name"] for c in sa.inspect(connection).get_columns(TABLE)}


def upgrade():
    connection = op.get_bind()
    if "notes" not in _columns(connection):
        op.add_column(TABLE, sa.Column("notes", sa.Text(), nullable=True))


def downgrade():
    connection = op.get_bind()
    if "notes" in _columns(connection):
        op.drop_column(TABLE, "notes")
