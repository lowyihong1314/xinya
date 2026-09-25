"""add position column to playlist_music so playlist order persists

Revision ID: c9e6a1b3d4f2
Revises: b8d5f0a2c9e1
Create Date: 2026-09-25 09:30:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "c9e6a1b3d4f2"
down_revision = "b8d5f0a2c9e1"
branch_labels = None
depends_on = None

TABLE = "playlist_music"


def _columns(connection):
    return {column["name"] for column in sa.inspect(connection).get_columns(TABLE)}


def upgrade():
    connection = op.get_bind()
    if "position" not in _columns(connection):
        op.add_column(TABLE, sa.Column("position", sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    connection = op.get_bind()
    if "position" in _columns(connection):
        op.drop_column(TABLE, "position")
