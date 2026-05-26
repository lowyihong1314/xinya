"""add AI reference fields to claims

Revision ID: b8e2c7a4d1f0
Revises: 6a2f4d8c9e10
Create Date: 2026-05-26 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "b8e2c7a4d1f0"
down_revision = "6a2f4d8c9e10"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("reimbursement_request", schema=None) as batch_op:
        batch_op.add_column(sa.Column("ref1", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("ref2", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("vendor_name", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("vendor_address", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("vendor_contact_number", sa.String(length=80), nullable=True))
        batch_op.add_column(sa.Column("purchase_datetime", sa.DateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table("reimbursement_request", schema=None) as batch_op:
        batch_op.drop_column("purchase_datetime")
        batch_op.drop_column("vendor_contact_number")
        batch_op.drop_column("vendor_address")
        batch_op.drop_column("vendor_name")
        batch_op.drop_column("ref2")
        batch_op.drop_column("ref1")
