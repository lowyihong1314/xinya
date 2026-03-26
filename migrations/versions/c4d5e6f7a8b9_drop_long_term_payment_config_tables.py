"""drop long term payment config tables

Revision ID: c4d5e6f7a8b9
Revises: b6f5e4d3c2a1
Create Date: 2026-03-24 00:00:01.000000
"""

from alembic import op
import sqlalchemy as sa
from datetime import datetime


revision = "c4d5e6f7a8b9"
down_revision = "b6f5e4d3c2a1"
branch_labels = None
depends_on = None


def _table_exists(bind, table_name):
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _latest_config_row(bind, table_name):
    if not _table_exists(bind, table_name):
        return None
    return (
        bind.execute(
            sa.text(
                f"""
                SELECT id, amount, description, image_path, created_at, updated_at
                FROM {table_name}
                ORDER BY updated_at DESC, id DESC
                LIMIT 1
                """
            )
        )
        .mappings()
        .first()
    )


def _merge_scope_config_into_fees(bind, table_name, fee_scope):
    row = _latest_config_row(bind, table_name)
    if not row:
        return

    fee_count = bind.execute(
        sa.text("SELECT COUNT(*) FROM registration_fee WHERE fee_scope = :fee_scope"),
        {"fee_scope": fee_scope},
    ).scalar() or 0

    if fee_count:
        if str(row.get("description") or "").strip():
            bind.execute(
                sa.text(
                    """
                    UPDATE registration_fee
                    SET description = :description
                    WHERE fee_scope = :fee_scope
                      AND (description IS NULL OR TRIM(description) = '')
                    """
                ),
                {"fee_scope": fee_scope, "description": row["description"]},
            )
        if str(row.get("image_path") or "").strip():
            bind.execute(
                sa.text(
                    """
                    UPDATE registration_fee
                    SET image_path = :image_path
                    WHERE fee_scope = :fee_scope
                      AND (image_path IS NULL OR TRIM(image_path) = '')
                    """
                ),
                {"fee_scope": fee_scope, "image_path": row["image_path"]},
            )
        return

    amount = row.get("amount")
    if amount is None or amount <= 0:
        return

    bind.execute(
        sa.text(
            """
            INSERT INTO registration_fee (
                regis_form_id,
                fee_scope,
                category,
                age_range_from,
                age_range_to,
                amount,
                description,
                image_path,
                created_at
            )
            VALUES (
                NULL,
                :fee_scope,
                '所有年龄',
                NULL,
                NULL,
                :amount,
                :description,
                :image_path,
                :created_at
            )
            """
        ),
        {
            "fee_scope": fee_scope,
            "amount": amount,
            "description": row.get("description"),
            "image_path": row.get("image_path"),
            "created_at": row.get("updated_at") or row.get("created_at") or datetime.utcnow(),
        },
    )


def upgrade():
    bind = op.get_bind()
    _merge_scope_config_into_fees(bind, "membership_payment_config", "membership")
    _merge_scope_config_into_fees(bind, "youth_class_payment_config", "youth_class")

    if _table_exists(bind, "membership_payment_config"):
        op.drop_table("membership_payment_config")
    if _table_exists(bind, "youth_class_payment_config"):
        op.drop_table("youth_class_payment_config")


def downgrade():
    bind = op.get_bind()

    if not _table_exists(bind, "membership_payment_config"):
        op.create_table(
            "membership_payment_config",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("amount", sa.Numeric(10, 2), nullable=False, server_default="0"),
            sa.Column("description", sa.String(length=255), nullable=True),
            sa.Column("image_path", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _table_exists(bind, "youth_class_payment_config"):
        op.create_table(
            "youth_class_payment_config",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("amount", sa.Numeric(10, 2), nullable=False, server_default="0"),
            sa.Column("description", sa.String(length=255), nullable=True),
            sa.Column("image_path", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )

    membership_fee = (
        bind.execute(
            sa.text(
                """
                SELECT amount, description, image_path, created_at
                FROM registration_fee
                WHERE fee_scope = 'membership'
                ORDER BY id ASC
                LIMIT 1
                """
            )
        )
        .mappings()
        .first()
    )
    youth_fee = (
        bind.execute(
            sa.text(
                """
                SELECT amount, description, image_path, created_at
                FROM registration_fee
                WHERE fee_scope = 'youth_class'
                ORDER BY id ASC
                LIMIT 1
                """
            )
        )
        .mappings()
        .first()
    )

    if membership_fee:
        bind.execute(sa.text("DELETE FROM membership_payment_config"))
        bind.execute(
            sa.text(
                """
                INSERT INTO membership_payment_config (amount, description, image_path, created_at, updated_at)
                VALUES (:amount, :description, :image_path, :created_at, :updated_at)
                """
            ),
            {
                "amount": membership_fee["amount"],
                "description": membership_fee["description"],
                "image_path": membership_fee["image_path"],
                "created_at": membership_fee["created_at"] or datetime.utcnow(),
                "updated_at": membership_fee["created_at"] or datetime.utcnow(),
            },
        )

    if youth_fee:
        bind.execute(sa.text("DELETE FROM youth_class_payment_config"))
        bind.execute(
            sa.text(
                """
                INSERT INTO youth_class_payment_config (amount, description, image_path, created_at, updated_at)
                VALUES (:amount, :description, :image_path, :created_at, :updated_at)
                """
            ),
            {
                "amount": youth_fee["amount"],
                "description": youth_fee["description"],
                "image_path": youth_fee["image_path"],
                "created_at": youth_fee["created_at"] or datetime.utcnow(),
                "updated_at": youth_fee["created_at"] or datetime.utcnow(),
            },
        )
