import secrets
from datetime import datetime

from models import db
from sqlalchemy import and_
from sqlalchemy.orm import foreign, synonym


MEMBERSHIP_ROLE_OPTIONS = ("见习青芽", "普通会员", "青芽")


class MembershipRegistration(db.Model):
    __tablename__ = "membership_registration"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    submitted_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    registration_type = db.Column(
        db.Enum("upgrade", "renew", name="membership_registration_type_enum"),
        nullable=False,
        index=True,
    )
    user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    nric_asset_id = db.Column(
        db.Integer,
        db.ForeignKey("nric_asset.id", ondelete="RESTRICT", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    payment_token = db.Column(
        db.String(64),
        nullable=False,
        unique=True,
        default=lambda: secrets.token_urlsafe(24),
    )
    status = db.Column(
        db.Enum("paid", "process", "reject", name="membership_registration_status_enum"),
        nullable=False,
        default="process",
        index=True,
    )
    target_expiry_date = db.Column(db.Date, nullable=True)

    facebook_profile_url = db.Column(db.String(500), nullable=True)
    nric_address = db.Column(db.Text, nullable=True)
    ancestral_home = db.Column(db.String(255), nullable=True)
    occupation = db.Column(db.String(255), nullable=True)
    refuge_taken = db.Column(db.Boolean, nullable=True)
    refuge_year = db.Column(db.Integer, nullable=True)
    refuge_master = db.Column(db.String(255), nullable=True)
    dharma_name = db.Column(db.String(255), nullable=True)
    emergency_contact_name = db.Column(db.String(255), nullable=True)
    emergency_contact_phone = db.Column(db.String(32), nullable=True)
    guardian_name = db.Column(db.String(255), nullable=True)
    guardian_phone = db.Column(db.String(32), nullable=True)
    recommender_user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    membership_role = db.Column(
        db.Enum(*MEMBERSHIP_ROLE_OPTIONS, name="membership_role_enum"),
        nullable=True,
    )

    user = db.relationship("User", foreign_keys=[user_id], lazy="joined")
    regis_member_id = synonym("nric_asset_id")
    nric_asset = db.relationship("NRIC_Asset", foreign_keys=[nric_asset_id], lazy="joined")
    member = synonym("nric_asset")
    recommender = db.relationship("User", foreign_keys=[recommender_user_id], lazy="joined")
    payments = db.relationship(
        "RegisPayment",
        primaryjoin=lambda: and_(
            MembershipRegistration.id == foreign(db.Model.metadata.tables["regis_payment"].c.membership_registration_id),
            db.Model.metadata.tables["regis_payment"].c.payment_scope == "membership",
        ),
        back_populates="membership_registration",
        lazy="selectin",
        order_by="RegisPayment.id.desc()",
    )

    def latest_membership_payment(self):
        payments = self.payments or []
        return payments[0] if payments else None

    def sync_status_from_payment(self):
        latest_payment = self.latest_membership_payment()
        if not latest_payment:
            return self.status

        mapping = {
            "checked": "paid",
            "process": "process",
            "fail": "reject",
        }
        mapped = mapping.get(latest_payment.status or "")
        if mapped and self.status != mapped:
            self.status = mapped
        return self.status

    def to_dict(self):
        latest_payment = self.latest_membership_payment()
        live_nric = self.nric_asset.nric if self.nric_asset and self.nric_asset.nric else None
        user_display_name = (
            getattr(self.user, "display_name", None)
            or getattr(self.nric_asset, "name_nric", None)
            or getattr(self.user, "username", None)
        )
        recommender_name = (
            getattr(self.recommender, "display_name", None)
            or getattr(self.recommender, "username", None)
        )
        return {
            "id": self.id,
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else None,
            "registration_type": self.registration_type,
            "user_id": self.user_id,
            "user_name": user_display_name,
            "username": getattr(self.user, "username", None),
            "nric_asset_id": self.nric_asset_id,
            "regis_member_id": self.nric_asset_id,
            "nric": live_nric,
            "status": self.status,
            "payment_token": self.payment_token,
            "target_expiry_date": self.target_expiry_date.isoformat() if self.target_expiry_date else None,
            "facebook_profile_url": self.facebook_profile_url,
            "nric_address": self.nric_address,
            "ancestral_home": self.ancestral_home,
            "occupation": self.occupation,
            "refuge_taken": self.refuge_taken,
            "refuge_year": self.refuge_year,
            "refuge_master": self.refuge_master,
            "dharma_name": self.dharma_name,
            "emergency_contact_name": self.emergency_contact_name,
            "emergency_contact_phone": self.emergency_contact_phone,
            "guardian_name": self.guardian_name,
            "guardian_phone": self.guardian_phone,
            "recommender_user_id": self.recommender_user_id,
            "recommender_name": recommender_name,
            "membership_role": self.membership_role,
            "latest_payment": latest_payment.to_dict() if latest_payment else None,
            "payments": [item.to_dict() for item in (self.payments or [])],
        }
