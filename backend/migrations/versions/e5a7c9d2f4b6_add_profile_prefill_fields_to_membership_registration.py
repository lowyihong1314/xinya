"""add profile prefill fields to membership registration

Revision ID: e5a7c9d2f4b6
Revises: a4f9c2d8e6b1
Create Date: 2026-06-13 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "e5a7c9d2f4b6"
down_revision = "a4f9c2d8e6b1"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("membership_registration", sa.Column("english_name", sa.String(length=255), nullable=True))
    op.add_column("membership_registration", sa.Column("phone", sa.String(length=32), nullable=True))
    op.add_column("membership_registration", sa.Column("gender", sa.String(length=10), nullable=True))


def downgrade():
    op.drop_column("membership_registration", "gender")
    op.drop_column("membership_registration", "phone")
    op.drop_column("membership_registration", "english_name")
