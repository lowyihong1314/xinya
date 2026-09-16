"""相册照片爱心 album_file_heart：一人一照一颗（登录认账号，访客认浏览器 token）

Revision ID: c3f8b21e7a06
Revises: b5e9a3c7d142
Create Date: 2026-09-15 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "c3f8b21e7a06"
down_revision = "b5e9a3c7d142"
branch_labels = None
depends_on = None

TABLE = "album_file_heart"


def upgrade():
    if sa.inspect(op.get_bind()).has_table(TABLE):
        return

    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("file_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("visitor_token", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["file_id"], ["album_files.id"],
            name="fk_album_file_heart_file", ondelete="CASCADE", onupdate="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["user_data.id"],
            name="fk_album_file_heart_user", ondelete="CASCADE", onupdate="CASCADE",
        ),
        # 一人一张照片只能留一颗：登录身份与访客身份各管一边
        sa.UniqueConstraint("file_id", "user_id", name="uq_album_file_heart_user"),
        sa.UniqueConstraint("file_id", "visitor_token", name="uq_album_file_heart_visitor"),
    )
    op.create_index("ix_album_file_heart_file_id", TABLE, ["file_id"])
    op.create_index("ix_album_file_heart_user_id", TABLE, ["user_id"])
    op.create_index("ix_album_file_heart_visitor_token", TABLE, ["visitor_token"])


def downgrade():
    if sa.inspect(op.get_bind()).has_table(TABLE):
        op.drop_table(TABLE)
