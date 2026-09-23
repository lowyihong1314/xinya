"""add membership council signature table and council_approve permission

Revision ID: f7a3c1b9d2e5
Revises: e5a7c9d2f4b6
Create Date: 2026-07-10 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "f7a3c1b9d2e5"
down_revision = "e5a7c9d2f4b6"
branch_labels = None
depends_on = None


def _get_permission_id(connection, name):
    return connection.execute(
        sa.text("SELECT id FROM permission WHERE name = :name LIMIT 1"),
        {"name": name},
    ).scalar()


def _ensure_permission(connection, name, ref):
    permission_id = _get_permission_id(connection, name)
    if permission_id is not None:
        return permission_id
    connection.execute(
        sa.text("INSERT INTO permission (name, ref) VALUES (:name, :ref)"),
        {"name": name, "ref": ref},
    )
    return _get_permission_id(connection, name)


def upgrade():
    op.create_table(
        "membership_council_signature",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("membership_registration_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("signed_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["membership_registration_id"],
            ["membership_registration.id"],
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
            "membership_registration_id",
            "user_id",
            name="uq_membership_council_signature_reg_user",
        ),
    )
    with op.batch_alter_table("membership_council_signature", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_membership_council_signature_membership_registration_id"),
            ["membership_registration_id"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_membership_council_signature_user_id"),
            ["user_id"],
            unique=False,
        )

    connection = op.get_bind()
    _ensure_permission(connection, "council_approve", "理事会审批会员申请签名")


def downgrade():
    connection = op.get_bind()
    permission_id = _get_permission_id(connection, "council_approve")
    if permission_id is not None:
        connection.execute(
            sa.text("DELETE FROM department_permission WHERE permission_id = :permission_id"),
            {"permission_id": permission_id},
        )
        connection.execute(
            sa.text("DELETE FROM permission WHERE id = :permission_id"),
            {"permission_id": permission_id},
        )

    with op.batch_alter_table("membership_council_signature", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_membership_council_signature_user_id"))
        batch_op.drop_index(batch_op.f("ix_membership_council_signature_membership_registration_id"))
    op.drop_table("membership_council_signature")
