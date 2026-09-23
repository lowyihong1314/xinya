"""unify long term payments into regis payment

Revision ID: b6f5e4d3c2a1
Revises: e7b4c2d1a9f0
Create Date: 2026-03-24 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b6f5e4d3c2a1"
down_revision = "e7b4c2d1a9f0"
branch_labels = None
depends_on = None


def _table_exists(bind, table_name):
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _scalar(bind, sql):
    return bind.exec_driver_sql(sql).scalar()


def _ensure_membership_config(bind):
    config_id = _scalar(
        bind,
        "SELECT id FROM membership_payment_config ORDER BY updated_at DESC, id DESC LIMIT 1",
    )
    if config_id:
        return config_id

    bind.exec_driver_sql(
        """
        INSERT INTO membership_payment_config (amount, description, image_path, created_at, updated_at)
        VALUES (0, NULL, NULL, NOW(), NOW())
        """
    )
    return _scalar(bind, "SELECT LAST_INSERT_ID()")


def _ensure_youth_config(bind):
    config_id = _scalar(
        bind,
        "SELECT id FROM youth_class_payment_config ORDER BY updated_at DESC, id DESC LIMIT 1",
    )
    if config_id:
        return config_id

    bind.exec_driver_sql(
        """
        INSERT INTO youth_class_payment_config (amount, description, image_path, created_at, updated_at)
        VALUES (0, NULL, NULL, NOW(), NOW())
        """
    )
    return _scalar(bind, "SELECT LAST_INSERT_ID()")


def upgrade():
    bind = op.get_bind()

    with op.batch_alter_table("regis_payment", schema=None) as batch_op:
        batch_op.alter_column("regis_form_id", existing_type=sa.Integer(), nullable=True)
        batch_op.add_column(sa.Column("payment_scope", sa.String(length=32), nullable=False, server_default="form"))
        batch_op.add_column(sa.Column("membership_registration_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("youth_class_registration_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("created_at", sa.DateTime(), nullable=True))
        batch_op.create_index("ix_regis_payment_payment_scope", ["payment_scope"], unique=False)
        batch_op.create_index("ix_regis_payment_membership_registration_id", ["membership_registration_id"], unique=False)
        batch_op.create_index("ix_regis_payment_youth_class_registration_id", ["youth_class_registration_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_regis_payment_membership_registration_id",
            "membership_registration",
            ["membership_registration_id"],
            ["id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
        )
        batch_op.create_foreign_key(
            "fk_regis_payment_youth_class_registration_id",
            "youth_class_registration",
            ["youth_class_registration_id"],
            ["id"],
            ondelete="CASCADE",
            onupdate="CASCADE",
        )

    bind.exec_driver_sql(
        """
        UPDATE regis_payment
        SET payment_scope = 'form'
        WHERE payment_scope IS NULL OR payment_scope = ''
        """
    )
    bind.exec_driver_sql(
        """
        UPDATE regis_payment
        SET created_at = COALESCE(created_at, TIMESTAMP(date, time), NOW())
        WHERE created_at IS NULL
        """
    )

    if _table_exists(bind, "membership_payment"):
        bind.exec_driver_sql(
            """
            INSERT INTO regis_payment (
                regis_form_id,
                payment_scope,
                membership_registration_id,
                youth_class_registration_id,
                nric_asset_id,
                nric,
                name,
                phone,
                payment_mode,
                price,
                date,
                time,
                status,
                counter,
                proof_image_path,
                created_at
            )
            SELECT
                NULL,
                'membership',
                mp.membership_registration_id,
                NULL,
                mr.nric_asset_id,
                COALESCE(na.nric, ''),
                COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(na.name_nric), ''), NULLIF(TRIM(u.username), ''), '会员付款'),
                COALESCE(NULLIF(TRIM(u.phone), ''), ''),
                mp.payment_mode,
                mp.amount,
                mp.date,
                mp.time,
                mp.status,
                mp.counter,
                mp.proof_image_path,
                COALESCE(mp.created_at, TIMESTAMP(mp.date, mp.time), NOW())
            FROM membership_payment mp
            INNER JOIN membership_registration mr ON mr.id = mp.membership_registration_id
            LEFT JOIN nric_asset na ON na.id = mr.nric_asset_id
            LEFT JOIN user_data u ON u.id = mr.user_id
            """
        )

    if _table_exists(bind, "youth_class_payment"):
        bind.exec_driver_sql(
            """
            INSERT INTO regis_payment (
                regis_form_id,
                payment_scope,
                membership_registration_id,
                youth_class_registration_id,
                nric_asset_id,
                nric,
                name,
                phone,
                payment_mode,
                price,
                date,
                time,
                status,
                counter,
                proof_image_path,
                created_at
            )
            SELECT
                NULL,
                'youth_class',
                NULL,
                yp.youth_class_registration_id,
                yr.nric_asset_id,
                COALESCE(na.nric, ''),
                COALESCE(NULLIF(TRIM(yr.chinese_name), ''), NULLIF(TRIM(yr.english_name), ''), NULLIF(TRIM(na.name_nric), ''), '青少年佛学班付款'),
                COALESCE(NULLIF(TRIM(yr.phone), ''), ''),
                yp.payment_mode,
                yp.amount,
                yp.date,
                yp.time,
                yp.status,
                yp.counter,
                yp.proof_image_path,
                COALESCE(yp.created_at, TIMESTAMP(yp.date, yp.time), NOW())
            FROM youth_class_payment yp
            INNER JOIN youth_class_registration yr ON yr.id = yp.youth_class_registration_id
            LEFT JOIN nric_asset na ON na.id = yr.nric_asset_id
            """
        )
        bind.exec_driver_sql(
            """
            UPDATE youth_class_registration yr
            LEFT JOIN (
                SELECT youth_class_registration_id, MAX(id) AS latest_payment_id
                FROM regis_payment
                WHERE payment_scope = 'youth_class' AND youth_class_registration_id IS NOT NULL
                GROUP BY youth_class_registration_id
            ) latest ON latest.youth_class_registration_id = yr.id
            SET yr.regis_payment_id = latest.latest_payment_id
            """
        )

    op.alter_column("regis_payment", "created_at", existing_type=sa.DateTime(), nullable=False)

    if _table_exists(bind, "membership_payment"):
        op.drop_table("membership_payment")
    if _table_exists(bind, "youth_class_payment"):
        op.drop_table("youth_class_payment")
    if _table_exists(bind, "membership_fee_option"):
        op.drop_table("membership_fee_option")
    if _table_exists(bind, "youth_class_fee_option"):
        op.drop_table("youth_class_fee_option")


def downgrade():
    bind = op.get_bind()

    if not _table_exists(bind, "membership_fee_option"):
        op.create_table(
            "membership_fee_option",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("membership_payment_config_id", sa.Integer(), nullable=False),
            sa.Column("age_range_from", sa.Integer(), nullable=True),
            sa.Column("age_range_to", sa.Integer(), nullable=True),
            sa.Column("amount", sa.Numeric(10, 2), nullable=False),
            sa.Column("description", sa.String(length=255), nullable=True),
            sa.Column("image_path", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(
                ["membership_payment_config_id"],
                ["membership_payment_config.id"],
                ondelete="CASCADE",
                onupdate="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _table_exists(bind, "youth_class_fee_option"):
        op.create_table(
            "youth_class_fee_option",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("youth_class_payment_config_id", sa.Integer(), nullable=False),
            sa.Column("age_range_from", sa.Integer(), nullable=True),
            sa.Column("age_range_to", sa.Integer(), nullable=True),
            sa.Column("amount", sa.Numeric(10, 2), nullable=False),
            sa.Column("description", sa.String(length=255), nullable=True),
            sa.Column("image_path", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(
                ["youth_class_payment_config_id"],
                ["youth_class_payment_config.id"],
                ondelete="CASCADE",
                onupdate="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _table_exists(bind, "membership_payment"):
        op.create_table(
            "membership_payment",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("membership_registration_id", sa.Integer(), nullable=False),
            sa.Column("amount", sa.Numeric(10, 2), nullable=False),
            sa.Column("payment_mode", sa.String(length=20), nullable=False),
            sa.Column("status", sa.Enum("fail", "process", "checked", name="membership_payment_status_enum"), nullable=False),
            sa.Column("counter", sa.String(length=50), nullable=True),
            sa.Column("proof_image_path", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("date", sa.Date(), nullable=False),
            sa.Column("time", sa.Time(), nullable=False),
            sa.ForeignKeyConstraint(
                ["membership_registration_id"],
                ["membership_registration.id"],
                ondelete="CASCADE",
                onupdate="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _table_exists(bind, "youth_class_payment"):
        op.create_table(
            "youth_class_payment",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("youth_class_registration_id", sa.Integer(), nullable=False),
            sa.Column("amount", sa.Numeric(10, 2), nullable=False),
            sa.Column("payment_mode", sa.String(length=20), nullable=False),
            sa.Column("status", sa.Enum("fail", "process", "checked", name="youth_class_payment_status_enum"), nullable=False),
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
        )

    membership_config_id = _ensure_membership_config(bind)
    youth_config_id = _ensure_youth_config(bind)

    bind.exec_driver_sql("DELETE FROM membership_fee_option")
    bind.exec_driver_sql("DELETE FROM youth_class_fee_option")
    bind.exec_driver_sql(
        f"""
        INSERT INTO membership_fee_option (
            membership_payment_config_id,
            age_range_from,
            age_range_to,
            amount,
            description,
            image_path,
            created_at
        )
        SELECT
            {membership_config_id},
            age_range_from,
            age_range_to,
            amount,
            description,
            image_path,
            created_at
        FROM registration_fee
        WHERE fee_scope = 'membership'
        ORDER BY id ASC
        """
    )
    bind.exec_driver_sql(
        f"""
        INSERT INTO youth_class_fee_option (
            youth_class_payment_config_id,
            age_range_from,
            age_range_to,
            amount,
            description,
            image_path,
            created_at
        )
        SELECT
            {youth_config_id},
            age_range_from,
            age_range_to,
            amount,
            description,
            image_path,
            created_at
        FROM registration_fee
        WHERE fee_scope = 'youth_class'
        ORDER BY id ASC
        """
    )

    bind.exec_driver_sql("DELETE FROM membership_payment")
    bind.exec_driver_sql("DELETE FROM youth_class_payment")
    bind.exec_driver_sql(
        """
        INSERT INTO membership_payment (
            membership_registration_id,
            amount,
            payment_mode,
            status,
            counter,
            proof_image_path,
            created_at,
            date,
            time
        )
        SELECT
            membership_registration_id,
            price,
            payment_mode,
            status,
            counter,
            proof_image_path,
            created_at,
            date,
            time
        FROM regis_payment
        WHERE payment_scope = 'membership' AND membership_registration_id IS NOT NULL
        ORDER BY id ASC
        """
    )
    bind.exec_driver_sql(
        """
        INSERT INTO youth_class_payment (
            youth_class_registration_id,
            amount,
            payment_mode,
            status,
            counter,
            proof_image_path,
            created_at,
            date,
            time
        )
        SELECT
            youth_class_registration_id,
            price,
            payment_mode,
            status,
            counter,
            proof_image_path,
            created_at,
            date,
            time
        FROM regis_payment
        WHERE payment_scope = 'youth_class' AND youth_class_registration_id IS NOT NULL
        ORDER BY id ASC
        """
    )

    bind.exec_driver_sql("DELETE FROM regis_payment WHERE payment_scope IN ('membership', 'youth_class')")

    with op.batch_alter_table("regis_payment", schema=None) as batch_op:
        batch_op.drop_constraint("fk_regis_payment_membership_registration_id", type_="foreignkey")
        batch_op.drop_constraint("fk_regis_payment_youth_class_registration_id", type_="foreignkey")
        batch_op.drop_index("ix_regis_payment_membership_registration_id")
        batch_op.drop_index("ix_regis_payment_payment_scope")
        batch_op.drop_index("ix_regis_payment_youth_class_registration_id")
        batch_op.drop_column("membership_registration_id")
        batch_op.drop_column("youth_class_registration_id")
        batch_op.drop_column("payment_scope")
        batch_op.drop_column("created_at")
        batch_op.alter_column("regis_form_id", existing_type=sa.Integer(), nullable=False)
