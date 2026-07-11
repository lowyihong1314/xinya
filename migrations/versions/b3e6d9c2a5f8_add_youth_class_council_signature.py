"""add youth class council signature table

Revision ID: b3e6d9c2a5f8
Revises: a2d5f8c1b4e7
Create Date: 2026-07-10 02:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "b3e6d9c2a5f8"
down_revision = "a2d5f8c1b4e7"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "youth_class_council_signature",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("youth_class_registration_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("signed_at", sa.DateTime(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(
            ["youth_class_registration_id"],
            ["youth_class_registration.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user_data.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "youth_class_registration_id",
            "user_id",
            name="uq_youth_class_council_signature_reg_user",
        ),
    )
    with op.batch_alter_table("youth_class_council_signature", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_youth_class_council_signature_youth_class_registration_id"),
            ["youth_class_registration_id"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_youth_class_council_signature_user_id"),
            ["user_id"],
            unique=False,
        )


def downgrade():
    with op.batch_alter_table("youth_class_council_signature", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_youth_class_council_signature_user_id"))
        batch_op.drop_index(batch_op.f("ix_youth_class_council_signature_youth_class_registration_id"))
    op.drop_table("youth_class_council_signature")
