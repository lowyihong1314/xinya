from datetime import datetime

from models import db


class EmailLog(db.Model):
    """公司邮箱发送日志。参考 docs/ERP_mail_system.md 的 email_logs 表设计。"""

    __tablename__ = "email_log"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    from_email = db.Column(db.String(255), nullable=False)
    to_email = db.Column(db.String(255), nullable=False)
    cc_email = db.Column(db.String(255), nullable=True)
    bcc_email = db.Column(db.String(255), nullable=True)
    subject = db.Column(db.String(255), nullable=True)
    body = db.Column(db.Text, nullable=True)
    direction = db.Column(db.String(20), nullable=False, default="sent")
    status = db.Column(db.String(20), nullable=False, default="pending")
    message_id = db.Column(db.String(255), nullable=True)
    error_message = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    user = db.relationship("User", backref="email_logs")

    def to_dict(self, include_body=False):
        data = {
            "id": self.id,
            "from_email": self.from_email,
            "to_email": self.to_email,
            "cc_email": self.cc_email,
            "bcc_email": self.bcc_email,
            "subject": self.subject,
            "direction": self.direction,
            "status": self.status,
            "message_id": self.message_id,
            "error_message": self.error_message,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if include_body:
            data["body"] = self.body
        return data
