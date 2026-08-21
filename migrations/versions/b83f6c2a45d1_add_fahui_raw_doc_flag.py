"""原始文档的待核备注 fahui_raw_doc_flag（AI 抽取的 review_flags，可逐条勾选已处理）

Revision ID: b83f6c2a45d1
Revises: a5d70e1c9b34
Create Date: 2026-08-21 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "b83f6c2a45d1"
down_revision = "a5d70e1c9b34"
branch_labels = None
depends_on = None

TABLE = "fahui_raw_doc_flag"


def _has_table(connection) -> bool:
    return sa.inspect(connection).has_table(TABLE)


def upgrade():
    if _has_table(op.get_bind()):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("raw_doc_id", sa.Integer(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("text_hash", sa.String(length=40), nullable=False),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["raw_doc_id"], ["fahui_raw_doc.id"],
            name="fk_raw_doc_flag_doc", ondelete="CASCADE", onupdate="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by_user_id"], ["user_data.id"],
            name="fk_raw_doc_flag_user", ondelete="SET NULL",
        ),
        sa.UniqueConstraint("raw_doc_id", "text_hash", name="uq_fahui_raw_doc_flag"),
    )
    op.create_index("ix_fahui_raw_doc_flag_doc", TABLE, ["raw_doc_id"])


def downgrade():
    if not _has_table(op.get_bind()):
        return
    op.drop_index("ix_fahui_raw_doc_flag_doc", table_name=TABLE)
    op.drop_table(TABLE)
