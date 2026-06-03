"""add mobile session table

Revision ID: a4f9c2d8e6b1
Revises: d2e8f4a6c1b3
Create Date: 2026-06-03 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "a4f9c2d8e6b1"
down_revision = "d2e8f4a6c1b3"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "mobile_session",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.String(length=120), nullable=True),
        sa.Column("refresh_token_hash", sa.String(length=64), nullable=False),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("platform", sa.String(length=50), nullable=True),
        sa.Column("login_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("refreshed_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user_data.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("refresh_token_hash", name="uq_mobile_session_refresh_token_hash"),
    )
    op.create_index(op.f("ix_mobile_session_user_id"), "mobile_session", ["user_id"], unique=False)
    op.create_index(op.f("ix_mobile_session_device_id"), "mobile_session", ["device_id"], unique=False)
    op.create_index(op.f("ix_mobile_session_expires_at"), "mobile_session", ["expires_at"], unique=False)
    op.create_index(op.f("ix_mobile_session_revoked_at"), "mobile_session", ["revoked_at"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_mobile_session_revoked_at"), table_name="mobile_session")
    op.drop_index(op.f("ix_mobile_session_expires_at"), table_name="mobile_session")
    op.drop_index(op.f("ix_mobile_session_device_id"), table_name="mobile_session")
    op.drop_index(op.f("ix_mobile_session_user_id"), table_name="mobile_session")
    op.drop_table("mobile_session")
