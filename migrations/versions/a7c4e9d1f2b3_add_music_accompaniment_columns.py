"""add accompaniment file columns to music

Revision ID: a7c4e9d1f2b3
Revises: c3f8b21e7a06
Create Date: 2026-09-25 08:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "a7c4e9d1f2b3"
down_revision = "c3f8b21e7a06"
branch_labels = None
depends_on = None

TABLE = "music"


def _columns(connection):
    inspector = sa.inspect(connection)
    return {column["name"] for column in inspector.get_columns(TABLE)}


def upgrade():
    connection = op.get_bind()
    existing = _columns(connection)

    if "accompaniment_file_name" not in existing:
        op.add_column(TABLE, sa.Column("accompaniment_file_name", sa.String(length=255), nullable=True))
    if "accompaniment_file_type" not in existing:
        op.add_column(TABLE, sa.Column("accompaniment_file_type", sa.String(length=50), nullable=True))
    if "accompaniment_file_size" not in existing:
        op.add_column(TABLE, sa.Column("accompaniment_file_size", sa.BigInteger(), nullable=True))


def downgrade():
    connection = op.get_bind()
    existing = _columns(connection)

    if "accompaniment_file_size" in existing:
        op.drop_column(TABLE, "accompaniment_file_size")
    if "accompaniment_file_type" in existing:
        op.drop_column(TABLE, "accompaniment_file_type")
    if "accompaniment_file_name" in existing:
        op.drop_column(TABLE, "accompaniment_file_name")
