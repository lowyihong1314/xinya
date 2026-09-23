"""add email_verified to user_data

Revision ID: a7b8c9d0e1f2
Revises: f6a9c2d3e4b5
Create Date: 2026-07-12 02:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "a7b8c9d0e1f2"
down_revision = "f6a9c2d3e4b5"
branch_labels = None
depends_on = None

TABLE = "user_data"


def _columns(connection):
    inspector = sa.inspect(connection)
    return {column["name"] for column in inspector.get_columns(TABLE)}


def upgrade():
    connection = op.get_bind()
    if "email_verified" not in _columns(connection):
        op.add_column(
            TABLE,
            sa.Column("email_verified", sa.Boolean(), nullable=False, server_default="0"),
        )


def downgrade():
    connection = op.get_bind()
    if "email_verified" in _columns(connection):
        op.drop_column(TABLE, "email_verified")
