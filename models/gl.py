"""General Ledger (总账) + Cash Book (现金/银行日记账) models.

Double-entry accounting layer that sits on top of the operational finance
documents (报销 / 收入 / 销售). Cash / bank accounts are modeled as ordinary
GL accounts flagged ``is_cash`` so the Cash Book is simply the ledger detail of
those accounts — there is a single source of truth (journal lines).
"""

from datetime import datetime

from sqlalchemy import func

from models import db

# Account types and their "normal" balance side.
#   asset / expense  -> debit-normal
#   liability / equity / income -> credit-normal
ACCOUNT_TYPES = ("asset", "liability", "equity", "income", "expense")
DEBIT_NORMAL_TYPES = ("asset", "expense")


class GLAccount(db.Model):
    """会计科目 (Chart of Accounts entry)."""

    __tablename__ = "gl_account"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    code = db.Column(db.String(30), nullable=False, unique=True, index=True)
    name = db.Column(db.String(160), nullable=False)
    account_type = db.Column(db.String(20), nullable=False, index=True)
    parent_id = db.Column(
        db.Integer,
        db.ForeignKey("gl_account.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    # Cash / bank accounts appear in the Cash Book.
    is_cash = db.Column(db.Boolean, nullable=False, default=False, index=True)
    cash_kind = db.Column(db.String(20), nullable=True)  # cash / bank / None
    bank_account_no = db.Column(db.String(80), nullable=True)
    currency = db.Column(db.String(10), nullable=False, default="MYR")
    # Opening balance stored debit-positive (debit side +, credit side -).
    opening_balance = db.Column(db.Numeric(14, 2), nullable=False, default=0)
    status = db.Column(db.String(20), nullable=False, default="active", index=True)
    remark = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False,
        onupdate=func.now(),
    )

    parent = db.relationship("GLAccount", remote_side=[id], lazy="joined")
    lines = db.relationship("GLJournalLine", back_populates="account", lazy="selectin")

    @property
    def is_debit_normal(self):
        return self.account_type in DEBIT_NORMAL_TYPES


class GLJournalEntry(db.Model):
    """会计凭证 (Journal Entry header)."""

    __tablename__ = "gl_journal_entry"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    entry_no = db.Column(db.String(40), nullable=False, unique=True, index=True)
    entry_date = db.Column(db.Date, nullable=False, index=True)
    memo = db.Column(db.String(255), nullable=True)
    reference = db.Column(db.String(120), nullable=True)
    # source: manual / cash_book / reimbursement / income / sales / ...
    source = db.Column(db.String(40), nullable=False, default="manual", index=True)
    source_ref_type = db.Column(db.String(50), nullable=True)
    source_ref_id = db.Column(db.Integer, nullable=True, index=True)
    status = db.Column(db.String(20), nullable=False, default="posted", index=True)  # draft / posted / void
    total_debit = db.Column(db.Numeric(14, 2), nullable=False, default=0)
    total_credit = db.Column(db.Numeric(14, 2), nullable=False, default=0)
    created_by = db.Column(
        db.Integer,
        db.ForeignKey("user_data.id", ondelete="SET NULL", onupdate="CASCADE"),
        nullable=True,
        index=True,
    )
    posted_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False,
        onupdate=func.now(),
    )

    creator = db.relationship("User", foreign_keys=[created_by], lazy="joined")
    lines = db.relationship(
        "GLJournalLine",
        back_populates="entry",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="GLJournalLine.line_no",
    )


class GLJournalLine(db.Model):
    """分录 (Journal Entry line / debit-credit posting)."""

    __tablename__ = "gl_journal_line"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    entry_id = db.Column(
        db.Integer,
        db.ForeignKey("gl_journal_entry.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    account_id = db.Column(
        db.Integer,
        db.ForeignKey("gl_account.id", ondelete="RESTRICT", onupdate="CASCADE"),
        nullable=False,
        index=True,
    )
    line_no = db.Column(db.Integer, nullable=False, default=0)
    debit = db.Column(db.Numeric(14, 2), nullable=False, default=0)
    credit = db.Column(db.Numeric(14, 2), nullable=False, default=0)
    description = db.Column(db.String(255), nullable=True)

    entry = db.relationship("GLJournalEntry", back_populates="lines", lazy="joined")
    account = db.relationship("GLAccount", back_populates="lines", lazy="joined")
