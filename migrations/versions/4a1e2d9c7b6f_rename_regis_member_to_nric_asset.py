"""rename regis_member to nric_asset

Revision ID: 4a1e2d9c7b6f
Revises: 0f6c2e7a9d1b
Create Date: 2026-03-24 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "4a1e2d9c7b6f"
down_revision = "0f6c2e7a9d1b"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("regis_payment") as batch_op:
        batch_op.drop_constraint("fk_regis_payment_member_id", type_="foreignkey")
        batch_op.drop_index("ix_regis_payment_regis_member_id")

    with op.batch_alter_table("user_data") as batch_op:
        batch_op.drop_constraint("fk_user_data_nric_data_id", type_="foreignkey")
        batch_op.drop_index("ix_user_data_nric_data_id")

    with op.batch_alter_table("youth_class_registration") as batch_op:
        batch_op.drop_constraint("fk_youth_class_registration_member_id", type_="foreignkey")
        batch_op.drop_index("ix_youth_class_registration_regis_member_id")

    with op.batch_alter_table("membership_registration") as batch_op:
        batch_op.drop_constraint("membership_registration_ibfk_1", type_="foreignkey")
        batch_op.drop_index("ix_membership_registration_regis_member_id")

    with op.batch_alter_table("regis_form_member") as batch_op:
        batch_op.drop_constraint("regis_form_member_ibfk_1", type_="foreignkey")

    with op.batch_alter_table("regis_member_data") as batch_op:
        batch_op.drop_constraint("regis_member_data_ibfk_1", type_="foreignkey")

    op.rename_table("regis_member", "nric_asset")

    with op.batch_alter_table("regis_payment") as batch_op:
        batch_op.alter_column(
            "regis_member_id",
            new_column_name="nric_asset_id",
            existing_type=sa.Integer(),
            existing_nullable=False,
        )
        batch_op.create_index("ix_regis_payment_nric_asset_id", ["nric_asset_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_regis_payment_nric_asset_id",
            "nric_asset",
            ["nric_asset_id"],
            ["id"],
        )

    with op.batch_alter_table("user_data") as batch_op:
        batch_op.alter_column(
            "nric_data_id",
            new_column_name="nric_asset_id",
            existing_type=sa.Integer(),
            existing_nullable=True,
        )
        batch_op.create_index("ix_user_data_nric_asset_id", ["nric_asset_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_user_data_nric_asset_id",
            "nric_asset",
            ["nric_asset_id"],
            ["id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
        )

    with op.batch_alter_table("youth_class_registration") as batch_op:
        batch_op.alter_column(
            "regis_member_id",
            new_column_name="nric_asset_id",
            existing_type=sa.Integer(),
            existing_nullable=False,
        )
        batch_op.create_index("ix_youth_class_registration_nric_asset_id", ["nric_asset_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_youth_class_registration_nric_asset_id",
            "nric_asset",
            ["nric_asset_id"],
            ["id"],
            onupdate="CASCADE",
        )

    with op.batch_alter_table("membership_registration") as batch_op:
        batch_op.alter_column(
            "regis_member_id",
            new_column_name="nric_asset_id",
            existing_type=sa.Integer(),
            existing_nullable=False,
        )
        batch_op.create_index("ix_membership_registration_nric_asset_id", ["nric_asset_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_membership_registration_nric_asset_id",
            "nric_asset",
            ["nric_asset_id"],
            ["id"],
            onupdate="CASCADE",
        )

    with op.batch_alter_table("regis_form_member") as batch_op:
        batch_op.create_foreign_key(
            "fk_regis_form_member_nric_asset",
            "nric_asset",
            ["member_id"],
            ["id"],
            ondelete="CASCADE",
        )

    with op.batch_alter_table("regis_member_data") as batch_op:
        batch_op.create_foreign_key(
            "fk_regis_member_data_nric_asset",
            "nric_asset",
            ["member_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade():
    with op.batch_alter_table("regis_payment") as batch_op:
        batch_op.drop_constraint("fk_regis_payment_nric_asset_id", type_="foreignkey")
        batch_op.drop_index("ix_regis_payment_nric_asset_id")

    with op.batch_alter_table("user_data") as batch_op:
        batch_op.drop_constraint("fk_user_data_nric_asset_id", type_="foreignkey")
        batch_op.drop_index("ix_user_data_nric_asset_id")

    with op.batch_alter_table("youth_class_registration") as batch_op:
        batch_op.drop_constraint("fk_youth_class_registration_nric_asset_id", type_="foreignkey")
        batch_op.drop_index("ix_youth_class_registration_nric_asset_id")

    with op.batch_alter_table("membership_registration") as batch_op:
        batch_op.drop_constraint("fk_membership_registration_nric_asset_id", type_="foreignkey")
        batch_op.drop_index("ix_membership_registration_nric_asset_id")

    with op.batch_alter_table("regis_form_member") as batch_op:
        batch_op.drop_constraint("fk_regis_form_member_nric_asset", type_="foreignkey")

    with op.batch_alter_table("regis_member_data") as batch_op:
        batch_op.drop_constraint("fk_regis_member_data_nric_asset", type_="foreignkey")

    with op.batch_alter_table("regis_payment") as batch_op:
        batch_op.alter_column(
            "nric_asset_id",
            new_column_name="regis_member_id",
            existing_type=sa.Integer(),
            existing_nullable=False,
        )
        batch_op.create_index("ix_regis_payment_regis_member_id", ["regis_member_id"], unique=False)

    with op.batch_alter_table("user_data") as batch_op:
        batch_op.alter_column(
            "nric_asset_id",
            new_column_name="nric_data_id",
            existing_type=sa.Integer(),
            existing_nullable=True,
        )
        batch_op.create_index("ix_user_data_nric_data_id", ["nric_data_id"], unique=False)

    with op.batch_alter_table("youth_class_registration") as batch_op:
        batch_op.alter_column(
            "nric_asset_id",
            new_column_name="regis_member_id",
            existing_type=sa.Integer(),
            existing_nullable=False,
        )
        batch_op.create_index("ix_youth_class_registration_regis_member_id", ["regis_member_id"], unique=False)

    with op.batch_alter_table("membership_registration") as batch_op:
        batch_op.alter_column(
            "nric_asset_id",
            new_column_name="regis_member_id",
            existing_type=sa.Integer(),
            existing_nullable=False,
        )
        batch_op.create_index("ix_membership_registration_regis_member_id", ["regis_member_id"], unique=False)

    op.rename_table("nric_asset", "regis_member")

    with op.batch_alter_table("regis_payment") as batch_op:
        batch_op.create_foreign_key(
            "fk_regis_payment_member_id",
            "regis_member",
            ["regis_member_id"],
            ["id"],
        )

    with op.batch_alter_table("user_data") as batch_op:
        batch_op.create_foreign_key(
            "fk_user_data_nric_data_id",
            "regis_member",
            ["nric_data_id"],
            ["id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
        )

    with op.batch_alter_table("youth_class_registration") as batch_op:
        batch_op.create_foreign_key(
            "fk_youth_class_registration_member_id",
            "regis_member",
            ["regis_member_id"],
            ["id"],
            onupdate="CASCADE",
        )

    with op.batch_alter_table("membership_registration") as batch_op:
        batch_op.create_foreign_key(
            "membership_registration_ibfk_1",
            "regis_member",
            ["regis_member_id"],
            ["id"],
            onupdate="CASCADE",
        )

    with op.batch_alter_table("regis_form_member") as batch_op:
        batch_op.create_foreign_key(
            "regis_form_member_ibfk_1",
            "regis_member",
            ["member_id"],
            ["id"],
            ondelete="CASCADE",
        )

    with op.batch_alter_table("regis_member_data") as batch_op:
        batch_op.create_foreign_key(
            "regis_member_data_ibfk_1",
            "regis_member",
            ["member_id"],
            ["id"],
            ondelete="CASCADE",
        )
