import secrets
from datetime import datetime

from models import db
from sqlalchemy import and_
from sqlalchemy.orm import foreign, synonym


class YouthClassRegistration(db.Model):
    __tablename__ = "youth_class_registration"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    submitted_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    chinese_name = db.Column(db.String(255), nullable=False)
    english_name = db.Column(db.String(255), nullable=False)
    nric_asset_id = db.Column(
        db.Integer,
        db.ForeignKey("nric_asset.id", ondelete="RESTRICT", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    age = db.Column(db.Integer, nullable=False)
    category = db.Column(db.Enum("青少年", "青年", name="youth_class_category_enum"), nullable=False)
    address = db.Column(db.Text, nullable=False)
    gender = db.Column(db.Enum("男", "女", name="youth_class_gender_enum"), nullable=False)
    phone = db.Column(db.String(32), nullable=False)
    emergency_contact_name = db.Column(db.String(255), nullable=False)
    emergency_contact_phone = db.Column(db.String(32), nullable=False)
    emergency_contact_relation = db.Column(db.String(255), nullable=False)
    payment_token = db.Column(
        db.String(64),
        nullable=False,
        unique=True,
        default=lambda: secrets.token_urlsafe(24),
    )

    status = db.Column(
        db.Enum("paid", "process", "reject", name="youth_class_registration_status_enum"),
        nullable=False,
        default="process",
    )
    regis_payment_id = db.Column(
        db.Integer,
        db.ForeignKey("regis_payment.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    payment = db.relationship("RegisPayment", foreign_keys=[regis_payment_id], lazy="joined")
    regis_member_id = synonym("nric_asset_id")
    nric_asset = db.relationship(
        "NRIC_Asset",
        back_populates="youth_class_registrations",
        foreign_keys=[nric_asset_id],
        lazy="joined",
    )
    member = synonym("nric_asset")
    payments = db.relationship(
        "RegisPayment",
        primaryjoin=lambda: and_(
            YouthClassRegistration.id == foreign(db.Model.metadata.tables["regis_payment"].c.youth_class_registration_id),
            db.Model.metadata.tables["regis_payment"].c.payment_scope == "youth_class",
        ),
        back_populates="youth_class_registration",
        lazy="selectin",
        order_by="RegisPayment.id.desc()",
    )

    def sync_status_from_payment(self):
        payment = self.latest_youth_payment() or self.payment
        if not payment:
            return self.status

        mapping = {
            "checked": "paid",
            "process": "process",
            "fail": "reject",
        }
        mapped = mapping.get(payment.status or "")
        if mapped and self.status != mapped:
            self.status = mapped
        return self.status

    def latest_youth_payment(self):
        payments = self.payments or []
        if payments:
            return payments[0]
        return self.payment

    def to_dict(self):
        payment = self.payment
        latest_youth_payment = self.latest_youth_payment()
        live_nric = self.nric_asset.nric if self.nric_asset and self.nric_asset.nric else None
        return {
            "id": self.id,
            "submitted_at": self.submitted_at.strftime("%Y-%m-%d %H:%M:%S") if self.submitted_at else None,
            "chinese_name": self.chinese_name,
            "english_name": self.english_name,
            "nric_asset_id": self.nric_asset_id,
            "regis_member_id": self.nric_asset_id,
            "nric": live_nric,
            "age": self.age,
            "category": self.category,
            "address": self.address,
            "gender": self.gender,
            "phone": self.phone,
            "emergency_contact_name": self.emergency_contact_name,
            "emergency_contact_phone": self.emergency_contact_phone,
            "emergency_contact_relation": self.emergency_contact_relation,
            "payment_token": self.payment_token,
            "status": self.status,
            "regis_payment_id": self.regis_payment_id,
            "payment": payment.to_dict() if payment else None,
            "latest_payment": latest_youth_payment.to_dict() if latest_youth_payment else None,
            "payments": [item.to_dict() for item in (self.payments or [])],
        }
