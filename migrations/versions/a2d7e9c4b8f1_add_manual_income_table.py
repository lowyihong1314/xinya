"""add manual_income table (财政手动新建收款：捐赠收入)

Revision ID: a2d7e9c4b8f1
Revises: ba194aaeba8c
Create Date: 2026-07-29 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'a2d7e9c4b8f1'
down_revision = 'ba194aaeba8c'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'manual_income',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('income_type', sa.String(length=32), nullable=False, server_default='donation'),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('phone', sa.String(length=32), nullable=True),
        sa.Column('payment_mode', sa.String(length=32), nullable=True),
        sa.Column('amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('remark', sa.Text(), nullable=True),
        sa.Column('status', sa.Enum('fail', 'process', 'checked'), nullable=False, server_default='process'),
        sa.Column('event_id', sa.Integer(), nullable=True),
        sa.Column('created_by_user_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('current_timestamp()')),
        sa.ForeignKeyConstraint(['event_id'], ['event_data.id'], ondelete='SET NULL', onupdate='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['user_data.id'], ondelete='SET NULL', onupdate='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        mysql_engine='InnoDB',
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci',
    )
    op.create_index(op.f('ix_manual_income_income_type'), 'manual_income', ['income_type'], unique=False)
    op.create_index(op.f('ix_manual_income_event_id'), 'manual_income', ['event_id'], unique=False)
    op.create_index(op.f('ix_manual_income_created_by_user_id'), 'manual_income', ['created_by_user_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_manual_income_created_by_user_id'), table_name='manual_income')
    op.drop_index(op.f('ix_manual_income_event_id'), table_name='manual_income')
    op.drop_index(op.f('ix_manual_income_income_type'), table_name='manual_income')
    op.drop_table('manual_income')
