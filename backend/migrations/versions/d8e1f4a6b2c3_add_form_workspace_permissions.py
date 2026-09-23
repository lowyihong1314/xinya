"""add form workspace permissions

Revision ID: d8e1f4a6b2c3
Revises: c6d2e4f8a1b9
Create Date: 2026-03-29 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "d8e1f4a6b2c3"
down_revision = "c6d2e4f8a1b9"
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


def _copy_department_permission(connection, source_permission_id, target_permission_id):
    if source_permission_id is None or target_permission_id is None:
        return

    connection.execute(
        sa.text(
            """
            INSERT INTO department_permission (department_id, permission_id)
            SELECT source.department_id, :target_permission_id
            FROM department_permission AS source
            LEFT JOIN department_permission AS existing
              ON existing.department_id = source.department_id
             AND existing.permission_id = :target_permission_id
            WHERE source.permission_id = :source_permission_id
              AND existing.department_id IS NULL
            """
        ),
        {
            "source_permission_id": source_permission_id,
            "target_permission_id": target_permission_id,
        },
    )


def upgrade():
    connection = op.get_bind()

    form_read_id = _ensure_permission(connection, "form_read", "读取报名表工作台")
    form_edit_id = _ensure_permission(connection, "form_edit", "编辑报名表与成员资料")
    member_detail_id = _ensure_permission(connection, "member_detail", "查看报名成员敏感详情")
    youth_class_read_id = _ensure_permission(connection, "youth_class_read", "读取青少年班报名后台")
    youth_class_edit_id = _ensure_permission(connection, "youth_class_edit", "编辑青少年班报名后台")

    member_id = _get_permission_id(connection, "member")
    member_edit_id = _get_permission_id(connection, "member_edit")

    _copy_department_permission(connection, member_id, form_read_id)
    _copy_department_permission(connection, member_id, member_detail_id)
    _copy_department_permission(connection, member_id, youth_class_read_id)

    _copy_department_permission(connection, member_edit_id, form_read_id)
    _copy_department_permission(connection, member_edit_id, form_edit_id)
    _copy_department_permission(connection, member_edit_id, member_detail_id)
    _copy_department_permission(connection, member_edit_id, youth_class_read_id)
    _copy_department_permission(connection, member_edit_id, youth_class_edit_id)


def downgrade():
    connection = op.get_bind()

    for permission_name in [
        "form_read",
        "form_edit",
        "member_detail",
        "youth_class_read",
        "youth_class_edit",
    ]:
        permission_id = _get_permission_id(connection, permission_name)
        if permission_id is None:
            continue

        connection.execute(
            sa.text("DELETE FROM department_permission WHERE permission_id = :permission_id"),
            {"permission_id": permission_id},
        )
        connection.execute(
            sa.text("DELETE FROM permission WHERE id = :permission_id"),
            {"permission_id": permission_id},
        )
