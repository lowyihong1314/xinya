"""add reimbursement request change log

Revision ID: 6a2f4d8c9e10
Revises: 5f8d1f9e6a21
Create Date: 2026-05-13 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "6a2f4d8c9e10"
down_revision = "5f8d1f9e6a21"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "reimbursement_request_change_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("changed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("field_name", sa.String(length=80), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["changed_by_user_id"],
            ["user_data.id"],
            onupdate="CASCADE",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["request_id"],
            ["reimbursement_request.id"],
            onupdate="CASCADE",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("reimbursement_request_change_log", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_reimbursement_request_change_log_changed_by_user_id"), ["changed_by_user_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_reimbursement_request_change_log_request_id"), ["request_id"], unique=False)


def downgrade():
    op.drop_table("reimbursement_request_change_log")
