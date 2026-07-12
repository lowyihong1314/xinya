"""add email_log table

Revision ID: e5f8a1b2c3d4
Revises: d1e2f3a4b5c6
Create Date: 2026-07-12 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "e5f8a1b2c3d4"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None

TABLE = "email_log"


def _has_table(connection):
    inspector = sa.inspect(connection)
    return TABLE in inspector.get_table_names()


def upgrade():
    connection = op.get_bind()
    if _has_table(connection):
        return

    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("from_email", sa.String(length=255), nullable=False),
        sa.Column("to_email", sa.String(length=255), nullable=False),
        sa.Column("cc_email", sa.String(length=255), nullable=True),
        sa.Column("bcc_email", sa.String(length=255), nullable=True),
        sa.Column("subject", sa.String(length=255), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("direction", sa.String(length=20), nullable=False, server_default="sent"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("message_id", sa.String(length=255), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["user_data.id"], ondelete="CASCADE", onupdate="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_log_user_id", TABLE, ["user_id"])
    op.create_index("ix_email_log_created_at", TABLE, ["created_at"])


def downgrade():
    connection = op.get_bind()
    if not _has_table(connection):
        return

    op.drop_index("ix_email_log_created_at", table_name=TABLE)
    op.drop_index("ix_email_log_user_id", table_name=TABLE)
    op.drop_table(TABLE)
