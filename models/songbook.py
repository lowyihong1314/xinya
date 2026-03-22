import re
from datetime import datetime

from models import db


def normalize_song_text(value):
    text = str(value or "").strip().lower()
    text = re.sub(r"\s+", "", text)
    return text


class SongbookEntry(db.Model):
    __tablename__ = "songbook_entry"

    id = db.Column(db.Integer, primary_key=True)
    song_number = db.Column(db.Integer, nullable=True, index=True)
    title = db.Column(db.String(255), nullable=False, index=True)
    title_normalized = db.Column(db.String(255), nullable=False, index=True)
    variant = db.Column(db.String(16), nullable=False, default="C", index=True)
    heading_text = db.Column(db.String(255), nullable=True)
    original_key = db.Column(db.String(64), nullable=True)
    selected_key = db.Column(db.String(64), nullable=True)
    bpm = db.Column(db.String(32), nullable=True)
    time_signature = db.Column(db.String(32), nullable=True)
    content = db.Column(db.Text, nullable=False)
    search_text = db.Column(db.Text, nullable=False)
    source_doc = db.Column(db.String(255), nullable=True)
    published = db.Column(db.Boolean, nullable=False, default=True)
    sort_order = db.Column(db.Integer, nullable=False, default=0, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    def sync_search_fields(self):
        self.title_normalized = normalize_song_text(self.title)
        self.search_text = "\n".join(
            part for part in [
                str(self.song_number or ""),
                self.title or "",
                self.variant or "",
                self.heading_text or "",
                self.original_key or "",
                self.selected_key or "",
                self.bpm or "",
                self.time_signature or "",
                self.content or "",
            ] if part
        )
        if not self.sort_order:
            base = (self.song_number or 999999) * 10
            self.sort_order = base + (0 if (self.variant or "C") == "C" else 1)

    def to_dict(self, include_content=False):
        data = {
            "id": self.id,
            "song_number": self.song_number,
            "title": self.title,
            "title_normalized": self.title_normalized,
            "variant": self.variant,
            "heading_text": self.heading_text,
            "original_key": self.original_key,
            "selected_key": self.selected_key,
            "bpm": self.bpm,
            "time_signature": self.time_signature,
            "source_doc": self.source_doc,
            "published": self.published,
            "sort_order": self.sort_order,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_content:
            data["content"] = self.content
        return data


@db.event.listens_for(SongbookEntry, "before_insert")
def _before_insert(mapper, connection, target):
    target.sync_search_fields()


@db.event.listens_for(SongbookEntry, "before_update")
def _before_update(mapper, connection, target):
    target.sync_search_fields()
