"""allow public membership registrations

Revision ID: c1e4f8a9b7d2
Revises: 92d7d3e6f4ab
Create Date: 2026-04-02 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "c1e4f8a9b7d2"
down_revision = "92d7d3e6f4ab"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "membership_registration",
        sa.Column("requested_username", sa.String(length=255), nullable=True),
    )
    op.alter_column(
        "membership_registration",
        "user_id",
        existing_type=sa.Integer(),
        nullable=True,
    )

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE membership_registration AS mr
            LEFT JOIN user_data AS u
              ON u.id = mr.user_id
            SET mr.requested_username = COALESCE(mr.requested_username, u.username)
            WHERE mr.requested_username IS NULL
               OR TRIM(mr.requested_username) = ''
            """
        )
    )


def downgrade():
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            DELETE FROM membership_registration
            WHERE user_id IS NULL
            """
        )
    )

    op.alter_column(
        "membership_registration",
        "user_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.drop_column("membership_registration", "requested_username")
