"""add is_member to user_data

Revision ID: a1d9c8e4f2b1
Revises: d4b8c1f6e2ab
Create Date: 2026-03-21 19:45:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'a1d9c8e4f2b1'
down_revision = 'd4b8c1f6e2ab'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('user_data', sa.Column('is_member', sa.Boolean(), nullable=False, server_default=sa.text('0')))


def downgrade():
    op.drop_column('user_data', 'is_member')
