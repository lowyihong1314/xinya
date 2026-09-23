"""add regis payment member id

Revision ID: c9f4a7d1e2b3
Revises: b1e3c7f9d2aa
Create Date: 2026-03-23 00:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "c9f4a7d1e2b3"
down_revision = "b1e3c7f9d2aa"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("regis_payment", sa.Column("regis_member_id", sa.Integer(), nullable=True))
    op.create_index(
        op.f("ix_regis_payment_regis_member_id"),
        "regis_payment",
        ["regis_member_id"],
        unique=False,
    )

    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            UPDATE regis_payment AS payment
            JOIN regis_member AS member
              ON member.nric = payment.nric
            SET payment.regis_member_id = member.id
            WHERE payment.regis_member_id IS NULL
            """
        )
    )

    unmatched_count = conn.execute(
        sa.text(
            """
            SELECT COUNT(*)
            FROM regis_payment
            WHERE regis_member_id IS NULL
            """
        )
    ).scalar()
    if unmatched_count:
        raise RuntimeError(f"regis_payment 回填 regis_member_id 失败，仍有 {unmatched_count} 笔未匹配")

    op.alter_column(
        "regis_payment",
        "regis_member_id",
        existing_type=sa.Integer(),
        nullable=False,
    )

    with op.batch_alter_table("regis_payment", schema=None) as batch_op:
        batch_op.drop_constraint("fk_payment_nric", type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_regis_payment_member_id",
            "regis_member",
            ["regis_member_id"],
            ["id"],
        )


def downgrade():
    with op.batch_alter_table("regis_payment", schema=None) as batch_op:
        batch_op.drop_constraint("fk_regis_payment_member_id", type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_payment_nric",
            "regis_member",
            ["nric"],
            ["nric"],
        )

    op.drop_index(op.f("ix_regis_payment_regis_member_id"), table_name="regis_payment")
    op.drop_column("regis_payment", "regis_member_id")
