"""remove legacy event permission

Revision ID: c6d2e4f8a1b9
Revises: b4c7d9e2f1a3
Create Date: 2026-03-29 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "c6d2e4f8a1b9"
down_revision = "b4c7d9e2f1a3"
branch_labels = None
depends_on = None


def _get_permission_id(connection, name):
    return connection.execute(
        sa.text("SELECT id FROM permission WHERE name = :name LIMIT 1"),
        {"name": name},
    ).scalar()


def _ensure_permission(connection, name):
    permission_id = _get_permission_id(connection, name)
    if permission_id is not None:
        return permission_id

    connection.execute(
        sa.text("INSERT INTO permission (name, ref) VALUES (:name, NULL)"),
        {"name": name},
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
    legacy_event_id = _get_permission_id(connection, "event")
    event_edit_id = _ensure_permission(connection, "event_edit")

    if legacy_event_id is None:
        return

    _copy_department_permission(connection, legacy_event_id, event_edit_id)

    connection.execute(
        sa.text("DELETE FROM department_permission WHERE permission_id = :permission_id"),
        {"permission_id": legacy_event_id},
    )
    connection.execute(
        sa.text("DELETE FROM permission WHERE id = :permission_id"),
        {"permission_id": legacy_event_id},
    )


def downgrade():
    connection = op.get_bind()
    legacy_event_id = _ensure_permission(connection, "event")
    event_edit_id = _get_permission_id(connection, "event_edit")

    _copy_department_permission(connection, event_edit_id, legacy_event_id)
