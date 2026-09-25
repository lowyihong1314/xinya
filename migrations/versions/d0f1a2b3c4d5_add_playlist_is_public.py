"""add is_public flag to playlist

Revision ID: d0f1a2b3c4d5
Revises: c9e6a1b3d4f2
Create Date: 2026-09-25 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "d0f1a2b3c4d5"
down_revision = "c9e6a1b3d4f2"
branch_labels = None
depends_on = None

TABLE = "playlist"


def _columns(connection):
    return {column["name"] for column in sa.inspect(connection).get_columns(TABLE)}


def upgrade():
    connection = op.get_bind()
    if "is_public" not in _columns(connection):
        op.add_column(TABLE, sa.Column("is_public", sa.Boolean(), nullable=False, server_default="0"))


def downgrade():
    connection = op.get_bind()
    if "is_public" in _columns(connection):
        op.drop_column(TABLE, "is_public")
