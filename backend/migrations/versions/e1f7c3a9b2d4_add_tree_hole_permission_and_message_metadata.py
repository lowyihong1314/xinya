"""add tree hole permission and message metadata

Revision ID: e1f7c3a9b2d4
Revises: d8e1f4a6b2c3
Create Date: 2026-03-29 02:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "e1f7c3a9b2d4"
down_revision = "d8e1f4a6b2c3"
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

    with op.batch_alter_table("dorp_message", schema=None) as batch_op:
        batch_op.add_column(sa.Column("updated_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("user_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("author_name", sa.String(length=120), nullable=True))
        batch_op.create_index(batch_op.f("ix_dorp_message_user_id"), ["user_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_dorp_message_user_id",
            "user_data",
            ["user_id"],
            ["id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
        )

    connection.execute(
        sa.text(
            """
            UPDATE dorp_message
            SET updated_at = COALESCE(updated_at, created_at)
            """
        )
    )

    info_tree_hole_id = _ensure_permission(connection, "info_tree_hole", "查看与管理树洞留言")
    edit_info_id = _get_permission_id(connection, "edit_info")
    _copy_department_permission(connection, edit_info_id, info_tree_hole_id)


def downgrade():
    connection = op.get_bind()

    permission_id = _get_permission_id(connection, "info_tree_hole")
    if permission_id is not None:
        connection.execute(
            sa.text("DELETE FROM department_permission WHERE permission_id = :permission_id"),
            {"permission_id": permission_id},
        )
        connection.execute(
            sa.text("DELETE FROM permission WHERE id = :permission_id"),
            {"permission_id": permission_id},
        )

    with op.batch_alter_table("dorp_message", schema=None) as batch_op:
        batch_op.drop_constraint("fk_dorp_message_user_id", type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_dorp_message_user_id"))
        batch_op.drop_column("author_name")
        batch_op.drop_column("user_id")
        batch_op.drop_column("updated_at")
