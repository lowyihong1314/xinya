"""add snapshot data column to membership_council_signature

Revision ID: a2d5f8c1b4e7
Revises: f7a3c1b9d2e5
Create Date: 2026-07-10 01:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "a2d5f8c1b4e7"
down_revision = "f7a3c1b9d2e5"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("membership_council_signature", schema=None) as batch_op:
        batch_op.add_column(sa.Column("data", sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table("membership_council_signature", schema=None) as batch_op:
        batch_op.drop_column("data")
