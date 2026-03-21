from sqlalchemy import (
    Column,
    BigInteger,
    String,
    Text,
    Numeric,
    DateTime,
    Date,
    ForeignKey,
)
from sqlalchemy.sql import func
from models import db


lamp_payment_registration = db.Table(
    "lamp_payment_registration",
    Column("payment_id", BigInteger, ForeignKey("lamp_payment.id"), nullable=False),
    Column("registration_id", BigInteger, ForeignKey("lamp_registration.id"), nullable=False),
)


class LampRegistration(db.Model):
    __tablename__ = "lamp_registration"

    id = Column(BigInteger, primary_key=True)

    devotee_name = Column(String(200), nullable=False)
    address = Column(Text, nullable=True)

    # 统一 phone（移除 phone_mobile）
    phone = Column(String(50), nullable=True)
    total_amount = Column(Numeric(10, 2), nullable=False)

    serial_no = Column(String(50), nullable=True)
    receipt_no = Column(String(50), nullable=True)
    payment_date = Column(Date, nullable=True)
    cashier_name = Column(String(100), nullable=True)

    status = Column(String(30), nullable=False, default="submitted")

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False
    )


# ===== LampPayment =====
class LampPayment(db.Model):
    __tablename__ = "lamp_payment"

    id = Column(BigInteger, primary_key=True)

    submitter_id = Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # 统一 phone（原 payer_phone）
    phone = Column(String(50), nullable=True)
    payer_name = Column(String(200))

    amount = Column(Numeric(10, 2), nullable=False)
    method = Column(String(30))
    paid_at = Column(DateTime)
    note = Column(Text)

    doc_path = Column(String(500))

    created_at = Column(
        DateTime,
        server_default=func.now(),
        nullable=False
    )

    registrations = db.relationship(
        "LampRegistration",
        secondary=lamp_payment_registration,
        backref=db.backref("payments", lazy="dynamic"),
        lazy="joined",
    )

    submitter = db.relationship(
        "User",
        backref=db.backref("lamp_payments", lazy="dynamic"),
    )

    
class Lamp(db.Model):
    __tablename__ = "lamp"

    id = Column(BigInteger, primary_key=True)

    registration_id = Column(
        BigInteger,
        ForeignKey("lamp_registration.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    lamp_type = Column(String(50), nullable=False)
    # lamp_168 / lamp_88 / future types

    amount = Column(Numeric(10, 2), nullable=False)
    # 每一盏灯自己的金额（可不同）

    note = Column(String(200), nullable=True)
    # 可写：为父母 / 为自己 / 消灾 / 延寿 等（可选）

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
