"""add quiz_game tables (问答游戏 question banks)

Revision ID: ba194aaeba8c
Revises: d5c3b7a9e2f4
Create Date: 2026-07-27 06:02:34.375963

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'ba194aaeba8c'
down_revision = 'd5c3b7a9e2f4'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('quiz_game_set',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('question_time', sa.Integer(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('is_archived', sa.Boolean(), nullable=False),
    sa.Column('created_by_user_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('quiz_game_question',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('set_id', sa.Integer(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('section', sa.String(length=255), nullable=True),
    sa.Column('zh', sa.Text(), nullable=False),
    sa.Column('en', sa.Text(), nullable=True),
    sa.Column('options_json', sa.Text(), nullable=False),
    sa.Column('answer', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['set_id'], ['quiz_game_set.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('quiz_game_question', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_quiz_game_question_set_id'), ['set_id'], unique=False)


def downgrade():
    with op.batch_alter_table('quiz_game_question', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_quiz_game_question_set_id'))

    op.drop_table('quiz_game_question')
    op.drop_table('quiz_game_set')
