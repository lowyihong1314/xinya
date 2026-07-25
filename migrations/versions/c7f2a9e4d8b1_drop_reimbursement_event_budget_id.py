"""drop event_budget_id from reimbursement_request

Revision ID: c7f2a9e4d8b1
Revises: b2e5f9a4c7d1
Create Date: 2026-07-25 13:00:00.000000

报销改为只按 event_id 关联活动，进入活动预算；不再挂到具体预算行。
"""
from alembic import op
import sqlalchemy as sa


revision = "c7f2a9e4d8b1"
down_revision = "b2e5f9a4c7d1"
branch_labels = None
depends_on = None

TABLE = "reimbursement_request"
COLUMN = "event_budget_id"
FK_NAME = "fk_reimb_event_budget"


def _columns(connection):
    return {c["name"] for c in sa.inspect(connection).get_columns(TABLE)}


def _fks(connection):
    return {fk["name"] for fk in sa.inspect(connection).get_foreign_keys(TABLE)}


def upgrade():
    connection = op.get_bind()
    if FK_NAME in _fks(connection):
        op.drop_constraint(FK_NAME, TABLE, type_="foreignkey")
    if COLUMN in _columns(connection):
        op.drop_column(TABLE, COLUMN)


def downgrade():
    connection = op.get_bind()
    if COLUMN not in _columns(connection):
        op.add_column(TABLE, sa.Column(COLUMN, sa.Integer(), nullable=True))
    if FK_NAME not in _fks(connection):
        op.create_foreign_key(
            FK_NAME, TABLE, "event_budget_data", [COLUMN], ["id"], ondelete="SET NULL", onupdate="CASCADE",
        )
