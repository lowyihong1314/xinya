"""add music user play minutes table

Revision ID: 7a1c9e4d2b6f
Revises: 2c2585899fa6
Create Date: 2026-04-02 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7a1c9e4d2b6f'
down_revision = '2c2585899fa6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'music_user_play_minute',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('music_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('play_minutes', sa.Float(), nullable=False, server_default=sa.text('0')),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['music_id'], ['music.id']),
        sa.ForeignKeyConstraint(['user_id'], ['user_data.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('music_id', 'user_id', name='uq_music_user_play_minute_music_user'),
    )
    op.create_index(
        op.f('ix_music_user_play_minute_music_id'),
        'music_user_play_minute',
        ['music_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_music_user_play_minute_user_id'),
        'music_user_play_minute',
        ['user_id'],
        unique=False,
    )

    op.execute(
        sa.text(
            """
            INSERT INTO music_user_play_minute (music_id, user_id, play_minutes, created_at, updated_at)
            SELECT id, 1, play_minutes, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM music
            WHERE play_minutes > 0
            """
        )
    )


def downgrade():
    op.drop_index(op.f('ix_music_user_play_minute_user_id'), table_name='music_user_play_minute')
    op.drop_index(op.f('ix_music_user_play_minute_music_id'), table_name='music_user_play_minute')
    op.drop_table('music_user_play_minute')
