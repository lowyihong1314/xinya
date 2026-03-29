from datetime import datetime

from models import db


class AboutUs(db.Model):
    __tablename__ = 'about_us'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    text = db.Column(db.Text, nullable=False)

class OurHistory(db.Model):
    __tablename__ = 'our_history'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    date = db.Column(db.Date, nullable=False)
    text = db.Column(db.Text, nullable=False)
    img = db.Column(db.String(255), nullable=True)

class TreeHoleMessage(db.Model):
    __tablename__ = 'dorp_message'

    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
    user_id = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    author_name = db.Column(db.String(120), nullable=True)
    message = db.Column(db.Text, nullable=False)
    ip = db.Column(db.String(45), nullable=False)
    phone = db.Column(db.String(20), nullable=False, default="")
    is_spam = db.Column(db.Boolean, default=False)
    display = db.Column(db.Boolean, default=True)
    user = db.relationship("User", foreign_keys=[user_id], lazy="joined")

    def to_dict(self):
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "author_name": self.author_name,
            "message": self.message,
            "ip": self.ip,
            "phone": self.phone,
            "is_spam": bool(self.is_spam),
            "display": bool(self.display),
        }


DorpMessage = TreeHoleMessage
