"""D.I.Y 牌位 fahui_diy_paiwei：临时/特殊牌位，自己摆文字块出单张 PDF

Revision ID: d8e1f4a2c7b9
Revises: c5f2a8b7d1e3
Create Date: 2026-08-29 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "d8e1f4a2c7b9"
down_revision = "c5f2a8b7d1e3"
branch_labels = None
depends_on = None

TABLE = "fahui_diy_paiwei"


def _has_table(connection) -> bool:
    return TABLE in sa.inspect(connection).get_table_names()


def upgrade():
    connection = op.get_bind()
    if _has_table(connection):
        return

    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("source_name", sa.String(length=32), nullable=False, server_default="paiwei_1"),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("elements", sa.JSON(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(),
            nullable=True,
            server_default=sa.text("current_timestamp()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(),
            nullable=True,
            server_default=sa.text("current_timestamp() ON UPDATE current_timestamp()"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["user_data.id"], name="fk_diy_paiwei_user", ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade():
    connection = op.get_bind()
    if not _has_table(connection):
        return
    op.drop_table(TABLE)
