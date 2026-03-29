"""add bank note fields to user_data

Revision ID: d6b3f7a1c9e2
Revises: c4d5e6f7a8b9
Create Date: 2026-03-29 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "d6b3f7a1c9e2"
down_revision = "c4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("user_data", sa.Column("bank_account", sa.String(length=100), nullable=True))
    op.add_column("user_data", sa.Column("tng_number", sa.String(length=40), nullable=True))


def downgrade():
    op.drop_column("user_data", "tng_number")
    op.drop_column("user_data", "bank_account")
