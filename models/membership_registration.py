import secrets
from datetime import datetime

from models import db
from sqlalchemy import and_
from sqlalchemy.orm import foreign, synonym


MEMBERSHIP_ROLE_OPTIONS = ("见习青芽", "普通会员", "青芽")

# 理事会通过所需的最少签名数量，以及最多可收集的签名数量。
# 达到 REQUIRED（配合财政通过）即生效；生效后仍可继续补签，直到 MAX。
COUNCIL_APPROVAL_REQUIRED = 5
COUNCIL_APPROVAL_MAX = 20


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
        nullable=True,
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
    requested_username = db.Column(db.String(255), nullable=True)
    status = db.Column(
        db.Enum("paid", "process", "reject", "remove", name="membership_registration_status_enum"),
        nullable=False,
        default="process",
        index=True,
    )
    target_expiry_date = db.Column(db.Date, nullable=True)

    facebook_profile_url = db.Column(db.String(500), nullable=True)
    english_name = db.Column(db.String(255), nullable=True)
    phone = db.Column(db.String(32), nullable=True)
    gender = db.Column(db.String(10), nullable=True)
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
    council_signatures = db.relationship(
        "MembershipCouncilSignature",
        back_populates="membership_registration",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="MembershipCouncilSignature.signed_at.asc(), MembershipCouncilSignature.id.asc()",
    )

    def latest_membership_payment(self):
        payments = self.payments or []
        return payments[0] if payments else None

    def finance_approved(self):
        """财政通过：只要有一条付款记录被审核通过。"""
        return any((payment.status or "") == "checked" for payment in (self.payments or []))

    def council_signature_count(self):
        return len(self.council_signatures or [])

    def council_approved(self):
        """理事会通过：收集到足够数量的理事签名。"""
        return self.council_signature_count() >= COUNCIL_APPROVAL_REQUIRED

    def fully_approved(self):
        return self.finance_approved() and self.council_approved()

    def sync_status_from_payment(self):
        """根据付款情况刷新状态。

        注意：正式生效（paid）现在需要财政 + 理事会同时通过，由业务层的
        审批流程负责设置，这里不会把状态直接提升为 paid，只处理退回 / 处理中，
        并且绝不回退已经生效的记录。
        """
        if self.status in ("paid", "remove"):
            return self.status

        latest_payment = self.latest_membership_payment()
        if not self.finance_approved() and latest_payment and (latest_payment.status or "") == "fail":
            new_status = "reject"
        else:
            new_status = "process"

        if self.status != new_status:
            self.status = new_status
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
            "username": getattr(self.user, "username", None) or self.requested_username,
            "requested_username": self.requested_username,
            "nric_asset_id": self.nric_asset_id,
            "regis_member_id": self.nric_asset_id,
            "nric": live_nric,
            "status": self.status,
            "payment_token": self.payment_token,
            "target_expiry_date": self.target_expiry_date.isoformat() if self.target_expiry_date else None,
            "facebook_profile_url": self.facebook_profile_url,
            "english_name": self.english_name,
            "phone": self.phone,
            "gender": self.gender,
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
            "finance_approved": self.finance_approved(),
            "council": {
                "required": COUNCIL_APPROVAL_REQUIRED,
                "max": COUNCIL_APPROVAL_MAX,
                "count": self.council_signature_count(),
                "approved": self.council_approved(),
                "full": self.council_signature_count() >= COUNCIL_APPROVAL_MAX,
                "signatures": [item.to_dict() for item in (self.council_signatures or [])],
            },
            "activated": self.status == "paid",
        }


class MembershipCouncilSignature(db.Model):
    """理事会审批签名：每位有 council_approve 权限的理事对一份会员申请签一次名。"""

    __tablename__ = "membership_council_signature"
    __table_args__ = (
        db.UniqueConstraint(
            "membership_registration_id",
            "user_id",
            name="uq_membership_council_signature_reg_user",
        ),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    membership_registration_id = db.Column(
        db.Integer,
        db.ForeignKey("membership_registration.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    signed_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    # 签名当下对签名理事 user_data 的快照，外加签名方式 / 手写签名图片等。
    data = db.Column(db.JSON, nullable=True)

    membership_registration = db.relationship(
        "MembershipRegistration",
        back_populates="council_signatures",
    )
    user = db.relationship("User", foreign_keys=[user_id], lazy="joined")

    def _snapshot(self):
        return self.data if isinstance(self.data, dict) else {}

    def to_dict(self):
        snapshot = self._snapshot()
        snapshot_user = snapshot.get("user_snapshot") or {}
        signer_name = (
            snapshot_user.get("display_name")
            or getattr(self.user, "display_name", None)
            or snapshot_user.get("username")
            or getattr(self.user, "username", None)
            or (f"用户 #{self.user_id}" if self.user_id else "未知理事")
        )
        return {
            "id": self.id,
            "membership_registration_id": self.membership_registration_id,
            "user_id": self.user_id,
            "signer_name": signer_name,
            "signer_username": snapshot_user.get("username") or getattr(self.user, "username", None),
            "signed_at": self.signed_at.isoformat() if self.signed_at else None,
            "method": snapshot.get("method") or "workbench",
            "signature": snapshot.get("signature"),
        }
