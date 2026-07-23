"""add leader_member_id to regis_form_group

Revision ID: b3d5f7a9c142
Revises: a2c4e6f8b731
Create Date: 2026-07-23 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "b3d5f7a9c142"
down_revision = "a2c4e6f8b731"
branch_labels = None
depends_on = None

TABLE = "regis_form_group"
FK = "fk_regis_form_group_leader"


def _columns(connection):
    return {c["name"] for c in sa.inspect(connection).get_columns(TABLE)}


def upgrade():
    connection = op.get_bind()
    if "leader_member_id" not in _columns(connection):
        op.add_column(TABLE, sa.Column("leader_member_id", sa.Integer(), nullable=True))
        op.create_index("ix_regis_form_group_leader", TABLE, ["leader_member_id"])
        op.create_foreign_key(FK, TABLE, "nric_asset", ["leader_member_id"], ["id"], ondelete="SET NULL")


def downgrade():
    connection = op.get_bind()
    if "leader_member_id" in _columns(connection):
        try:
            op.drop_constraint(FK, TABLE, type_="foreignkey")
        except Exception:
            pass
        try:
            op.drop_index("ix_regis_form_group_leader", table_name=TABLE)
        except Exception:
            pass
        op.drop_column(TABLE, "leader_member_id")
