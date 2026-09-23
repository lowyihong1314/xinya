"""add asset partner master

Revision ID: 5f8d1f9e6a21
Revises: c03c0cd76f66
Create Date: 2026-04-26 08:40:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "5f8d1f9e6a21"
down_revision = "c03c0cd76f66"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "asset_partner",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("partner_type", sa.String(length=30), nullable=False),
        sa.Column("contact_person", sa.String(length=120), nullable=True),
        sa.Column("phone", sa.String(length=60), nullable=True),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("remark", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("asset_partner", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_asset_partner_code"), ["code"], unique=True)
        batch_op.create_index(batch_op.f("ix_asset_partner_partner_type"), ["partner_type"], unique=False)
        batch_op.create_index(batch_op.f("ix_asset_partner_status"), ["status"], unique=False)

    with op.batch_alter_table("asset_stock_document", schema=None) as batch_op:
        batch_op.add_column(sa.Column("counterparty_id", sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f("ix_asset_stock_document_counterparty_id"), ["counterparty_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_asset_stock_document_counterparty_id_asset_partner",
            "asset_partner",
            ["counterparty_id"],
            ["id"],
            onupdate="CASCADE",
            ondelete="SET NULL",
        )


def downgrade():
    with op.batch_alter_table("asset_stock_document", schema=None) as batch_op:
        batch_op.drop_constraint("fk_asset_stock_document_counterparty_id_asset_partner", type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_asset_stock_document_counterparty_id"))
        batch_op.drop_column("counterparty_id")

    with op.batch_alter_table("asset_partner", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_asset_partner_status"))
        batch_op.drop_index(batch_op.f("ix_asset_partner_partner_type"))
        batch_op.drop_index(batch_op.f("ix_asset_partner_code"))

    op.drop_table("asset_partner")
