"""move user nric fields to regis member

Revision ID: e4c2b6a8f1d9
Revises: c9f4a7d1e2b3
Create Date: 2026-03-23 02:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "e4c2b6a8f1d9"
down_revision = "c9f4a7d1e2b3"
branch_labels = None
depends_on = None


def _clean_identity_value(value, *, undefined_as_none=False):
    normalized = str(value or "").strip()
    if not normalized:
        return None
    if undefined_as_none and normalized.lower() == "undefined":
        return None
    return normalized


def upgrade():
    op.add_column("regis_member", sa.Column("name_nric", sa.String(length=100), nullable=True))
    op.alter_column(
        "regis_member",
        "nric",
        existing_type=sa.String(length=20),
        nullable=True,
    )

    op.add_column("user_data", sa.Column("nric_data_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_user_data_nric_data_id"), "user_data", ["nric_data_id"], unique=False)
    with op.batch_alter_table("user_data", schema=None) as batch_op:
        batch_op.create_foreign_key(
            "fk_user_data_nric_data_id",
            "regis_member",
            ["nric_data_id"],
            ["id"],
            ondelete="SET NULL",
            onupdate="CASCADE",
        )

    conn = op.get_bind()
    user_rows = conn.execute(
        sa.text(
            """
            SELECT id, NRIC, name_NRIC
            FROM user_data
            ORDER BY id
            """
        )
    ).mappings().all()

    for row in user_rows:
        user_id = row["id"]
        normalized_nric = _clean_identity_value(row["NRIC"])
        normalized_name = _clean_identity_value(row["name_NRIC"], undefined_as_none=True)
        member_id = None

        if normalized_nric:
            member_row = conn.execute(
                sa.text(
                    """
                    SELECT id, name_nric
                    FROM regis_member
                    WHERE nric = :nric
                    LIMIT 1
                    """
                ),
                {"nric": normalized_nric},
            ).mappings().first()
            if member_row:
                member_id = member_row["id"]
                if normalized_name and not _clean_identity_value(member_row["name_nric"], undefined_as_none=True):
                    conn.execute(
                        sa.text(
                            """
                            UPDATE regis_member
                            SET name_nric = :name_nric
                            WHERE id = :member_id
                            """
                        ),
                        {"name_nric": normalized_name, "member_id": member_id},
                    )
            else:
                insert_result = conn.execute(
                    sa.text(
                        """
                        INSERT INTO regis_member (nric, name_nric)
                        VALUES (:nric, :name_nric)
                        """
                    ),
                    {"nric": normalized_nric, "name_nric": normalized_name},
                )
                member_id = getattr(insert_result, "lastrowid", None)
                if member_id is None:
                    member_id = conn.execute(
                        sa.text(
                            """
                            SELECT id
                            FROM regis_member
                            WHERE nric = :nric
                            LIMIT 1
                            """
                        ),
                        {"nric": normalized_nric},
                    ).scalar()
        elif normalized_name:
            insert_result = conn.execute(
                sa.text(
                    """
                    INSERT INTO regis_member (nric, name_nric)
                    VALUES (NULL, :name_nric)
                    """
                ),
                {"name_nric": normalized_name},
            )
            member_id = getattr(insert_result, "lastrowid", None)

        if member_id is not None:
            conn.execute(
                sa.text(
                    """
                    UPDATE user_data
                    SET nric_data_id = :member_id
                    WHERE id = :user_id
                    """
                ),
                {"member_id": member_id, "user_id": user_id},
            )

    unmatched_count = conn.execute(
        sa.text(
            """
            SELECT COUNT(*)
            FROM user_data
            WHERE (
                TRIM(COALESCE(NRIC, '')) <> ''
                OR (
                    TRIM(COALESCE(name_NRIC, '')) <> ''
                    AND LOWER(TRIM(COALESCE(name_NRIC, ''))) <> 'undefined'
                )
            )
            AND nric_data_id IS NULL
            """
        )
    ).scalar()
    if unmatched_count:
        raise RuntimeError(f"user_data 回填 nric_data_id 失败，仍有 {unmatched_count} 条未匹配")

    op.drop_column("user_data", "NRIC")
    op.drop_column("user_data", "name_NRIC")


def downgrade():
    op.add_column("user_data", sa.Column("name_NRIC", sa.String(length=100), nullable=True))
    op.add_column("user_data", sa.Column("NRIC", sa.String(length=20), nullable=True))

    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            UPDATE user_data AS user_row
            LEFT JOIN regis_member AS member
              ON member.id = user_row.nric_data_id
            SET user_row.NRIC = member.nric,
                user_row.name_NRIC = member.name_nric
            WHERE user_row.nric_data_id IS NOT NULL
            """
        )
    )

    with op.batch_alter_table("user_data", schema=None) as batch_op:
        batch_op.drop_constraint("fk_user_data_nric_data_id", type_="foreignkey")
    op.drop_index(op.f("ix_user_data_nric_data_id"), table_name="user_data")
    op.drop_column("user_data", "nric_data_id")

    conn.execute(
        sa.text(
            """
            DELETE member
            FROM regis_member AS member
            LEFT JOIN regis_member_data AS member_data
              ON member_data.member_id = member.id
            LEFT JOIN regis_form_member AS form_member
              ON form_member.member_id = member.id
            LEFT JOIN regis_payment AS payment
              ON payment.regis_member_id = member.id
            WHERE member.nric IS NULL
              AND member_data.id IS NULL
              AND form_member.member_id IS NULL
              AND payment.id IS NULL
            """
        )
    )

    remaining_null_count = conn.execute(
        sa.text(
            """
            SELECT COUNT(*)
            FROM regis_member
            WHERE nric IS NULL
            """
        )
    ).scalar()
    if remaining_null_count:
        raise RuntimeError(
            f"仍有 {remaining_null_count} 条 regis_member.nric 为空，无法安全降级为非空字段"
        )

    op.drop_column("regis_member", "name_nric")
    op.alter_column(
        "regis_member",
        "nric",
        existing_type=sa.String(length=20),
        nullable=False,
    )
