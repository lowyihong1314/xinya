"""add bank name and account name to user_data

Revision ID: a3e7c9b1d4f2
Revises: f1c2d3e4b5a6
Create Date: 2026-03-29 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "a3e7c9b1d4f2"
down_revision = "f1c2d3e4b5a6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("user_data", sa.Column("bank_name", sa.String(length=100), nullable=True))
    op.add_column("user_data", sa.Column("account_name", sa.String(length=120), nullable=True))


def downgrade():
    op.drop_column("user_data", "account_name")
    op.drop_column("user_data", "bank_name")
