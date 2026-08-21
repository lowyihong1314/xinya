"""法会原始文档表 fahui_raw_doc + 与订单的关联表 fahui_raw_doc_order

Revision ID: a5d70e1c9b34
Revises: f4a91c7d3e28
Create Date: 2026-08-21 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "a5d70e1c9b34"
down_revision = "f4a91c7d3e28"
branch_labels = None
depends_on = None

DOC_TABLE = "fahui_raw_doc"
LINK_TABLE = "fahui_raw_doc_order"


def _has_table(connection, name) -> bool:
    return sa.inspect(connection).has_table(name)


def upgrade():
    connection = op.get_bind()

    if not _has_table(connection, DOC_TABLE):
        op.create_table(
            DOC_TABLE,
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("filename", sa.String(length=255), nullable=False),
            sa.Column("source", sa.String(length=64), nullable=True),
            sa.Column("shot_date", sa.Date(), nullable=True),
            sa.Column("file_size", sa.Integer(), nullable=True),
            sa.Column("sha256", sa.String(length=64), nullable=True),
            sa.Column("extract_key", sa.String(length=32), nullable=True),
            sa.Column("customer_name", sa.String(length=160), nullable=True),
            sa.Column("phone", sa.String(length=64), nullable=True),
            sa.Column("declared_total", sa.Numeric(10, 2), nullable=True),
            sa.Column("review_flag_count", sa.Integer(), nullable=True),
            sa.Column("plan", sa.Text(), nullable=True),
            sa.Column("duplicate_of", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("filename", name="uq_fahui_raw_doc_filename"),
        )
        op.create_index("ix_fahui_raw_doc_shot_date", DOC_TABLE, ["shot_date"])
        op.create_index("ix_fahui_raw_doc_sha256", DOC_TABLE, ["sha256"])
        op.create_index("ix_fahui_raw_doc_extract_key", DOC_TABLE, ["extract_key"])
        op.create_index("ix_fahui_raw_doc_phone", DOC_TABLE, ["phone"])

    if not _has_table(connection, LINK_TABLE):
        op.create_table(
            LINK_TABLE,
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("raw_doc_id", sa.Integer(), nullable=False),
            sa.Column("order_id", sa.Integer(), nullable=False),
            sa.Column("match_by", sa.String(length=32), nullable=True),
            sa.Column("confidence", sa.String(length=16), nullable=True),
            sa.Column("note", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(
                ["raw_doc_id"], [f"{DOC_TABLE}.id"],
                name="fk_raw_doc_order_doc", ondelete="CASCADE", onupdate="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["order_id"], ["orders.id"],
                name="fk_raw_doc_order_order", ondelete="CASCADE", onupdate="CASCADE",
            ),
            sa.UniqueConstraint("raw_doc_id", "order_id", name="uq_fahui_raw_doc_order"),
        )
        op.create_index("ix_fahui_raw_doc_order_doc", LINK_TABLE, ["raw_doc_id"])
        op.create_index("ix_fahui_raw_doc_order_order", LINK_TABLE, ["order_id"])


def downgrade():
    connection = op.get_bind()
    if _has_table(connection, LINK_TABLE):
        op.drop_index("ix_fahui_raw_doc_order_order", table_name=LINK_TABLE)
        op.drop_index("ix_fahui_raw_doc_order_doc", table_name=LINK_TABLE)
        op.drop_table(LINK_TABLE)
    if _has_table(connection, DOC_TABLE):
        for index in (
            "ix_fahui_raw_doc_phone",
            "ix_fahui_raw_doc_extract_key",
            "ix_fahui_raw_doc_sha256",
            "ix_fahui_raw_doc_shot_date",
        ):
            op.drop_index(index, table_name=DOC_TABLE)
        op.drop_table(DOC_TABLE)
