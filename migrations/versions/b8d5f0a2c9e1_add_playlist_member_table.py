"""add playlist_member table (playlists <-> users many-to-many) and backfill owners

Revision ID: b8d5f0a2c9e1
Revises: a7c4e9d1f2b3
Create Date: 2026-09-25 09:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "b8d5f0a2c9e1"
down_revision = "a7c4e9d1f2b3"
branch_labels = None
depends_on = None

TABLE = "playlist_member"


def _has_table(connection):
    return TABLE in sa.inspect(connection).get_table_names()


def upgrade():
    connection = op.get_bind()
    if not _has_table(connection):
        op.create_table(
            TABLE,
            sa.Column("playlist_id", sa.Integer(), sa.ForeignKey("playlist.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("user_data.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("joined_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
    # 把现有歌单的创建者补成成员，旧数据不丢。
    op.execute(
        """
        INSERT IGNORE INTO playlist_member (playlist_id, user_id, joined_at)
        SELECT id, user_id, COALESCE(created_at, NOW()) FROM playlist WHERE user_id IS NOT NULL
        """
    )


def downgrade():
    connection = op.get_bind()
    if _has_table(connection):
        op.drop_table(TABLE)
