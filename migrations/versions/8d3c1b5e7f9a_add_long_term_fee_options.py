"""add long term fee options

Revision ID: 8d3c1b5e7f9a
Revises: 4a1e2d9c7b6f
Create Date: 2026-03-24 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "8d3c1b5e7f9a"
down_revision = "4a1e2d9c7b6f"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "membership_fee_option",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("membership_payment_config_id", sa.Integer(), nullable=False),
        sa.Column("age_range_from", sa.Integer(), nullable=True),
        sa.Column("age_range_to", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["membership_payment_config_id"],
            ["membership_payment_config.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_membership_fee_option_membership_payment_config_id"),
        "membership_fee_option",
        ["membership_payment_config_id"],
        unique=False,
    )

    op.create_table(
        "youth_class_fee_option",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("youth_class_payment_config_id", sa.Integer(), nullable=False),
        sa.Column("age_range_from", sa.Integer(), nullable=True),
        sa.Column("age_range_to", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["youth_class_payment_config_id"],
            ["youth_class_payment_config.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_youth_class_fee_option_youth_class_payment_config_id"),
        "youth_class_fee_option",
        ["youth_class_payment_config_id"],
        unique=False,
    )

    op.execute(
        """
        INSERT INTO membership_fee_option (
            membership_payment_config_id,
            age_range_from,
            age_range_to,
            amount,
            description,
            created_at
        )
        SELECT
            cfg.id,
            NULL,
            NULL,
            cfg.amount,
            cfg.description,
            COALESCE(cfg.updated_at, cfg.created_at, UTC_TIMESTAMP())
        FROM membership_payment_config AS cfg
        """
    )

    op.execute(
        """
        INSERT INTO youth_class_fee_option (
            youth_class_payment_config_id,
            age_range_from,
            age_range_to,
            amount,
            description,
            created_at
        )
        SELECT
            cfg.id,
            NULL,
            NULL,
            cfg.amount,
            cfg.description,
            COALESCE(cfg.updated_at, cfg.created_at, UTC_TIMESTAMP())
        FROM youth_class_payment_config AS cfg
        """
    )


def downgrade():
    op.drop_index(
        op.f("ix_youth_class_fee_option_youth_class_payment_config_id"),
        table_name="youth_class_fee_option",
    )
    op.drop_table("youth_class_fee_option")

    op.drop_index(
        op.f("ix_membership_fee_option_membership_payment_config_id"),
        table_name="membership_fee_option",
    )
    op.drop_table("membership_fee_option")
