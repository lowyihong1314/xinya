# reimbursement.py

from datetime import datetime
from sqlalchemy import func
from models import db

class ReimbursementRequest(db.Model):
    __tablename__ = "reimbursement_request"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    # 申请人（允许为空：适配“link 填写资料/未登录”）
    applicant_user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True
    )
    applicant = db.relationship("User", foreign_keys=[applicant_user_id])

    # 申请表单
    applicant_name = db.Column(db.String(128), nullable=False)
    request_date = db.Column(db.Date, nullable=False)
    amount = db.Column(db.Float, nullable=False)

    # 做账分配部门（保存提交时的部门名称，避免和 Department 强关联）
    department_name = db.Column(db.String(100), nullable=False, index=True)

    purpose = db.Column(db.Text, nullable=False)
    ref1 = db.Column(db.Text, nullable=True)
    ref2 = db.Column(db.Text, nullable=True)
    vendor_name = db.Column(db.String(255), nullable=True)
    vendor_address = db.Column(db.Text, nullable=True)
    vendor_contact_number = db.Column(db.String(80), nullable=True)
    purchase_datetime = db.Column(db.DateTime, nullable=True)

    # link token（申请链接）
    public_token = db.Column(db.String(128), unique=True, nullable=False, index=True)

    # 公开/表单额外配置（JSON 字符串）
    sign_json_data = db.Column(db.Text, nullable=True)
    voucher_recipient_name = db.Column(db.String(160), nullable=True)
    voucher_recipient_sign_json = db.Column(db.Text, nullable=True)
    voucher_signed_at = db.Column(db.DateTime, nullable=True)

    # 关联活动（可为空）
    event_id = db.Column(
        db.Integer,
        db.ForeignKey("event_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True
    )
    event = db.relationship("EventData", foreign_keys=[event_id])

    # 状态：draft / submitted / rejected / approved / paid(optional)
    status = db.Column(db.String(32), default="draft", nullable=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, onupdate=func.now())

    is_locked = db.Column(db.Boolean, default=False)



class ReimbursementAttachment(db.Model):
    __tablename__ = "reimbursement_attachment"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    request_id = db.Column(
        db.Integer,
        db.ForeignKey("reimbursement_request.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True
    )

    uploader_user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True
    )

    file_path = db.Column(db.String(256), nullable=False)
    file_name = db.Column(db.String(256), nullable=True)
    mime_type = db.Column(db.String(128), nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    request = db.relationship(
        "ReimbursementRequest",
        backref=db.backref("attachments", lazy=True, cascade="all, delete-orphan")
    )
    uploader = db.relationship("User", foreign_keys=[uploader_user_id])


class ReimbursementRequestChangeLog(db.Model):
    __tablename__ = "reimbursement_request_change_log"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    request_id = db.Column(
        db.Integer,
        db.ForeignKey("reimbursement_request.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True
    )

    changed_by_user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True
    )

    field_name = db.Column(db.String(80), nullable=False)
    old_value = db.Column(db.Text, nullable=True)
    new_value = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    request = db.relationship(
        "ReimbursementRequest",
        backref=db.backref("change_logs", lazy=True, cascade="all, delete-orphan")
    )
    changed_by = db.relationship("User", foreign_keys=[changed_by_user_id])



class ReimbursementApproverData(db.Model):
    __tablename__ = "reimbursement_approver_data"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    request_id = db.Column(
        db.Integer,
        db.ForeignKey("reimbursement_request.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True
    )

    user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True
    )

    dep_id = db.Column(
        db.Integer,
        db.ForeignKey("department.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True
    )

    # JSON 字符串：动作/备注/签名/签核时间/IP/设备等
    sign_json_data = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    decided_at = db.Column(db.DateTime, nullable=True)

    # True=拒绝
    reject = db.Column(db.Boolean, default=False, nullable=False)

    request = db.relationship(
        "ReimbursementRequest",
        backref=db.backref("approver_data", lazy=True, cascade="all, delete-orphan")
    )
    user = db.relationship("User", foreign_keys=[user_id])
    department = db.relationship("Department", foreign_keys=[dep_id])
