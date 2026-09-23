"""add youth class registration table

Revision ID: 9d4e6f7a8b9c
Revises: c3f42d7b9e11, f2b6c4d8e1a1
Create Date: 2026-03-22 22:25:00.000000
"""
from pathlib import Path
import json
from datetime import datetime

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision = "9d4e6f7a8b9c"
down_revision = ("c3f42d7b9e11", "f2b6c4d8e1a1")
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "youth_class_registration",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("submitted_at", sa.DateTime(), nullable=False),
        sa.Column("chinese_name", sa.String(length=255), nullable=False),
        sa.Column("english_name", sa.String(length=255), nullable=False),
        sa.Column("nric", sa.String(length=32), nullable=False),
        sa.Column("age", sa.Integer(), nullable=False),
        sa.Column("category", sa.Enum("青少年", "青年", name="youth_class_category_enum"), nullable=False),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column("gender", sa.Enum("男", "女", name="youth_class_gender_enum"), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("emergency_contact_name", sa.String(length=255), nullable=False),
        sa.Column("emergency_contact_phone", sa.String(length=32), nullable=False),
        sa.Column("emergency_contact_relation", sa.String(length=255), nullable=False),
        sa.Column("status", sa.Enum("paid", "process", "reject", name="youth_class_registration_status_enum"), nullable=False, server_default="process"),
        sa.Column("regis_payment_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["regis_payment_id"], ["regis_payment.id"], ondelete="SET NULL", onupdate="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    op.create_index(op.f("ix_youth_class_registration_nric"), "youth_class_registration", ["nric"], unique=False)
    op.create_index(op.f("ix_youth_class_registration_regis_payment_id"), "youth_class_registration", ["regis_payment_id"], unique=False)

    conn = op.get_bind()
    legacy_file = Path("/home/yukang/flaskapp/xinya/tmp/youth_class_registrations.json")
    if not legacy_file.exists():
        return

    try:
        rows = json.loads(legacy_file.read_text(encoding="utf-8"))
    except Exception:
        rows = []

    if not isinstance(rows, list):
        return

    table = sa.table(
        "youth_class_registration",
        sa.column("submitted_at", sa.DateTime()),
        sa.column("chinese_name", sa.String()),
        sa.column("english_name", sa.String()),
        sa.column("nric", sa.String()),
        sa.column("age", sa.Integer()),
        sa.column("category", sa.String()),
        sa.column("address", sa.Text()),
        sa.column("gender", sa.String()),
        sa.column("phone", sa.String()),
        sa.column("emergency_contact_name", sa.String()),
        sa.column("emergency_contact_phone", sa.String()),
        sa.column("emergency_contact_relation", sa.String()),
        sa.column("status", sa.String()),
    )

    payload = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        submitted_at_raw = str(item.get("submitted_at") or "").strip()
        try:
            submitted_at = datetime.strptime(submitted_at_raw, "%Y-%m-%d %H:%M:%S") if submitted_at_raw else datetime.utcnow()
        except Exception:
            submitted_at = datetime.utcnow()
        payload.append(
            {
                "submitted_at": submitted_at,
                "chinese_name": str(item.get("chinese_name") or "").strip(),
                "english_name": str(item.get("english_name") or "").strip(),
                "nric": str(item.get("nric") or "").strip(),
                "age": int(item.get("age") or 0),
                "category": str(item.get("category") or "青年").strip() or "青年",
                "address": str(item.get("address") or "").strip(),
                "gender": str(item.get("gender") or "男").strip() or "男",
                "phone": str(item.get("phone") or "").strip(),
                "emergency_contact_name": str(item.get("emergency_contact_name") or "").strip(),
                "emergency_contact_phone": str(item.get("emergency_contact_phone") or "").strip(),
                "emergency_contact_relation": str(item.get("emergency_contact_relation") or "").strip(),
                "status": "process",
            }
        )

    if payload:
        conn.execute(table.insert(), payload)


def downgrade():
    op.drop_index(op.f("ix_youth_class_registration_regis_payment_id"), table_name="youth_class_registration")
    op.drop_index(op.f("ix_youth_class_registration_nric"), table_name="youth_class_registration")
    op.drop_table("youth_class_registration")
