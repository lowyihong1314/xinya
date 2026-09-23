"""订单改动日志表 fahui_order_log：记录谁把哪个字段从什么改成了什么

Revision ID: a4d7e9f1c3b2
Revises: b83f6c2a45d1
Create Date: 2026-08-28 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "a4d7e9f1c3b2"
down_revision = "b83f6c2a45d1"
branch_labels = None
depends_on = None

TABLE = "fahui_order_log"


def _has_table(connection) -> bool:
    return TABLE in sa.inspect(connection).get_table_names()


def upgrade():
    connection = op.get_bind()
    if _has_table(connection):
        return

    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=True),
        sa.Column("target", sa.String(length=24), nullable=False, server_default="order"),
        sa.Column("action", sa.String(length=24), nullable=False, server_default="update"),
        sa.Column("field", sa.String(length=64), nullable=True),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("user_name", sa.String(length=120), nullable=True),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE", onupdate="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user_data.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f(f"ix_{TABLE}_order_id"), TABLE, ["order_id"])
    op.create_index(op.f(f"ix_{TABLE}_item_id"), TABLE, ["item_id"])
    op.create_index(op.f(f"ix_{TABLE}_user_id"), TABLE, ["user_id"])
    op.create_index(op.f(f"ix_{TABLE}_phone"), TABLE, ["phone"])
    op.create_index(op.f(f"ix_{TABLE}_created_at"), TABLE, ["created_at"])


def downgrade():
    connection = op.get_bind()
    if not _has_table(connection):
        return
    op.drop_table(TABLE)
