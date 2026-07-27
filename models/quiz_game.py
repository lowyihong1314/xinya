import json
from datetime import datetime

from models import db


def _dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _loads(raw, fallback):
    if not raw:
        return fallback
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return fallback
    return parsed


class QuizGameSet(db.Model):
    """A named question bank for the 问答游戏 (Kahoot-style quiz)."""

    __tablename__ = "quiz_game_set"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    question_time = db.Column(db.Integer, nullable=False, default=30)
    position = db.Column(db.Integer, nullable=False, default=0)
    is_archived = db.Column(db.Boolean, nullable=False, default=False)
    created_by_user_id = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    questions = db.relationship(
        "QuizGameQuestion",
        back_populates="quiz_set",
        cascade="all, delete-orphan",
        order_by="QuizGameQuestion.position",
    )

    def to_dict(self, with_questions=False):
        data = {
            "id": self.id,
            "title": self.title,
            "description": self.description or "",
            "question_time": self.question_time or 30,
            "position": self.position or 0,
            "is_archived": bool(self.is_archived),
            "created_by_user_id": self.created_by_user_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "question_count": len(self.questions),
        }
        if with_questions:
            data["questions"] = [q.to_dict() for q in self.questions]
        return data


class QuizGameQuestion(db.Model):
    __tablename__ = "quiz_game_question"

    id = db.Column(db.Integer, primary_key=True)
    set_id = db.Column(
        db.Integer,
        db.ForeignKey("quiz_game_set.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position = db.Column(db.Integer, nullable=False, default=0)
    section = db.Column(db.String(255), nullable=True)
    zh = db.Column(db.Text, nullable=False)
    en = db.Column(db.Text, nullable=True)
    # JSON string: [{"zh": "...", "en": "..."}, ...] (2–4 options)
    options_json = db.Column(db.Text, nullable=False, default="[]")
    answer = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    quiz_set = db.relationship("QuizGameSet", back_populates="questions")

    @property
    def options(self):
        parsed = _loads(self.options_json, [])
        return parsed if isinstance(parsed, list) else []

    @options.setter
    def options(self, value):
        self.options_json = _dumps(value or [])

    def to_dict(self):
        return {
            "id": self.id,
            "set_id": self.set_id,
            "position": self.position or 0,
            "section": self.section or "",
            "zh": self.zh or "",
            "en": self.en or "",
            "options": self.options,
            "answer": self.answer or 0,
        }
