"""add event_task_data and event_budget_data tables

Revision ID: e5b3d9c1f42a
Revises: d4a2c8e1b309
Create Date: 2026-07-23 09:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "e5b3d9c1f42a"
down_revision = "d4a2c8e1b309"
branch_labels = None
depends_on = None


def _tables(connection):
    return set(sa.inspect(connection).get_table_names())


def upgrade():
    connection = op.get_bind()
    existing = _tables(connection)

    if "event_task_data" not in existing:
        op.create_table(
            "event_task_data",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("event_id", sa.Integer(), nullable=False),
            sa.Column("no", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("assignee", sa.String(length=120), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="todo"),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("remark", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["event_id"], ["event_data.id"], ondelete="CASCADE", onupdate="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_event_task_data_event_id", "event_task_data", ["event_id"])
        op.create_index("ix_event_task_data_no", "event_task_data", ["no"])

    if "event_budget_data" not in existing:
        op.create_table(
            "event_budget_data",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("event_id", sa.Integer(), nullable=False),
            sa.Column("no", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("category", sa.String(length=255), nullable=False),
            sa.Column("budget_amount", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0"),
            sa.Column("actual_amount", sa.Numeric(precision=10, scale=2), nullable=True),
            sa.Column("remark", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["event_id"], ["event_data.id"], ondelete="CASCADE", onupdate="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_event_budget_data_event_id", "event_budget_data", ["event_id"])
        op.create_index("ix_event_budget_data_no", "event_budget_data", ["no"])


def downgrade():
    connection = op.get_bind()
    existing = _tables(connection)
    if "event_budget_data" in existing:
        op.drop_table("event_budget_data")
    if "event_task_data" in existing:
        op.drop_table("event_task_data")
