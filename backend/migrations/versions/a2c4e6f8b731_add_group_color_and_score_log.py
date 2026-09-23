"""add color to regis_form_group and regis_form_group_score_log table

Revision ID: a2c4e6f8b731
Revises: f1a7c9e3b520
Create Date: 2026-07-23 11:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "a2c4e6f8b731"
down_revision = "f1a7c9e3b520"
branch_labels = None
depends_on = None

GROUP_TABLE = "regis_form_group"
LOG_TABLE = "regis_form_group_score_log"


def _tables(connection):
    return set(sa.inspect(connection).get_table_names())


def _columns(connection, table):
    return {c["name"] for c in sa.inspect(connection).get_columns(table)}


def upgrade():
    connection = op.get_bind()

    if "color" not in _columns(connection, GROUP_TABLE):
        op.add_column(GROUP_TABLE, sa.Column("color", sa.String(length=20), nullable=True))

    if LOG_TABLE not in _tables(connection):
        op.create_table(
            LOG_TABLE,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("form_id", sa.Integer(), nullable=False),
            sa.Column("group_id", sa.Integer(), nullable=True),
            sa.Column("group_name", sa.String(length=255), nullable=True),
            sa.Column("delta", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("actor_name", sa.String(length=120), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["form_id"], ["regis_form.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["group_id"], ["regis_form_group.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_rfgsl_form_id", LOG_TABLE, ["form_id"])
        op.create_index("ix_rfgsl_group_id", LOG_TABLE, ["group_id"])
        op.create_index("ix_rfgsl_created_at", LOG_TABLE, ["created_at"])


def downgrade():
    connection = op.get_bind()
    if LOG_TABLE in _tables(connection):
        op.drop_table(LOG_TABLE)
    if "color" in _columns(connection, GROUP_TABLE):
        op.drop_column(GROUP_TABLE, "color")
