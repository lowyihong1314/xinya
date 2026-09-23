"""add general ledger + cash book tables and seed chart of accounts

Revision ID: b1c2d3e4f5a6
Revises: a7b8c9d0e1f2
Create Date: 2026-07-20 09:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'b1c2d3e4f5a6'
down_revision = 'a7b8c9d0e1f2'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'gl_account',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('code', sa.String(length=30), nullable=False),
        sa.Column('name', sa.String(length=160), nullable=False),
        sa.Column('account_type', sa.String(length=20), nullable=False),
        sa.Column('parent_id', sa.Integer(), nullable=True),
        sa.Column('is_cash', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('cash_kind', sa.String(length=20), nullable=True),
        sa.Column('bank_account_no', sa.String(length=80), nullable=True),
        sa.Column('currency', sa.String(length=10), nullable=False, server_default='MYR'),
        sa.Column('opening_balance', sa.Numeric(precision=14, scale=2), nullable=False, server_default='0.00'),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='active'),
        sa.Column('remark', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['parent_id'], ['gl_account.id'], ondelete='SET NULL', onupdate='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_gl_account_code'), 'gl_account', ['code'], unique=True)
    op.create_index(op.f('ix_gl_account_account_type'), 'gl_account', ['account_type'], unique=False)
    op.create_index(op.f('ix_gl_account_parent_id'), 'gl_account', ['parent_id'], unique=False)
    op.create_index(op.f('ix_gl_account_is_cash'), 'gl_account', ['is_cash'], unique=False)
    op.create_index(op.f('ix_gl_account_status'), 'gl_account', ['status'], unique=False)

    op.create_table(
        'gl_journal_entry',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('entry_no', sa.String(length=40), nullable=False),
        sa.Column('entry_date', sa.Date(), nullable=False),
        sa.Column('memo', sa.String(length=255), nullable=True),
        sa.Column('reference', sa.String(length=120), nullable=True),
        sa.Column('source', sa.String(length=40), nullable=False, server_default='manual'),
        sa.Column('source_ref_type', sa.String(length=50), nullable=True),
        sa.Column('source_ref_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='posted'),
        sa.Column('total_debit', sa.Numeric(precision=14, scale=2), nullable=False, server_default='0.00'),
        sa.Column('total_credit', sa.Numeric(precision=14, scale=2), nullable=False, server_default='0.00'),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('posted_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['created_by'], ['user_data.id'], ondelete='SET NULL', onupdate='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_gl_journal_entry_entry_no'), 'gl_journal_entry', ['entry_no'], unique=True)
    op.create_index(op.f('ix_gl_journal_entry_entry_date'), 'gl_journal_entry', ['entry_date'], unique=False)
    op.create_index(op.f('ix_gl_journal_entry_source'), 'gl_journal_entry', ['source'], unique=False)
    op.create_index(op.f('ix_gl_journal_entry_source_ref_id'), 'gl_journal_entry', ['source_ref_id'], unique=False)
    op.create_index(op.f('ix_gl_journal_entry_status'), 'gl_journal_entry', ['status'], unique=False)
    op.create_index(op.f('ix_gl_journal_entry_created_by'), 'gl_journal_entry', ['created_by'], unique=False)

    op.create_table(
        'gl_journal_line',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('entry_id', sa.Integer(), nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=False),
        sa.Column('line_no', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('debit', sa.Numeric(precision=14, scale=2), nullable=False, server_default='0.00'),
        sa.Column('credit', sa.Numeric(precision=14, scale=2), nullable=False, server_default='0.00'),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(['entry_id'], ['gl_journal_entry.id'], ondelete='CASCADE', onupdate='CASCADE'),
        sa.ForeignKeyConstraint(['account_id'], ['gl_account.id'], ondelete='RESTRICT', onupdate='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_gl_journal_line_entry_id'), 'gl_journal_line', ['entry_id'], unique=False)
    op.create_index(op.f('ix_gl_journal_line_account_id'), 'gl_journal_line', ['account_id'], unique=False)

    _seed_chart_of_accounts()


def _seed_chart_of_accounts():
    gl_account = sa.table(
        'gl_account',
        sa.column('code', sa.String),
        sa.column('name', sa.String),
        sa.column('account_type', sa.String),
        sa.column('is_cash', sa.Boolean),
        sa.column('cash_kind', sa.String),
        sa.column('currency', sa.String),
        sa.column('opening_balance', sa.Numeric),
        sa.column('status', sa.String),
    )

    def row(code, name, account_type, is_cash=False, cash_kind=None):
        return {
            'code': code,
            'name': name,
            'account_type': account_type,
            'is_cash': is_cash,
            'cash_kind': cash_kind,
            'currency': 'MYR',
            'opening_balance': 0,
            'status': 'active',
        }

    op.bulk_insert(
        gl_account,
        [
            # 资产 Assets
            row('1000', '现金 Cash on Hand', 'asset', True, 'cash'),
            row('1010', '银行存款 Bank', 'asset', True, 'bank'),
            row('1100', '应收账款 Accounts Receivable', 'asset'),
            row('1200', '存货 Inventory', 'asset'),
            row('1500', '固定资产 Fixed Assets', 'asset'),
            # 负债 Liabilities
            row('2000', '应付账款 Accounts Payable', 'liability'),
            row('2100', '预收款 Deferred Income', 'liability'),
            # 权益 Equity
            row('3000', '累积基金 Accumulated Fund', 'equity'),
            row('3100', '本期结余 Current Surplus', 'equity'),
            # 收入 Income
            row('4000', '乐捐/香油收入 Donation Income', 'income'),
            row('4100', '活动/报名收入 Event Income', 'income'),
            row('4200', '销售收入 Sales Income', 'income'),
            row('4900', '其他收入 Other Income', 'income'),
            # 支出 Expense
            row('5000', '活动支出 Event Expense', 'expense'),
            row('5100', '水电费 Utilities', 'expense'),
            row('5200', '薪资 Salaries', 'expense'),
            row('5300', '维修保养 Maintenance', 'expense'),
            row('5400', '行政/办公 Administrative', 'expense'),
            row('5900', '其他支出 Other Expense', 'expense'),
        ],
    )


def downgrade():
    # Dropping a table drops its own indexes; order respects FK dependencies.
    op.drop_table('gl_journal_line')
    op.drop_table('gl_journal_entry')
    op.drop_table('gl_account')
