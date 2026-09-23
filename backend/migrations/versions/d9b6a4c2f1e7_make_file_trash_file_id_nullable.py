"""make file_trash file_id nullable

Revision ID: d9b6a4c2f1e7
Revises: c1e4f8a9b7d2
Create Date: 2026-04-02 09:35:00
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d9b6a4c2f1e7"
down_revision = "c1e4f8a9b7d2"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE file_trash DROP FOREIGN KEY file_trash_ibfk_3")
    op.alter_column(
        "file_trash",
        "file_id",
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.execute(
        """
        ALTER TABLE file_trash
        ADD CONSTRAINT fk_trash_file_set_null
        FOREIGN KEY (file_id) REFERENCES files (id)
        ON DELETE SET NULL
        """
    )


def downgrade():
    op.execute("ALTER TABLE file_trash DROP FOREIGN KEY fk_trash_file_set_null")
    op.execute("DELETE FROM file_trash WHERE file_id IS NULL")
    op.alter_column(
        "file_trash",
        "file_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.execute(
        """
        ALTER TABLE file_trash
        ADD CONSTRAINT file_trash_ibfk_3
        FOREIGN KEY (file_id) REFERENCES files (id)
        """
    )
