"""报销单表头加收款资料：bank_name / bank_account / account_name

Revision ID: b5e9a3c7d142
Revises: a1d4f7c2b830
Create Date: 2026-09-13 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "b5e9a3c7d142"
down_revision = "a1d4f7c2b830"
branch_labels = None
depends_on = None

TABLE = "reimbursement_request"
COLUMNS = (
    ("bank_name", sa.String(length=100)),
    ("bank_account", sa.String(length=100)),
    ("account_name", sa.String(length=120)),
)


def _existing(connection):
    return {column["name"] for column in sa.inspect(connection).get_columns(TABLE)}


def upgrade():
    existing = _existing(op.get_bind())
    for name, column_type in COLUMNS:
        if name not in existing:
            op.add_column(TABLE, sa.Column(name, column_type, nullable=True))


def downgrade():
    existing = _existing(op.get_bind())
    for name, _ in reversed(COLUMNS):
        if name in existing:
            op.drop_column(TABLE, name)
