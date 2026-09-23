"""法会版本 ↔ 活动绑定表 fahui_version_event

Revision ID: f4a91c7d3e28
Revises: e7b1c93a2f45
Create Date: 2026-08-15 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "f4a91c7d3e28"
down_revision = "e7b1c93a2f45"
branch_labels = None
depends_on = None

TABLE = "fahui_version_event"


def _has_table(connection) -> bool:
    return sa.inspect(connection).has_table(TABLE)


def upgrade():
    connection = op.get_bind()
    if _has_table(connection):
        return

    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("workspace", sa.String(length=16), nullable=False, server_default="ylp"),
        sa.Column("version", sa.String(length=50), nullable=False),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["event_data.id"],
            name="fk_fahui_version_event_event",
            ondelete="CASCADE",
            onupdate="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["user_data.id"],
            name="fk_fahui_version_event_user",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint("workspace", "version", name="uq_fahui_version_event"),
    )
    op.create_index("ix_fahui_version_event_event_id", TABLE, ["event_id"])
    op.create_index("ix_fahui_version_event_version", TABLE, ["version"])
    op.create_index("ix_fahui_version_event_workspace", TABLE, ["workspace"])


def downgrade():
    connection = op.get_bind()
    if not _has_table(connection):
        return
    op.drop_index("ix_fahui_version_event_workspace", table_name=TABLE)
    op.drop_index("ix_fahui_version_event_version", table_name=TABLE)
    op.drop_index("ix_fahui_version_event_event_id", table_name=TABLE)
    op.drop_table(TABLE)
