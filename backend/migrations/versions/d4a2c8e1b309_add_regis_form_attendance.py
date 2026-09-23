"""add regis_form_attendance table (roll-call snapshots)

Revision ID: d4a2c8e1b309
Revises: c3f1a7b9d024
Create Date: 2026-07-23 08:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "d4a2c8e1b309"
down_revision = "c3f1a7b9d024"
branch_labels = None
depends_on = None

TABLE = "regis_form_attendance"


def _tables(connection):
    return set(sa.inspect(connection).get_table_names())


def upgrade():
    connection = op.get_bind()
    if TABLE not in _tables(connection):
        op.create_table(
            TABLE,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("form_id", sa.Integer(), nullable=False),
            sa.Column("remark", sa.String(length=255), nullable=True),
            sa.Column("present_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("total_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("snapshot_json", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["form_id"], ["regis_form.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_regis_form_attendance_form_id", TABLE, ["form_id"])


def downgrade():
    connection = op.get_bind()
    if TABLE in _tables(connection):
        try:
            op.drop_index("ix_regis_form_attendance_form_id", table_name=TABLE)
        except Exception:
            pass
        op.drop_table(TABLE)
