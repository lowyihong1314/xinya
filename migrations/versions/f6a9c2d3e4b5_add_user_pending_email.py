"""add pending_email and email_forward_rule_id to user_data

Revision ID: f6a9c2d3e4b5
Revises: e5f8a1b2c3d4
Create Date: 2026-07-12 01:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "f6a9c2d3e4b5"
down_revision = "e5f8a1b2c3d4"
branch_labels = None
depends_on = None

TABLE = "user_data"


def _columns(connection):
    inspector = sa.inspect(connection)
    return {column["name"] for column in inspector.get_columns(TABLE)}


def upgrade():
    connection = op.get_bind()
    existing = _columns(connection)

    if "pending_email" not in existing:
        op.add_column(TABLE, sa.Column("pending_email", sa.String(length=255), nullable=True))
    if "email_forward_rule_id" not in existing:
        op.add_column(TABLE, sa.Column("email_forward_rule_id", sa.String(length=255), nullable=True))


def downgrade():
    connection = op.get_bind()
    existing = _columns(connection)

    if "email_forward_rule_id" in existing:
        op.drop_column(TABLE, "email_forward_rule_id")
    if "pending_email" in existing:
        op.drop_column(TABLE, "pending_email")
