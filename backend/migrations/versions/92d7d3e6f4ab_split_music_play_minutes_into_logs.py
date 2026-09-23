"""split music play minutes into logs

Revision ID: 92d7d3e6f4ab
Revises: 7a1c9e4d2b6f
Create Date: 2026-04-02 00:00:01.000000

"""
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from alembic import op
import sqlalchemy as sa


revision = '92d7d3e6f4ab'
down_revision = '7a1c9e4d2b6f'
branch_labels = None
depends_on = None

MALAYSIA_TIMEZONE = ZoneInfo("Asia/Kuala_Lumpur")
BACKFILL_START_HOUR = 8
BACKFILL_END_HOUR = 18


def _malaysia_now_naive():
    return datetime.now(MALAYSIA_TIMEZONE).replace(tzinfo=None)


def _seed_date(value):
    if value is None:
        return _malaysia_now_naive().date()
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(MALAYSIA_TIMEZONE).date()


def _next_slot(cursor):
    day_start = datetime.combine(cursor.date(), time(BACKFILL_START_HOUR, 0))
    day_end = datetime.combine(cursor.date(), time(BACKFILL_END_HOUR, 0))
    if cursor < day_start:
        return day_start
    if cursor >= day_end:
        return datetime.combine(cursor.date() + timedelta(days=1), time(BACKFILL_START_HOUR, 0))
    return cursor


def upgrade():
    op.create_table(
        'music_user_play_minute_log',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('music_user_play_minute_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ['music_user_play_minute_id'],
            ['music_user_play_minute.id'],
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_music_user_play_minute_log_created_at'),
        'music_user_play_minute_log',
        ['created_at'],
        unique=False,
    )
    op.create_index(
        op.f('ix_music_user_play_minute_log_music_user_play_minute_id'),
        'music_user_play_minute_log',
        ['music_user_play_minute_id'],
        unique=False,
    )

    bind = op.get_bind()
    metadata = sa.MetaData()

    minute_table = sa.Table(
        'music_user_play_minute',
        metadata,
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('music_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('play_minutes', sa.Float(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    log_table = sa.Table(
        'music_user_play_minute_log',
        metadata,
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('music_user_play_minute_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )

    rows = bind.execute(
        sa.select(
            minute_table.c.id,
            minute_table.c.user_id,
            minute_table.c.play_minutes,
            minute_table.c.created_at,
        ).order_by(
            minute_table.c.user_id.asc(),
            minute_table.c.created_at.asc(),
            minute_table.c.id.asc(),
        )
    ).fetchall()

    cursors = {}
    log_rows = []
    created_at_updates = []

    for row in rows:
        minutes = int(float(row.play_minutes or 0))
        if minutes <= 0:
            continue

        cursor = cursors.get(row.user_id)
        if cursor is None:
            cursor = datetime.combine(_seed_date(row.created_at), time(BACKFILL_START_HOUR, 0))

        first_created_at = None
        for _ in range(minutes):
            slot = _next_slot(cursor)
            if first_created_at is None:
                first_created_at = slot
            log_rows.append(
                {
                    'music_user_play_minute_id': row.id,
                    'created_at': slot,
                }
            )
            cursor = slot + timedelta(minutes=1)

        cursors[row.user_id] = cursor
        created_at_updates.append(
            {
                'id': row.id,
                'created_at': first_created_at,
            }
        )

    if log_rows:
        op.bulk_insert(log_table, log_rows)
    for item in created_at_updates:
        bind.execute(
            minute_table.update()
            .where(minute_table.c.id == item['id'])
            .values(created_at=item['created_at'])
        )

    with op.batch_alter_table('music_user_play_minute', schema=None) as batch_op:
        batch_op.alter_column(
            'created_at',
            existing_type=sa.DateTime(),
            existing_nullable=False,
            existing_server_default=sa.text('CURRENT_TIMESTAMP'),
            server_default=None,
        )
        batch_op.drop_column('updated_at')


def downgrade():
    with op.batch_alter_table('music_user_play_minute', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'updated_at',
                sa.DateTime(),
                nullable=False,
                server_default=sa.text('CURRENT_TIMESTAMP'),
            )
        )

    op.drop_index(
        op.f('ix_music_user_play_minute_log_music_user_play_minute_id'),
        table_name='music_user_play_minute_log',
    )
    op.drop_index(
        op.f('ix_music_user_play_minute_log_created_at'),
        table_name='music_user_play_minute_log',
    )
    op.drop_table('music_user_play_minute_log')
