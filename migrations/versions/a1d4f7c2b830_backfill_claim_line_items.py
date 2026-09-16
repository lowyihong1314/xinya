"""清洗报销单：任何没有明细行的单据都补成一行，之后后端不再接受无明细的单

e7b1c93a2f45 建表时搬过一次旧数据，但当时后端还留着「只给金额和用途」的兜底路径，
所以之后仍可能产生整单没有明细行的单据。这里再扫一遍收尾，配合 services 里去掉
兜底，之后「没有明细的报销单」不再存在。

Revision ID: a1d4f7c2b830
Revises: e2b7d5c1a934
Create Date: 2026-09-13 00:00:00.000000
"""
import re

from alembic import op
import sqlalchemy as sa


revision = "a1d4f7c2b830"
down_revision = "e2b7d5c1a934"
branch_labels = None
depends_on = None

PARENT = "reimbursement_request"
TABLE = "reimbursement_line"

# 「做账分配」以前缀形式存在 purpose 里，正文才是用途，前缀要原样留在 purpose。
ACCT_PREFIX_RE = re.compile(r"^(【做账分配：[^】]*】)\s*", re.UNICODE)


def _purpose_body(raw_purpose):
    text = (raw_purpose or "").strip()
    match = ACCT_PREFIX_RE.match(text)
    return text[match.end():].strip() if match else text


def upgrade():
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    if not inspector.has_table(TABLE) or not inspector.has_table(PARENT):
        return

    rows = connection.execute(
        sa.text(
            f"""
            SELECT r.id, r.amount, r.purpose, r.vendor_name
            FROM {PARENT} r
            LEFT JOIN {TABLE} l ON l.request_id = r.id
            WHERE l.id IS NULL
            """
        )
    ).fetchall()

    for row in rows:
        request_id, amount, purpose, vendor_name = row[0], row[1], row[2], row[3]
        description = _purpose_body(purpose) or (vendor_name or "").strip() or "（旧单据，无明细）"
        connection.execute(
            sa.text(
                f"""
                INSERT INTO {TABLE} (request_id, line_no, description, category, quantity, unit_price, amount, created_at)
                VALUES (:request_id, 1, :description, NULL, NULL, NULL, :amount, NOW())
                """
            ),
            {
                "request_id": request_id,
                "description": description[:2000],
                "amount": round(float(amount or 0), 2),
            },
        )

    print(f"[migrate] 补明细行的报销单：{len(rows)} 张")


def downgrade():
    # 补出来的明细行无法与原本就只有一行的单据区分，不做回退。
    pass
