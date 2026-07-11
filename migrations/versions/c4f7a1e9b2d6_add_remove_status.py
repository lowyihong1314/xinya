"""add 'remove' to membership + youth-class registration status enums

Revision ID: c4f7a1e9b2d6
Revises: b3e6d9c2a5f8
Create Date: 2026-07-10 03:00:00.000000
"""
from alembic import op


revision = "c4f7a1e9b2d6"
down_revision = "b3e6d9c2a5f8"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE membership_registration "
        "MODIFY COLUMN status ENUM('paid','process','reject','remove') "
        "NOT NULL DEFAULT 'process'"
    )
    op.execute(
        "ALTER TABLE youth_class_registration "
        "MODIFY COLUMN status ENUM('paid','process','reject','remove') "
        "NOT NULL DEFAULT 'process'"
    )


def downgrade():
    op.execute(
        "UPDATE membership_registration SET status = 'reject' WHERE status = 'remove'"
    )
    op.execute(
        "UPDATE youth_class_registration SET status = 'reject' WHERE status = 'remove'"
    )
    op.execute(
        "ALTER TABLE membership_registration "
        "MODIFY COLUMN status ENUM('paid','process','reject') "
        "NOT NULL DEFAULT 'process'"
    )
    op.execute(
        "ALTER TABLE youth_class_registration "
        "MODIFY COLUMN status ENUM('paid','process','reject') "
        "NOT NULL DEFAULT 'process'"
    )
