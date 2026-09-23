"""move youth registration nric to regis member

Revision ID: f7a9c3e1b2d4
Revises: e4c2b6a8f1d9
Create Date: 2026-03-23 03:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "f7a9c3e1b2d4"
down_revision = "e4c2b6a8f1d9"
branch_labels = None
depends_on = None


def _clean_value(value, *, undefined_as_none=False):
    normalized = str(value or "").strip()
    if not normalized:
        return None
    if undefined_as_none and normalized.lower() == "undefined":
        return None
    return normalized


def upgrade():
    op.add_column("youth_class_registration", sa.Column("regis_member_id", sa.Integer(), nullable=True))
    op.create_index(
        op.f("ix_youth_class_registration_regis_member_id"),
        "youth_class_registration",
        ["regis_member_id"],
        unique=False,
    )

    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            """
            SELECT id, nric, english_name
            FROM youth_class_registration
            ORDER BY id
            """
        )
    ).mappings().all()

    for row in rows:
        registration_id = row["id"]
        normalized_nric = _clean_value(row["nric"])
        normalized_name = _clean_value(row["english_name"], undefined_as_none=True)
        if not normalized_nric:
            raise RuntimeError(f"youth_class_registration #{registration_id} 缺少有效 NRIC，无法迁移")

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
            if normalized_name and not _clean_value(member_row["name_nric"], undefined_as_none=True):
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

        conn.execute(
            sa.text(
                """
                UPDATE youth_class_registration
                SET regis_member_id = :member_id
                WHERE id = :registration_id
                """
            ),
            {"member_id": member_id, "registration_id": registration_id},
        )

    unmatched_count = conn.execute(
        sa.text(
            """
            SELECT COUNT(*)
            FROM youth_class_registration
            WHERE regis_member_id IS NULL
            """
        )
    ).scalar()
    if unmatched_count:
        raise RuntimeError(
            f"youth_class_registration 回填 regis_member_id 失败，仍有 {unmatched_count} 条未匹配"
        )

    op.alter_column(
        "youth_class_registration",
        "regis_member_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
    with op.batch_alter_table("youth_class_registration", schema=None) as batch_op:
        batch_op.create_foreign_key(
            "fk_youth_class_registration_member_id",
            "regis_member",
            ["regis_member_id"],
            ["id"],
            ondelete="RESTRICT",
            onupdate="CASCADE",
        )

    op.drop_index(op.f("ix_youth_class_registration_nric"), table_name="youth_class_registration")
    op.drop_column("youth_class_registration", "nric")


def downgrade():
    op.add_column("youth_class_registration", sa.Column("nric", sa.String(length=32), nullable=True))

    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            UPDATE youth_class_registration AS registration
            LEFT JOIN regis_member AS member
              ON member.id = registration.regis_member_id
            SET registration.nric = member.nric
            WHERE registration.regis_member_id IS NOT NULL
            """
        )
    )

    missing_nric_count = conn.execute(
        sa.text(
            """
            SELECT COUNT(*)
            FROM youth_class_registration
            WHERE TRIM(COALESCE(nric, '')) = ''
            """
        )
    ).scalar()
    if missing_nric_count:
        raise RuntimeError(
            f"仍有 {missing_nric_count} 条 youth_class_registration 无法恢复 NRIC，无法安全降级"
        )

    op.alter_column(
        "youth_class_registration",
        "nric",
        existing_type=sa.String(length=32),
        nullable=False,
    )
    op.create_index(
        op.f("ix_youth_class_registration_nric"),
        "youth_class_registration",
        ["nric"],
        unique=False,
    )

    with op.batch_alter_table("youth_class_registration", schema=None) as batch_op:
        batch_op.drop_constraint("fk_youth_class_registration_member_id", type_="foreignkey")

    op.drop_index(
        op.f("ix_youth_class_registration_regis_member_id"),
        table_name="youth_class_registration",
    )
    op.drop_column("youth_class_registration", "regis_member_id")
