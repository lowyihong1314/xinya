"""split account submit permission into claim and income

Revision ID: d2e8f4a6c1b3
Revises: b8e2c7a4d1f0
Create Date: 2026-06-02 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "d2e8f4a6c1b3"
down_revision = "b8e2c7a4d1f0"
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
        sa.text("INSERT INTO permission (name, ref) VALUES (:name, :name)"),
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


def _delete_permission(connection, permission_id):
    if permission_id is None:
        return

    connection.execute(
        sa.text("DELETE FROM department_permission WHERE permission_id = :permission_id"),
        {"permission_id": permission_id},
    )
    connection.execute(
        sa.text("DELETE FROM permission WHERE id = :permission_id"),
        {"permission_id": permission_id},
    )


def upgrade():
    connection = op.get_bind()

    account_submit_id = _get_permission_id(connection, "account_submit")
    account_submit_claim_id = _ensure_permission(connection, "account_submit_claim")
    _ensure_permission(connection, "account_submit_income")

    _copy_department_permission(connection, account_submit_id, account_submit_claim_id)
    _delete_permission(connection, account_submit_id)


def downgrade():
    connection = op.get_bind()

    account_submit_id = _ensure_permission(connection, "account_submit")
    account_submit_claim_id = _get_permission_id(connection, "account_submit_claim")
    account_submit_income_id = _get_permission_id(connection, "account_submit_income")

    _copy_department_permission(connection, account_submit_claim_id, account_submit_id)
    _delete_permission(connection, account_submit_claim_id)
    _delete_permission(connection, account_submit_income_id)
