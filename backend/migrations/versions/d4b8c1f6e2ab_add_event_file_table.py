"""add event_file table

Revision ID: d4b8c1f6e2ab
Revises: ba36df83378f
Create Date: 2026-03-21 18:45:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


# revision identifiers, used by Alembic.
revision = 'd4b8c1f6e2ab'
down_revision = 'ba36df83378f'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'event_file',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('event_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('file_path', sa.String(length=255), nullable=False),
        sa.Column('file_name', sa.String(length=255), nullable=False),
        sa.Column('mime_type', sa.String(length=120), nullable=True),
        sa.Column('file_size', sa.BigInteger(), nullable=True),
        sa.Column('note', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('current_timestamp()'), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['event_data.id'], ondelete='CASCADE', onupdate='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user_data.id'], ondelete='SET NULL', onupdate='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        mysql_engine='InnoDB',
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci',
    )
    op.create_index(op.f('ix_event_file_event_id'), 'event_file', ['event_id'], unique=False)
    op.create_index(op.f('ix_event_file_user_id'), 'event_file', ['user_id'], unique=False)
    op.create_index(op.f('ix_event_file_created_at'), 'event_file', ['created_at'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_event_file_created_at'), table_name='event_file')
    op.drop_index(op.f('ix_event_file_user_id'), table_name='event_file')
    op.drop_index(op.f('ix_event_file_event_id'), table_name='event_file')
    op.drop_table('event_file')
