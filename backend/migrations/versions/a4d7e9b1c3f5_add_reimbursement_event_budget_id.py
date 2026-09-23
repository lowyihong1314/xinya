"""add event_budget_id to reimbursement_request

Revision ID: a4d7e9b1c3f5
Revises: f3a1c8d2e6b4
Create Date: 2026-07-25 09:05:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "a4d7e9b1c3f5"
down_revision = "f3a1c8d2e6b4"
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
    if COLUMN not in _columns(connection):
        op.add_column(TABLE, sa.Column(COLUMN, sa.Integer(), nullable=True))
    if FK_NAME not in _fks(connection):
        op.create_foreign_key(
            FK_NAME, TABLE, "event_budget_data", [COLUMN], ["id"], ondelete="SET NULL", onupdate="CASCADE",
        )


def downgrade():
    connection = op.get_bind()
    if FK_NAME in _fks(connection):
        op.drop_constraint(FK_NAME, TABLE, type_="foreignkey")
    if COLUMN in _columns(connection):
        op.drop_column(TABLE, COLUMN)
