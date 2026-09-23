"""add image_path to long term fee options

Revision ID: d1f2a3b4c5d6
Revises: 8d3c1b5e7f9a
Create Date: 2026-03-24 00:00:01.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d1f2a3b4c5d6"
down_revision = "8d3c1b5e7f9a"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("membership_fee_option", sa.Column("image_path", sa.String(length=255), nullable=True))
    op.add_column("youth_class_fee_option", sa.Column("image_path", sa.String(length=255), nullable=True))

    op.execute(
        """
        UPDATE membership_fee_option AS fee
        JOIN membership_payment_config AS cfg
          ON cfg.id = fee.membership_payment_config_id
        SET fee.image_path = cfg.image_path
        WHERE fee.image_path IS NULL
          AND cfg.image_path IS NOT NULL
        """
    )

    op.execute(
        """
        UPDATE youth_class_fee_option AS fee
        JOIN youth_class_payment_config AS cfg
          ON cfg.id = fee.youth_class_payment_config_id
        SET fee.image_path = cfg.image_path
        WHERE fee.image_path IS NULL
          AND cfg.image_path IS NOT NULL
        """
    )


def downgrade():
    op.drop_column("youth_class_fee_option", "image_path")
    op.drop_column("membership_fee_option", "image_path")
