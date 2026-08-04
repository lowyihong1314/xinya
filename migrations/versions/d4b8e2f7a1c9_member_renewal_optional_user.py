"""member_renewal: user_id 可空 + 新增 nric_asset_id 锚点（老会员可无登录账号）

Revision ID: d4b8e2f7a1c9
Revises: b3e7f1a9c5d2
Create Date: 2026-08-04 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "d4b8e2f7a1c9"
down_revision = "b3e7f1a9c5d2"
branch_labels = None
depends_on = None

TABLE = "member_renewal"


def _columns(connection):
    inspector = sa.inspect(connection)
    return {column["name"] for column in inspector.get_columns(TABLE)}


def upgrade():
    connection = op.get_bind()
    existing = _columns(connection)

    op.alter_column(
        TABLE,
        "user_id",
        existing_type=sa.Integer(),
        nullable=True,
    )

    if "nric_asset_id" not in existing:
        op.add_column(TABLE, sa.Column("nric_asset_id", sa.Integer(), nullable=True))
        op.create_index("ix_member_renewal_nric_asset_id", TABLE, ["nric_asset_id"])
        op.create_foreign_key(
            "fk_member_renewal_nric_asset",
            TABLE,
            "nric_asset",
            ["nric_asset_id"],
            ["id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
        )
        # 回填：已有记录经 user_data.nric_asset_id 关联
        op.execute(
            "UPDATE member_renewal mr "
            "JOIN user_data u ON u.id = mr.user_id "
            "SET mr.nric_asset_id = u.nric_asset_id "
            "WHERE u.nric_asset_id IS NOT NULL"
        )


def downgrade():
    connection = op.get_bind()
    existing = _columns(connection)
    if "nric_asset_id" in existing:
        op.drop_constraint("fk_member_renewal_nric_asset", TABLE, type_="foreignkey")
        op.drop_index("ix_member_renewal_nric_asset_id", table_name=TABLE)
        op.drop_column(TABLE, "nric_asset_id")
    op.execute("DELETE FROM member_renewal WHERE user_id IS NULL")
    op.alter_column(TABLE, "user_id", existing_type=sa.Integer(), nullable=False)
