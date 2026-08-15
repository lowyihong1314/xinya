"""报销单明细行 reimbursement_line：旧 purpose 迁成一行明细，ref1+ref2 合并进 purpose 后 drop

Revision ID: e7b1c93a2f45
Revises: c8e4a2b6d9f1
Create Date: 2026-08-15 00:00:00.000000
"""
import re

from alembic import op
import sqlalchemy as sa


revision = "e7b1c93a2f45"
down_revision = "c8e4a2b6d9f1"
branch_labels = None
depends_on = None

PARENT = "reimbursement_request"
TABLE = "reimbursement_line"

# 用途里「做账分配」是以前缀形式存在 purpose 里的，迁移时必须原样留在 purpose，
# 只有前缀后面的正文才搬去明细行。
ACCT_PREFIX_RE = re.compile(r"^(【做账分配：[^】]*】)\s*", re.UNICODE)


def _inspector(connection):
    return sa.inspect(connection)


def _has_table(connection) -> bool:
    return _inspector(connection).has_table(TABLE)


def _columns(connection, table) -> set:
    if not _inspector(connection).has_table(table):
        return set()
    return {column["name"] for column in _inspector(connection).get_columns(table)}


def _split_purpose(raw_purpose):
    """返回 (做账分配前缀, 正文)。"""
    text = (raw_purpose or "").strip()
    match = ACCT_PREFIX_RE.match(text)
    if not match:
        return "", text
    return match.group(1), text[match.end():].strip()


def upgrade():
    connection = op.get_bind()

    if not _has_table(connection):
        op.create_table(
            TABLE,
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("request_id", sa.Integer(), nullable=False),
            sa.Column("line_no", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("category", sa.String(length=64), nullable=True),
            sa.Column("quantity", sa.Numeric(12, 3), nullable=True),
            sa.Column("unit_price", sa.Numeric(12, 2), nullable=True),
            sa.Column("amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(
                ["request_id"],
                [f"{PARENT}.id"],
                name="fk_reimbursement_line_request",
                ondelete="CASCADE",
                onupdate="CASCADE",
            ),
        )
        op.create_index("ix_reimbursement_line_request_id", TABLE, ["request_id"])

    parent_columns = _columns(connection, PARENT)
    has_refs = "ref1" in parent_columns and "ref2" in parent_columns

    # ---- 存量数据搬迁 ----
    # 每张旧单：purpose 正文 → 一条明细行；ref1 + ref2 合并成新的 purpose（说明）。
    select_columns = "id, amount, purpose" + (", ref1, ref2" if has_refs else "")
    rows = connection.execute(
        sa.text(
            f"SELECT {select_columns} FROM {PARENT} "
            f"WHERE id NOT IN (SELECT request_id FROM {TABLE})"
        )
    ).mappings().all()

    for row in rows:
        prefix, body = _split_purpose(row.get("purpose"))
        amount = float(row.get("amount") or 0)

        connection.execute(
            sa.text(
                f"INSERT INTO {TABLE} (request_id, line_no, description, amount, created_at) "
                "VALUES (:request_id, 1, :description, :amount, NOW())"
            ),
            {
                "request_id": row["id"],
                # 正文为空的老单也要留一行，否则整单没有明细
                "description": body or "（旧单未填用途说明）",
                "amount": amount,
            },
        )

        # purpose 腾出来放「说明」：正文已经搬进明细行，这里换成 ref1 + ref2 合并的内容。
        # 做账分配前缀必须留下（UI 靠它识别做账分配）。
        merged = ""
        if has_refs:
            merged = "\n".join(
                part
                for part in [str(row.get("ref1") or "").strip(), str(row.get("ref2") or "").strip()]
                if part
            )

        next_purpose = "\n".join(part for part in [prefix, merged] if part).strip()
        connection.execute(
            sa.text(f"UPDATE {PARENT} SET purpose = :purpose WHERE id = :id"),
            {"purpose": next_purpose or None, "id": row["id"]},
        )

    # ---- purpose 改为可空（明细才是必填），ref1/ref2 下线 ----
    op.alter_column(PARENT, "purpose", existing_type=sa.Text(), nullable=True)

    if has_refs:
        op.drop_column(PARENT, "ref1")
        op.drop_column(PARENT, "ref2")


def downgrade():
    connection = op.get_bind()
    parent_columns = _columns(connection, PARENT)

    if "ref1" not in parent_columns:
        op.add_column(PARENT, sa.Column("ref1", sa.Text(), nullable=True))
    if "ref2" not in parent_columns:
        op.add_column(PARENT, sa.Column("ref2", sa.Text(), nullable=True))

    # 把明细行拼回 purpose，保证回滚后 purpose 非空可用
    rows = connection.execute(
        sa.text(f"SELECT id, purpose FROM {PARENT}")
    ).mappings().all()
    for row in rows:
        lines = connection.execute(
            sa.text(
                f"SELECT description, amount FROM {TABLE} "
                "WHERE request_id = :id ORDER BY line_no, id"
            ),
            {"id": row["id"]},
        ).mappings().all()
        if not lines:
            continue
        body = "\n".join(
            f"{line['description']} RM {float(line['amount'] or 0):.2f}" for line in lines
        )
        note = str(row.get("purpose") or "").strip()
        connection.execute(
            sa.text(f"UPDATE {PARENT} SET purpose = :purpose, ref1 = :ref1 WHERE id = :id"),
            {"purpose": body, "ref1": note or None, "id": row["id"]},
        )

    connection.execute(sa.text(f"UPDATE {PARENT} SET purpose = '' WHERE purpose IS NULL"))
    op.alter_column(PARENT, "purpose", existing_type=sa.Text(), nullable=False)

    if _has_table(connection):
        op.drop_index("ix_reimbursement_line_request_id", table_name=TABLE)
        op.drop_table(TABLE)
