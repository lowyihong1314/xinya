"""add score column to regis_form_group

Revision ID: f1a7c9e3b520
Revises: e5b3d9c1f42a
Create Date: 2026-07-23 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "f1a7c9e3b520"
down_revision = "e5b3d9c1f42a"
branch_labels = None
depends_on = None

TABLE = "regis_form_group"


def _columns(connection):
    return {c["name"] for c in sa.inspect(connection).get_columns(TABLE)}


def upgrade():
    connection = op.get_bind()
    if "score" not in _columns(connection):
        op.add_column(TABLE, sa.Column("score", sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    connection = op.get_bind()
    if "score" in _columns(connection):
        op.drop_column(TABLE, "score")
