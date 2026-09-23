"""add requested_username and user_id to youth_class_registration

Revision ID: d1e2f3a4b5c6
Revises: c4f7a1e9b2d6
Create Date: 2026-07-11 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "d1e2f3a4b5c6"
down_revision = "c4f7a1e9b2d6"
branch_labels = None
depends_on = None

TABLE = "youth_class_registration"
FK_NAME = "fk_youth_class_registration_user_id"
IX_NAME = "ix_youth_class_registration_user_id"


def _columns(connection):
    inspector = sa.inspect(connection)
    return {column["name"] for column in inspector.get_columns(TABLE)}


def upgrade():
    connection = op.get_bind()
    existing = _columns(connection)

    if "requested_username" not in existing:
        op.add_column(TABLE, sa.Column("requested_username", sa.String(length=255), nullable=True))
    if "user_id" not in existing:
        op.add_column(TABLE, sa.Column("user_id", sa.Integer(), nullable=True))
        op.create_index(IX_NAME, TABLE, ["user_id"])
        op.create_foreign_key(
            FK_NAME,
            TABLE,
            "user_data",
            ["user_id"],
            ["id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
        )


def downgrade():
    connection = op.get_bind()
    existing = _columns(connection)

    if "user_id" in existing:
        op.drop_constraint(FK_NAME, TABLE, type_="foreignkey")
        op.drop_index(IX_NAME, table_name=TABLE)
        op.drop_column(TABLE, "user_id")
    if "requested_username" in existing:
        op.drop_column(TABLE, "requested_username")
