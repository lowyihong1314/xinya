"""unify long term fees into registration_fee

Revision ID: e7b4c2d1a9f0
Revises: d1f2a3b4c5d6
Create Date: 2026-03-24 00:00:02.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e7b4c2d1a9f0"
down_revision = "d1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "registration_fee",
        sa.Column("fee_scope", sa.String(length=32), nullable=False, server_default="form"),
    )
    op.create_index(op.f("ix_registration_fee_fee_scope"), "registration_fee", ["fee_scope"], unique=False)
    op.alter_column("registration_fee", "regis_form_id", existing_type=sa.Integer(), nullable=True)

    op.execute(
        """
        INSERT INTO registration_fee (
            regis_form_id,
            fee_scope,
            category,
            age_range_from,
            age_range_to,
            amount,
            description,
            image_path,
            created_at
        )
        SELECT
            NULL,
            'membership',
            CASE
                WHEN fee.age_range_from IS NOT NULL AND fee.age_range_to IS NOT NULL THEN CONCAT(fee.age_range_from, '-', fee.age_range_to, ' 岁')
                WHEN fee.age_range_from IS NOT NULL THEN CONCAT(fee.age_range_from, ' 岁以上')
                WHEN fee.age_range_to IS NOT NULL THEN CONCAT(fee.age_range_to, ' 岁以下')
                ELSE '所有年龄'
            END,
            fee.age_range_from,
            fee.age_range_to,
            fee.amount,
            fee.description,
            COALESCE(fee.image_path, cfg.image_path),
            COALESCE(fee.created_at, cfg.updated_at, cfg.created_at, UTC_TIMESTAMP())
        FROM membership_fee_option AS fee
        LEFT JOIN membership_payment_config AS cfg
          ON cfg.id = fee.membership_payment_config_id
        """
    )

    op.execute(
        """
        INSERT INTO registration_fee (
            regis_form_id,
            fee_scope,
            category,
            age_range_from,
            age_range_to,
            amount,
            description,
            image_path,
            created_at
        )
        SELECT
            NULL,
            'youth_class',
            CASE
                WHEN fee.age_range_from IS NOT NULL AND fee.age_range_to IS NOT NULL THEN CONCAT(fee.age_range_from, '-', fee.age_range_to, ' 岁')
                WHEN fee.age_range_from IS NOT NULL THEN CONCAT(fee.age_range_from, ' 岁以上')
                WHEN fee.age_range_to IS NOT NULL THEN CONCAT(fee.age_range_to, ' 岁以下')
                ELSE '所有年龄'
            END,
            fee.age_range_from,
            fee.age_range_to,
            fee.amount,
            fee.description,
            COALESCE(fee.image_path, cfg.image_path),
            COALESCE(fee.created_at, cfg.updated_at, cfg.created_at, UTC_TIMESTAMP())
        FROM youth_class_fee_option AS fee
        LEFT JOIN youth_class_payment_config AS cfg
          ON cfg.id = fee.youth_class_payment_config_id
        """
    )


def downgrade():
    op.execute("DELETE FROM registration_fee WHERE fee_scope IN ('membership', 'youth_class')")
    op.alter_column("registration_fee", "regis_form_id", existing_type=sa.Integer(), nullable=False)
    op.drop_index(op.f("ix_registration_fee_fee_scope"), table_name="registration_fee")
    op.drop_column("registration_fee", "fee_scope")
