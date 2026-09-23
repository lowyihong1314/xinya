"""add songbook entry table

Revision ID: e8f1d2c4a9b0
Revises: c3f42d7b9e11
Create Date: 2026-03-22 15:25:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'e8f1d2c4a9b0'
down_revision = 'd4b8c1f6e2ab'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'songbook_entry',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('song_number', sa.Integer(), nullable=True),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('title_normalized', sa.String(length=255), nullable=False),
        sa.Column('variant', sa.String(length=16), nullable=False, server_default='C'),
        sa.Column('heading_text', sa.String(length=255), nullable=True),
        sa.Column('original_key', sa.String(length=64), nullable=True),
        sa.Column('selected_key', sa.String(length=64), nullable=True),
        sa.Column('bpm', sa.String(length=32), nullable=True),
        sa.Column('time_signature', sa.String(length=32), nullable=True),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('search_text', sa.Text(), nullable=False),
        sa.Column('source_doc', sa.String(length=255), nullable=True),
        sa.Column('published', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_songbook_entry_song_number'), 'songbook_entry', ['song_number'], unique=False)
    op.create_index(op.f('ix_songbook_entry_sort_order'), 'songbook_entry', ['sort_order'], unique=False)
    op.create_index(op.f('ix_songbook_entry_title'), 'songbook_entry', ['title'], unique=False)
    op.create_index(op.f('ix_songbook_entry_title_normalized'), 'songbook_entry', ['title_normalized'], unique=False)
    op.create_index(op.f('ix_songbook_entry_variant'), 'songbook_entry', ['variant'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_songbook_entry_variant'), table_name='songbook_entry')
    op.drop_index(op.f('ix_songbook_entry_title_normalized'), table_name='songbook_entry')
    op.drop_index(op.f('ix_songbook_entry_title'), table_name='songbook_entry')
    op.drop_index(op.f('ix_songbook_entry_sort_order'), table_name='songbook_entry')
    op.drop_index(op.f('ix_songbook_entry_song_number'), table_name='songbook_entry')
    op.drop_table('songbook_entry')
