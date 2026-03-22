"""add member_renewal table

Revision ID: c3f42d7b9e11
Revises: a1d9c8e4f2b1
Create Date: 2026-03-21 20:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

revision = 'c3f42d7b9e11'
down_revision = 'a1d9c8e4f2b1'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'member_renewal',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('renewal_date', sa.Date(), nullable=False),
        sa.Column('proof_path', sa.String(length=255), nullable=True),
        sa.Column('proof_name', sa.String(length=255), nullable=True),
        sa.Column('proof_mime', sa.String(length=120), nullable=True),
        sa.Column('note', sa.String(length=255), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('current_timestamp()')),
        sa.ForeignKeyConstraint(['created_by'], ['user_data.id'], ondelete='SET NULL', onupdate='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user_data.id'], ondelete='CASCADE', onupdate='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        mysql_engine='InnoDB',
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci',
    )
    op.create_index(op.f('ix_member_renewal_user_id'), 'member_renewal', ['user_id'], unique=False)
    op.create_index(op.f('ix_member_renewal_renewal_date'), 'member_renewal', ['renewal_date'], unique=False)
    op.create_index(op.f('ix_member_renewal_created_by'), 'member_renewal', ['created_by'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_member_renewal_created_by'), table_name='member_renewal')
    op.drop_index(op.f('ix_member_renewal_renewal_date'), table_name='member_renewal')
    op.drop_index(op.f('ix_member_renewal_user_id'), table_name='member_renewal')
    op.drop_table('member_renewal')
