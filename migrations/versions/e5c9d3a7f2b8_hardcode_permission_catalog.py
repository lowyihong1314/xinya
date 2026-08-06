"""权限清单代码化：department_permission 改存权限名，删除 permission 表

Revision ID: e5c9d3a7f2b8
Revises: d4b8e2f7a1c9
Create Date: 2026-08-06 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "e5c9d3a7f2b8"
down_revision = "d4b8e2f7a1c9"
branch_labels = None
depends_on = None


def _tables(connection):
    return set(sa.inspect(connection).get_table_names())


def _columns(connection, table):
    return {c["name"] for c in sa.inspect(connection).get_columns(table)}


def upgrade():
    connection = op.get_bind()
    tables = _tables(connection)

    if "department_permission" in tables and "permission_name" in _columns(connection, "department_permission"):
        return  # 已迁移

    op.create_table(
        "department_permission_new",
        sa.Column(
            "department_id",
            sa.Integer(),
            sa.ForeignKey("department.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("permission_name", sa.String(length=100), primary_key=True),
    )

    if "department_permission" in tables and "permission" in tables:
        op.execute(
            "INSERT INTO department_permission_new (department_id, permission_name) "
            "SELECT dp.department_id, p.name FROM department_permission dp "
            "JOIN permission p ON p.id = dp.permission_id"
        )

    if "department_permission" in tables:
        op.drop_table("department_permission")
    op.rename_table("department_permission_new", "department_permission")

    if "permission" in tables:
        op.drop_table("permission")


def downgrade():
    connection = op.get_bind()

    op.create_table(
        "permission",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=100), nullable=False, unique=True),
        sa.Column("ref", sa.String(length=100), nullable=True),
    )
    op.execute(
        "INSERT INTO permission (name, ref) "
        "SELECT DISTINCT permission_name, permission_name FROM department_permission"
    )
    op.create_table(
        "department_permission_old",
        sa.Column(
            "department_id",
            sa.Integer(),
            sa.ForeignKey("department.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "permission_id",
            sa.Integer(),
            sa.ForeignKey("permission.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.execute(
        "INSERT INTO department_permission_old (department_id, permission_id) "
        "SELECT dp.department_id, p.id FROM department_permission dp "
        "JOIN permission p ON p.name = dp.permission_name"
    )
    op.drop_table("department_permission")
    op.rename_table("department_permission_old", "department_permission")
