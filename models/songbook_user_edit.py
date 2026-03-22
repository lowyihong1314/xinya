from datetime import datetime

from models import db


class SongbookUserEdit(db.Model):
    __tablename__ = "songbook_user_edit"

    id = db.Column(db.Integer, primary_key=True)
    base_entry_id = db.Column(db.Integer, db.ForeignKey("songbook_entry.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user_data.id", ondelete="CASCADE"), nullable=False, index=True)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        db.UniqueConstraint("base_entry_id", "user_id", name="uq_songbook_user_edit_entry_user"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "base_entry_id": self.base_entry_id,
            "user_id": self.user_id,
            "content": self.content,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
