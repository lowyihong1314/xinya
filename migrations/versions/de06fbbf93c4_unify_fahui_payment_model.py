"""unify fahui payment model

Revision ID: de06fbbf93c4
Revises: 2ba482fbd8a7
Create Date: 2026-04-10 08:53:17.461764

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "de06fbbf93c4"
down_revision = "2ba482fbd8a7"
branch_labels = None
depends_on = None


def _copy_lamp_payments_into_payment_data(connection):
    lamp_rows = connection.execute(
        sa.text(
            """
            SELECT
                lp.id,
                lp.submitter_id,
                lp.payer_name,
                lp.phone,
                lp.amount,
                lp.method,
                lp.paid_at,
                lp.note,
                lp.doc_path,
                lp.created_at,
                COALESCE(NULLIF(u.display_name, ''), u.username) AS reviewer_name
            FROM lamp_payment AS lp
            LEFT JOIN user_data AS u ON u.id = lp.submitter_id
            ORDER BY lp.id ASC
            """
        )
    ).mappings().all()

    old_links = connection.execute(
        sa.text(
            """
            SELECT payment_id, registration_id
            FROM lamp_payment_registration
            ORDER BY payment_id ASC, registration_id ASC
            """
        )
    ).mappings().all()

    connection.execute(sa.text("DELETE FROM lamp_payment_registration"))

    payment_id_map: dict[int, int] = {}
    for row in lamp_rows:
        normalized_status = "approved" if row["submitter_id"] else "pending"
        valid_at = (row["paid_at"] or row["created_at"]) if row["submitter_id"] else None
        result = connection.execute(
            sa.text(
                """
                INSERT INTO payment_data (
                    created_at,
                    order_id,
                    type,
                    total_price,
                    status,
                    payment_mode,
                    submitter_id,
                    valid_by,
                    valid_at,
                    payer_name,
                    phone,
                    paid_at,
                    note,
                    document
                ) VALUES (
                    :created_at,
                    NULL,
                    'lamp',
                    :total_price,
                    :status,
                    :payment_mode,
                    :submitter_id,
                    :valid_by,
                    :valid_at,
                    :payer_name,
                    :phone,
                    :paid_at,
                    :note,
                    :document
                )
                """
            ),
            {
                "created_at": row["created_at"],
                "total_price": row["amount"],
                "status": normalized_status,
                "payment_mode": row["method"],
                "submitter_id": row["submitter_id"],
                "valid_by": row["reviewer_name"],
                "valid_at": valid_at,
                "payer_name": row["payer_name"],
                "phone": row["phone"],
                "paid_at": row["paid_at"],
                "note": row["note"],
                "document": row["doc_path"],
            },
        )
        payment_id_map[int(row["id"])] = int(result.lastrowid)

    for link in old_links:
        new_payment_id = payment_id_map.get(int(link["payment_id"]))
        if new_payment_id is None:
            continue
        connection.execute(
            sa.text(
                """
                INSERT INTO lamp_payment_registration (payment_id, registration_id)
                VALUES (:payment_id, :registration_id)
                """
            ),
            {
                "payment_id": new_payment_id,
                "registration_id": link["registration_id"],
            },
        )


def _copy_lamp_payments_back(connection):
    lamp_rows = connection.execute(
        sa.text(
            """
            SELECT
                id,
                submitter_id,
                payer_name,
                phone,
                total_price,
                payment_mode,
                paid_at,
                note,
                document,
                created_at
            FROM payment_data
            WHERE type = 'lamp'
            ORDER BY id ASC
            """
        )
    ).mappings().all()

    link_rows = connection.execute(
        sa.text(
            """
            SELECT payment_id, registration_id
            FROM lamp_payment_registration
            ORDER BY payment_id ASC, registration_id ASC
            """
        )
    ).mappings().all()

    for row in lamp_rows:
        connection.execute(
            sa.text(
                """
                INSERT INTO lamp_payment (
                    id,
                    submitter_id,
                    payer_name,
                    phone,
                    amount,
                    method,
                    paid_at,
                    note,
                    doc_path,
                    created_at
                ) VALUES (
                    :id,
                    :submitter_id,
                    :payer_name,
                    :phone,
                    :amount,
                    :method,
                    :paid_at,
                    :note,
                    :doc_path,
                    :created_at
                )
                """
            ),
            {
                "id": row["id"],
                "submitter_id": row["submitter_id"],
                "payer_name": row["payer_name"],
                "phone": row["phone"],
                "amount": row["total_price"],
                "method": row["payment_mode"],
                "paid_at": row["paid_at"],
                "note": row["note"],
                "doc_path": row["document"],
                "created_at": row["created_at"],
            },
        )

    connection.execute(sa.text("DELETE FROM lamp_payment_registration"))
    for row in link_rows:
        connection.execute(
            sa.text(
                """
                INSERT INTO lamp_payment_registration (payment_id, registration_id)
                VALUES (:payment_id, :registration_id)
                """
            ),
            {
                "payment_id": row["payment_id"],
                "registration_id": row["registration_id"],
            },
        )

    connection.execute(sa.text("DELETE FROM payment_data WHERE type = 'lamp'"))


def upgrade():
    connection = op.get_bind()

    with op.batch_alter_table("payment_data", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("type", sa.String(length=20), server_default=sa.text("'ylp'"), nullable=False)
        )
        batch_op.add_column(sa.Column("submitter_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("payer_name", sa.String(length=200), nullable=True))
        batch_op.add_column(sa.Column("phone", sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column("paid_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("note", sa.Text(), nullable=True))
        batch_op.alter_column(
            "order_id",
            existing_type=sa.Integer(),
            nullable=True,
            existing_server_default=None,
        )
        batch_op.alter_column(
            "document",
            existing_type=sa.String(length=255),
            type_=sa.String(length=500),
            existing_nullable=True,
        )
        batch_op.create_index("ix_payment_data_type", ["type"], unique=False)
        batch_op.create_index("ix_payment_data_submitter_id", ["submitter_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_payment_data_submitter",
            "user_data",
            ["submitter_id"],
            ["id"],
            ondelete="SET NULL",
        )

    connection.execute(
        sa.text(
            """
            UPDATE payment_data
            SET
                type = 'ylp',
                status = CASE
                    WHEN status = 'approve' THEN 'approved'
                    WHEN status = 'reject' THEN 'rejected'
                    WHEN status = 'panding' THEN 'pending'
                    ELSE COALESCE(NULLIF(status, ''), 'pending')
                END
            """
        )
    )

    with op.batch_alter_table("lamp_payment_registration", schema=None) as batch_op:
        batch_op.drop_constraint("lamp_payment_registration_ibfk_1", type_="foreignkey")

    _copy_lamp_payments_into_payment_data(connection)

    op.drop_table("lamp_payment")

    with op.batch_alter_table("lamp_payment_registration", schema=None) as batch_op:
        batch_op.alter_column(
            "payment_id",
            existing_type=sa.BigInteger(),
            type_=sa.Integer(),
            existing_nullable=False,
        )
        batch_op.drop_constraint("lamp_payment_registration_ibfk_2", type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_lamp_payment_registration_payment",
            "payment_data",
            ["payment_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_foreign_key(
            "fk_lamp_payment_registration_registration",
            "lamp_registration",
            ["registration_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade():
    connection = op.get_bind()

    op.create_table(
        "lamp_payment",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("submitter_id", sa.Integer(), nullable=True),
        sa.Column("payer_name", sa.String(length=200), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("method", sa.String(length=30), nullable=True),
        sa.Column("paid_at", sa.DateTime(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("doc_path", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("current_timestamp()"),
        ),
        sa.ForeignKeyConstraint(
            ["submitter_id"],
            ["user_data.id"],
            name="fk_lamp_payment_submitter",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lamp_payment_submitter_id", "lamp_payment", ["submitter_id"], unique=False)

    with op.batch_alter_table("lamp_payment_registration", schema=None) as batch_op:
        batch_op.drop_constraint("fk_lamp_payment_registration_payment", type_="foreignkey")
        batch_op.drop_constraint("fk_lamp_payment_registration_registration", type_="foreignkey")
        batch_op.alter_column(
            "payment_id",
            existing_type=sa.Integer(),
            type_=sa.BigInteger(),
            existing_nullable=False,
        )
        batch_op.create_foreign_key(
            "lamp_payment_registration_ibfk_2",
            "lamp_registration",
            ["registration_id"],
            ["id"],
        )

    _copy_lamp_payments_back(connection)

    with op.batch_alter_table("lamp_payment_registration", schema=None) as batch_op:
        batch_op.create_foreign_key(
            "lamp_payment_registration_ibfk_1",
            "lamp_payment",
            ["payment_id"],
            ["id"],
        )

    with op.batch_alter_table("payment_data", schema=None) as batch_op:
        batch_op.drop_constraint("fk_payment_data_submitter", type_="foreignkey")
        batch_op.drop_index("ix_payment_data_submitter_id")
        batch_op.drop_index("ix_payment_data_type")
        batch_op.alter_column(
            "document",
            existing_type=sa.String(length=500),
            type_=sa.String(length=255),
            existing_nullable=True,
        )
        batch_op.alter_column(
            "order_id",
            existing_type=sa.Integer(),
            nullable=False,
            existing_server_default=None,
        )
        batch_op.drop_column("note")
        batch_op.drop_column("paid_at")
        batch_op.drop_column("phone")
        batch_op.drop_column("payer_name")
        batch_op.drop_column("submitter_id")
        batch_op.drop_column("type")

    connection.execute(
        sa.text(
            """
            UPDATE payment_data
            SET status = CASE
                WHEN status = 'approved' THEN 'approve'
                WHEN status = 'rejected' THEN 'reject'
                ELSE COALESCE(NULLIF(status, ''), 'pending')
            END
            """
        )
    )
