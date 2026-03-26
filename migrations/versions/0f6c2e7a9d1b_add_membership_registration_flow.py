"""add membership registration flow

Revision ID: 0f6c2e7a9d1b
Revises: f7a9c3e1b2d4
Create Date: 2026-03-24 00:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0f6c2e7a9d1b"
down_revision = "f7a9c3e1b2d4"
branch_labels = None
depends_on = None


membership_registration_type_enum = sa.Enum(
    "upgrade",
    "renew",
    name="membership_registration_type_enum",
)
membership_registration_status_enum = sa.Enum(
    "paid",
    "process",
    "reject",
    name="membership_registration_status_enum",
)
membership_role_enum = sa.Enum(
    "见习青芽",
    "普通会员",
    "青芽",
    name="membership_role_enum",
)
membership_payment_status_enum = sa.Enum(
    "fail",
    "process",
    "checked",
    name="membership_payment_status_enum",
)


def upgrade():
    op.create_table(
        "membership_registration",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("submitted_at", sa.DateTime(), nullable=False),
        sa.Column("registration_type", membership_registration_type_enum, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("regis_member_id", sa.Integer(), nullable=False),
        sa.Column("payment_token", sa.String(length=64), nullable=False),
        sa.Column("status", membership_registration_status_enum, nullable=False),
        sa.Column("target_expiry_date", sa.Date(), nullable=True),
        sa.Column("facebook_profile_url", sa.String(length=500), nullable=True),
        sa.Column("nric_address", sa.Text(), nullable=True),
        sa.Column("ancestral_home", sa.String(length=255), nullable=True),
        sa.Column("occupation", sa.String(length=255), nullable=True),
        sa.Column("refuge_taken", sa.Boolean(), nullable=True),
        sa.Column("refuge_year", sa.Integer(), nullable=True),
        sa.Column("refuge_master", sa.String(length=255), nullable=True),
        sa.Column("dharma_name", sa.String(length=255), nullable=True),
        sa.Column("emergency_contact_name", sa.String(length=255), nullable=True),
        sa.Column("emergency_contact_phone", sa.String(length=32), nullable=True),
        sa.Column("guardian_name", sa.String(length=255), nullable=True),
        sa.Column("guardian_phone", sa.String(length=32), nullable=True),
        sa.Column("recommender_user_id", sa.Integer(), nullable=True),
        sa.Column("membership_role", membership_role_enum, nullable=True),
        sa.ForeignKeyConstraint(
            ["regis_member_id"],
            ["regis_member.id"],
            ondelete="RESTRICT",
            onupdate="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["recommender_user_id"],
            ["user_data.id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user_data.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("payment_token"),
    )
    op.create_index(
        op.f("ix_membership_registration_registration_type"),
        "membership_registration",
        ["registration_type"],
        unique=False,
    )
    op.create_index(
        op.f("ix_membership_registration_user_id"),
        "membership_registration",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_membership_registration_regis_member_id"),
        "membership_registration",
        ["regis_member_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_membership_registration_status"),
        "membership_registration",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_membership_registration_recommender_user_id"),
        "membership_registration",
        ["recommender_user_id"],
        unique=False,
    )

    op.create_table(
        "membership_payment_config",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("amount", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("image_path", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "membership_payment",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("membership_registration_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("payment_mode", sa.String(length=20), nullable=False),
        sa.Column("status", membership_payment_status_enum, nullable=False),
        sa.Column("counter", sa.String(length=50), nullable=True),
        sa.Column("proof_image_path", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("time", sa.Time(), nullable=False),
        sa.ForeignKeyConstraint(
            ["membership_registration_id"],
            ["membership_registration.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_membership_payment_membership_registration_id"),
        "membership_payment",
        ["membership_registration_id"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        op.f("ix_membership_payment_membership_registration_id"),
        table_name="membership_payment",
    )
    op.drop_table("membership_payment")
    op.drop_table("membership_payment_config")

    op.drop_index(
        op.f("ix_membership_registration_recommender_user_id"),
        table_name="membership_registration",
    )
    op.drop_index(
        op.f("ix_membership_registration_status"),
        table_name="membership_registration",
    )
    op.drop_index(
        op.f("ix_membership_registration_regis_member_id"),
        table_name="membership_registration",
    )
    op.drop_index(
        op.f("ix_membership_registration_user_id"),
        table_name="membership_registration",
    )
    op.drop_index(
        op.f("ix_membership_registration_registration_type"),
        table_name="membership_registration",
    )
    op.drop_table("membership_registration")

    membership_payment_status_enum.drop(op.get_bind(), checkfirst=True)
    membership_role_enum.drop(op.get_bind(), checkfirst=True)
    membership_registration_status_enum.drop(op.get_bind(), checkfirst=True)
    membership_registration_type_enum.drop(op.get_bind(), checkfirst=True)
