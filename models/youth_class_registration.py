import secrets
from datetime import datetime

from models import db
from sqlalchemy import and_
from sqlalchemy.orm import foreign, synonym


# 理事会通过：青少年佛学班只需 1 位理事签名（配合财政通过）即可生效；生效后仍可补签到上限。
YOUTH_COUNCIL_APPROVAL_REQUIRED = 1
YOUTH_COUNCIL_APPROVAL_MAX = 20


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
        db.Enum("paid", "process", "reject", "remove", name="youth_class_registration_status_enum"),
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
    council_signatures = db.relationship(
        "YouthClassCouncilSignature",
        back_populates="youth_class_registration",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="YouthClassCouncilSignature.signed_at.asc(), YouthClassCouncilSignature.id.asc()",
    )

    def finance_approved(self):
        """财政通过：只要有一条付款记录被审核通过。"""
        return any((payment.status or "") == "checked" for payment in (self.payments or []))

    def council_signature_count(self):
        return len(self.council_signatures or [])

    def council_approved(self):
        return self.council_signature_count() >= YOUTH_COUNCIL_APPROVAL_REQUIRED

    def fully_approved(self):
        return self.finance_approved() and self.council_approved()

    def sync_status_from_payment(self):
        """根据付款情况刷新状态。

        正式生效（paid）需要财政 + 理事会同时通过，由业务层负责设置；这里不会把状态
        直接提升为 paid，只处理退回 / 处理中，并且绝不回退已经生效的记录。
        """
        if self.status in ("paid", "remove"):
            return self.status

        latest_payment = self.latest_youth_payment()
        if not self.finance_approved() and latest_payment and (latest_payment.status or "") == "fail":
            new_status = "reject"
        else:
            new_status = "process"

        if self.status != new_status:
            self.status = new_status
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
            "finance_approved": self.finance_approved(),
            "council": {
                "required": YOUTH_COUNCIL_APPROVAL_REQUIRED,
                "max": YOUTH_COUNCIL_APPROVAL_MAX,
                "count": self.council_signature_count(),
                "approved": self.council_approved(),
                "full": self.council_signature_count() >= YOUTH_COUNCIL_APPROVAL_MAX,
                "signatures": [item.to_dict() for item in (self.council_signatures or [])],
            },
            "activated": self.status == "paid",
        }


class YouthClassCouncilSignature(db.Model):
    """青少年佛学班理事会审批签名：每位有 council_approve 权限的理事对一份报名签一次名。"""

    __tablename__ = "youth_class_council_signature"
    __table_args__ = (
        db.UniqueConstraint(
            "youth_class_registration_id",
            "user_id",
            name="uq_youth_class_council_signature_reg_user",
        ),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    youth_class_registration_id = db.Column(
        db.Integer,
        db.ForeignKey("youth_class_registration.id", ondelete="CASCADE", onupdate="CASCADE"),
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
    data = db.Column(db.JSON, nullable=True)

    youth_class_registration = db.relationship(
        "YouthClassRegistration",
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
            "youth_class_registration_id": self.youth_class_registration_id,
            "user_id": self.user_id,
            "signer_name": signer_name,
            "signer_username": snapshot_user.get("username") or getattr(self.user, "username", None),
            "signed_at": self.signed_at.isoformat() if self.signed_at else None,
            "method": snapshot.get("method") or "workbench",
            "signature": snapshot.get("signature"),
        }
