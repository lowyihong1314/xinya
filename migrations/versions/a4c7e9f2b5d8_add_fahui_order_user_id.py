"""add user_id (maintainer) to fahui orders

Revision ID: a4c7e9f2b5d8
Revises: e5c9d3a7f2b8
Create Date: 2026-08-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "a4c7e9f2b5d8"
down_revision = "e5c9d3a7f2b8"
branch_labels = None
depends_on = None

TABLE = "orders"
FK_NAME = "fk_orders_user_id"
INDEX_NAME = "ix_orders_user_id"


def _columns(connection):
    inspector = sa.inspect(connection)
    return {column["name"] for column in inspector.get_columns(TABLE)}


def upgrade():
    connection = op.get_bind()
    if "user_id" not in _columns(connection):
        op.add_column(TABLE, sa.Column("user_id", sa.Integer(), nullable=True))
        op.create_index(INDEX_NAME, TABLE, ["user_id"])
        op.create_foreign_key(
            FK_NAME,
            TABLE,
            "user_data",
            ["user_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade():
    connection = op.get_bind()
    if "user_id" in _columns(connection):
        op.drop_constraint(FK_NAME, TABLE, type_="foreignkey")
        op.drop_index(INDEX_NAME, table_name=TABLE)
        op.drop_column(TABLE, "user_id")
