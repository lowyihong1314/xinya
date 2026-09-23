"""add songbook user edit table

Revision ID: f2b6c4d8e1a1
Revises: e8f1d2c4a9b0
Create Date: 2026-03-22 16:30:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'f2b6c4d8e1a1'
down_revision = 'e8f1d2c4a9b0'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'songbook_user_edit',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('base_entry_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['base_entry_id'], ['songbook_entry.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user_data.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('base_entry_id', 'user_id', name='uq_songbook_user_edit_entry_user')
    )
    op.create_index(op.f('ix_songbook_user_edit_base_entry_id'), 'songbook_user_edit', ['base_entry_id'], unique=False)
    op.create_index(op.f('ix_songbook_user_edit_user_id'), 'songbook_user_edit', ['user_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_songbook_user_edit_user_id'), table_name='songbook_user_edit')
    op.drop_index(op.f('ix_songbook_user_edit_base_entry_id'), table_name='songbook_user_edit')
    op.drop_table('songbook_user_edit')
