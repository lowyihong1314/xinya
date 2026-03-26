"""add youth class payment flow

Revision ID: b1e3c7f9d2aa
Revises: 9d4e6f7a8b9c
Create Date: 2026-03-23 00:00:00.000000
"""

import secrets

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision = "b1e3c7f9d2aa"
down_revision = "9d4e6f7a8b9c"
branch_labels = None
depends_on = None


def _generate_token(used_tokens):
    while True:
        token = secrets.token_urlsafe(24)
        if token not in used_tokens:
            used_tokens.add(token)
            return token


def upgrade():
    op.add_column(
        "youth_class_registration",
        sa.Column("payment_token", sa.String(length=64), nullable=True),
    )

    conn = op.get_bind()
    used_tokens = {
        row[0]
        for row in conn.execute(
            sa.text(
                """
                SELECT payment_token
                FROM youth_class_registration
                WHERE payment_token IS NOT NULL
                  AND TRIM(payment_token) <> ''
                """
            )
        )
        if row[0]
    }
    entry_ids = [
        row[0]
        for row in conn.execute(
            sa.text(
                """
                SELECT id
                FROM youth_class_registration
                WHERE payment_token IS NULL
                   OR TRIM(payment_token) = ''
                """
            )
        )
    ]
    for entry_id in entry_ids:
        conn.execute(
            sa.text(
                """
                UPDATE youth_class_registration
                SET payment_token = :payment_token
                WHERE id = :entry_id
                """
            ),
            {"payment_token": _generate_token(used_tokens), "entry_id": entry_id},
        )

    op.alter_column(
        "youth_class_registration",
        "payment_token",
        existing_type=sa.String(length=64),
        nullable=False,
    )
    op.create_index(
        op.f("ix_youth_class_registration_payment_token"),
        "youth_class_registration",
        ["payment_token"],
        unique=True,
    )

    op.create_table(
        "youth_class_payment_config",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False, server_default="0.00"),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("image_path", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )

    op.create_table(
        "youth_class_payment",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("youth_class_registration_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("payment_mode", sa.String(length=20), nullable=False, server_default="QR"),
        sa.Column(
            "status",
            sa.Enum("fail", "process", "checked", name="youth_class_payment_status_enum"),
            nullable=False,
            server_default="process",
        ),
        sa.Column("counter", sa.String(length=50), nullable=True),
        sa.Column("proof_image_path", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("time", sa.Time(), nullable=False),
        sa.ForeignKeyConstraint(
            ["youth_class_registration_id"],
            ["youth_class_registration.id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    op.create_index(
        op.f("ix_youth_class_payment_youth_class_registration_id"),
        "youth_class_payment",
        ["youth_class_registration_id"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        op.f("ix_youth_class_payment_youth_class_registration_id"),
        table_name="youth_class_payment",
    )
    op.drop_table("youth_class_payment")
    op.drop_table("youth_class_payment_config")
    op.drop_index(
        op.f("ix_youth_class_registration_payment_token"),
        table_name="youth_class_registration",
    )
    op.drop_column("youth_class_registration", "payment_token")
