"""detach reimbursement_request from department

Revision ID: f1c2d3e4b5a6
Revises: d6b3f7a1c9e2
Create Date: 2026-03-29 00:30:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "f1c2d3e4b5a6"
down_revision = "d6b3f7a1c9e2"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("reimbursement_request", sa.Column("department_name", sa.String(length=100), nullable=True))

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE reimbursement_request AS rr
            LEFT JOIN department AS d ON d.id = rr.department_id
            SET rr.department_name = COALESCE(NULLIF(TRIM(d.name), ''), CONCAT('Department #', rr.department_id))
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE reimbursement_request
            SET department_name = '未分类'
            WHERE department_name IS NULL OR TRIM(department_name) = ''
            """
        )
    )

    with op.batch_alter_table("reimbursement_request", schema=None) as batch_op:
        batch_op.alter_column("department_name", existing_type=sa.String(length=100), nullable=False)
        batch_op.drop_constraint("fk_rr_department", type_="foreignkey")
        batch_op.drop_index("ix_reimbursement_request_department_id")
        batch_op.drop_column("department_id")
        batch_op.create_index(batch_op.f("ix_reimbursement_request_department_name"), ["department_name"], unique=False)


def downgrade():
    with op.batch_alter_table("reimbursement_request", schema=None) as batch_op:
        batch_op.add_column(sa.Column("department_id", sa.Integer(), nullable=True))
        batch_op.drop_index(batch_op.f("ix_reimbursement_request_department_name"))
        batch_op.create_index(batch_op.f("ix_reimbursement_request_department_id"), ["department_id"], unique=False)
        batch_op.create_foreign_key("fk_rr_department", "department", ["department_id"], ["id"], onupdate="CASCADE")

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE reimbursement_request AS rr
            LEFT JOIN department AS d ON d.name = rr.department_name
            SET rr.department_id = d.id
            """
        )
    )

    with op.batch_alter_table("reimbursement_request", schema=None) as batch_op:
        batch_op.drop_column("department_name")
