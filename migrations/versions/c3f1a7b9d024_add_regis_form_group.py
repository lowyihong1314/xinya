"""add regis_form_group table and group_id on regis_form_member

Revision ID: c3f1a7b9d024
Revises: b1c2d3e4f5a6
Create Date: 2026-07-23 06:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "c3f1a7b9d024"
down_revision = "b1c2d3e4f5a6"
branch_labels = None
depends_on = None

GROUP_TABLE = "regis_form_group"
LINK_TABLE = "regis_form_member"
FK_NAME = "fk_regis_form_member_group_id"


def _tables(connection):
    return set(sa.inspect(connection).get_table_names())


def _columns(connection, table):
    return {column["name"] for column in sa.inspect(connection).get_columns(table)}


def upgrade():
    connection = op.get_bind()

    if GROUP_TABLE not in _tables(connection):
        op.create_table(
            GROUP_TABLE,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("form_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["form_id"], ["regis_form.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_regis_form_group_form_id", GROUP_TABLE, ["form_id"])

    if "group_id" not in _columns(connection, LINK_TABLE):
        op.add_column(LINK_TABLE, sa.Column("group_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            FK_NAME,
            LINK_TABLE,
            GROUP_TABLE,
            ["group_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade():
    connection = op.get_bind()

    if "group_id" in _columns(connection, LINK_TABLE):
        try:
            op.drop_constraint(FK_NAME, LINK_TABLE, type_="foreignkey")
        except Exception:
            pass
        op.drop_column(LINK_TABLE, "group_id")

    if GROUP_TABLE in _tables(connection):
        try:
            op.drop_index("ix_regis_form_group_form_id", table_name=GROUP_TABLE)
        except Exception:
            pass
        op.drop_table(GROUP_TABLE)
