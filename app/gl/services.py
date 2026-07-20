"""Business logic for the general-ledger + cash-book module.

Everything is double-entry: a journal entry has 2+ lines whose total debit
equals total credit. Cash / bank accounts are ordinary GL accounts flagged
``is_cash``; the Cash Book is just their ledger detail. Balances follow the
debit-positive convention (debit +, credit -); natural presentation sign is
derived from the account type.
"""

from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

from sqlalchemy import func
from sqlalchemy.orm import selectinload

from flask_login import current_user

from models import db
from models.gl import (
    ACCOUNT_TYPES,
    DEBIT_NORMAL_TYPES,
    GLAccount,
    GLJournalEntry,
    GLJournalLine,
)

from app.gl.exceptions import NotFound, ValidationError
from app.gl.serializers import (
    serialize_account,
    serialize_journal_entry,
)

TWO_PLACES = Decimal("0.01")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _money(value, field="金额"):
    if value in (None, ""):
        return Decimal("0.00")
    try:
        amount = Decimal(str(value)).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        raise ValidationError(f"{field}必须是数字")
    return amount


def _parse_date(value, field="日期"):
    if not value:
        return date.today()
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        raise ValidationError(f"{field}格式必须是 YYYY-MM-DD")


def _current_user_id():
    try:
        if current_user.is_authenticated:
            return current_user.id
    except Exception:
        pass
    return None


def _generate_entry_no(entry_date):
    prefix = f"JV{entry_date.strftime('%Y%m')}-"
    last = (
        db.session.query(GLJournalEntry.entry_no)
        .filter(GLJournalEntry.entry_no.like(f"{prefix}%"))
        .order_by(GLJournalEntry.entry_no.desc())
        .first()
    )
    seq = 1
    if last and last[0]:
        try:
            seq = int(last[0].split("-")[-1]) + 1
        except (ValueError, IndexError):
            seq = 1
    while True:
        candidate = f"{prefix}{seq:04d}"
        exists = db.session.query(GLJournalEntry.id).filter_by(entry_no=candidate).first()
        if not exists:
            return candidate
        seq += 1


def _get_account_or_404(account_id):
    account = db.session.get(GLAccount, int(account_id)) if account_id else None
    if not account:
        raise NotFound(f"找不到科目 #{account_id}")
    return account


def _get_entry_or_404(entry_id):
    entry = (
        db.session.query(GLJournalEntry)
        .options(selectinload(GLJournalEntry.lines).selectinload(GLJournalLine.account))
        .filter(GLJournalEntry.id == int(entry_id))
        .first()
    )
    if not entry:
        raise NotFound(f"找不到凭证 #{entry_id}")
    return entry


# --------------------------------------------------------------------------- #
# Chart of accounts
# --------------------------------------------------------------------------- #
def list_accounts(include_inactive=True):
    query = db.session.query(GLAccount).order_by(GLAccount.code.asc())
    if not include_inactive:
        query = query.filter(GLAccount.status == "active")
    return [serialize_account(account) for account in query.all()]


def create_account(payload):
    code = (payload.get("code") or "").strip()
    name = (payload.get("name") or "").strip()
    account_type = (payload.get("account_type") or "").strip()
    if not code:
        raise ValidationError("科目编号不能为空")
    if not name:
        raise ValidationError("科目名称不能为空")
    if account_type not in ACCOUNT_TYPES:
        raise ValidationError("科目类型必须是 asset/liability/equity/income/expense")
    if db.session.query(GLAccount.id).filter_by(code=code).first():
        raise ValidationError(f"科目编号 {code} 已存在")

    is_cash = bool(payload.get("is_cash"))
    account = GLAccount(
        code=code,
        name=name,
        account_type=account_type,
        parent_id=payload.get("parent_id") or None,
        is_cash=is_cash,
        cash_kind=(payload.get("cash_kind") or None) if is_cash else None,
        bank_account_no=(payload.get("bank_account_no") or None) if is_cash else None,
        currency=(payload.get("currency") or "MYR").strip() or "MYR",
        opening_balance=_money(payload.get("opening_balance"), "期初余额"),
        status=(payload.get("status") or "active").strip() or "active",
        remark=(payload.get("remark") or None),
    )
    db.session.add(account)
    db.session.commit()
    return serialize_account(account)


def update_account(account_id, payload):
    account = _get_account_or_404(account_id)

    if "code" in payload:
        code = (payload.get("code") or "").strip()
        if not code:
            raise ValidationError("科目编号不能为空")
        clash = db.session.query(GLAccount.id).filter(
            GLAccount.code == code, GLAccount.id != account.id
        ).first()
        if clash:
            raise ValidationError(f"科目编号 {code} 已存在")
        account.code = code
    if "name" in payload:
        name = (payload.get("name") or "").strip()
        if not name:
            raise ValidationError("科目名称不能为空")
        account.name = name
    if "account_type" in payload:
        account_type = (payload.get("account_type") or "").strip()
        if account_type not in ACCOUNT_TYPES:
            raise ValidationError("科目类型不合法")
        account.account_type = account_type
    if "parent_id" in payload:
        account.parent_id = payload.get("parent_id") or None
    if "is_cash" in payload:
        account.is_cash = bool(payload.get("is_cash"))
        if not account.is_cash:
            account.cash_kind = None
            account.bank_account_no = None
    if "cash_kind" in payload and account.is_cash:
        account.cash_kind = payload.get("cash_kind") or None
    if "bank_account_no" in payload and account.is_cash:
        account.bank_account_no = payload.get("bank_account_no") or None
    if "currency" in payload:
        account.currency = (payload.get("currency") or "MYR").strip() or "MYR"
    if "opening_balance" in payload:
        account.opening_balance = _money(payload.get("opening_balance"), "期初余额")
    if "status" in payload:
        account.status = (payload.get("status") or "active").strip() or "active"
    if "remark" in payload:
        account.remark = payload.get("remark") or None

    db.session.commit()
    return serialize_account(account)


def delete_account(account_id):
    account = _get_account_or_404(account_id)
    has_lines = db.session.query(GLJournalLine.id).filter_by(account_id=account.id).first()
    if has_lines:
        raise ValidationError("该科目已有分录记录，不能删除；可改为停用。")
    db.session.delete(account)
    db.session.commit()
    return {"id": int(account_id), "deleted": True}


# --------------------------------------------------------------------------- #
# Journal entries
# --------------------------------------------------------------------------- #
def _normalize_lines(raw_lines):
    if not isinstance(raw_lines, list) or len(raw_lines) < 2:
        raise ValidationError("凭证至少需要两条分录")

    normalized = []
    total_debit = Decimal("0.00")
    total_credit = Decimal("0.00")
    for index, raw in enumerate(raw_lines):
        account_id = raw.get("account_id")
        if not account_id:
            raise ValidationError(f"第 {index + 1} 行未选择科目")
        account = _get_account_or_404(account_id)
        if account.status != "active":
            raise ValidationError(f"科目 {account.code} 已停用，不能记账")
        debit = _money(raw.get("debit"), "借方")
        credit = _money(raw.get("credit"), "贷方")
        if debit < 0 or credit < 0:
            raise ValidationError("借贷金额不能为负")
        if debit > 0 and credit > 0:
            raise ValidationError(f"第 {index + 1} 行不能同时填借方和贷方")
        if debit == 0 and credit == 0:
            raise ValidationError(f"第 {index + 1} 行借贷金额不能都为 0")
        total_debit += debit
        total_credit += credit
        normalized.append(
            {
                "account_id": account.id,
                "line_no": index + 1,
                "debit": debit,
                "credit": credit,
                "description": (raw.get("description") or None),
            }
        )

    if total_debit != total_credit:
        raise ValidationError(
            f"借贷不平衡：借方合计 {total_debit}，贷方合计 {total_credit}"
        )
    if total_debit == 0:
        raise ValidationError("凭证金额不能为 0")
    return normalized, total_debit, total_credit


def create_journal_entry(payload):
    entry_date = _parse_date(payload.get("entry_date"))
    normalized, total_debit, total_credit = _normalize_lines(payload.get("lines"))
    status = (payload.get("status") or "posted").strip()
    if status not in ("draft", "posted"):
        raise ValidationError("凭证状态只能是 draft 或 posted")

    entry = GLJournalEntry(
        entry_no=_generate_entry_no(entry_date),
        entry_date=entry_date,
        memo=(payload.get("memo") or None),
        reference=(payload.get("reference") or None),
        source=(payload.get("source") or "manual").strip() or "manual",
        source_ref_type=(payload.get("source_ref_type") or None),
        source_ref_id=payload.get("source_ref_id") or None,
        status=status,
        total_debit=total_debit,
        total_credit=total_credit,
        created_by=_current_user_id(),
        posted_at=datetime.utcnow() if status == "posted" else None,
    )
    for line in normalized:
        entry.lines.append(GLJournalLine(**line))
    db.session.add(entry)
    db.session.commit()
    return serialize_journal_entry(_get_entry_or_404(entry.id))


def update_journal_entry(entry_id, payload):
    entry = _get_entry_or_404(entry_id)
    if entry.status == "void":
        raise ValidationError("已作废的凭证不能修改")
    if entry.status == "posted":
        raise ValidationError("已过账的凭证不能直接修改，请先作废后重新录入")

    if "entry_date" in payload:
        entry.entry_date = _parse_date(payload.get("entry_date"))
    if "memo" in payload:
        entry.memo = payload.get("memo") or None
    if "reference" in payload:
        entry.reference = payload.get("reference") or None
    if "lines" in payload:
        normalized, total_debit, total_credit = _normalize_lines(payload.get("lines"))
        entry.lines.clear()
        db.session.flush()
        for line in normalized:
            entry.lines.append(GLJournalLine(**line))
        entry.total_debit = total_debit
        entry.total_credit = total_credit

    db.session.commit()
    return serialize_journal_entry(_get_entry_or_404(entry.id))


def post_journal_entry(entry_id):
    entry = _get_entry_or_404(entry_id)
    if entry.status == "posted":
        return serialize_journal_entry(entry)
    if entry.status == "void":
        raise ValidationError("已作废的凭证不能过账")
    if entry.total_debit != entry.total_credit or entry.total_debit == 0:
        raise ValidationError("凭证借贷不平衡，不能过账")
    entry.status = "posted"
    entry.posted_at = datetime.utcnow()
    db.session.commit()
    return serialize_journal_entry(_get_entry_or_404(entry.id))


def void_journal_entry(entry_id):
    entry = _get_entry_or_404(entry_id)
    if entry.status == "void":
        return serialize_journal_entry(entry)
    entry.status = "void"
    db.session.commit()
    return serialize_journal_entry(_get_entry_or_404(entry.id))


def delete_journal_entry(entry_id):
    entry = _get_entry_or_404(entry_id)
    if entry.status == "posted":
        raise ValidationError("已过账的凭证不能删除，请改为作废")
    db.session.delete(entry)
    db.session.commit()
    return {"id": int(entry_id), "deleted": True}


def list_journal_entries(status=None, source=None, start=None, end=None, limit=200):
    query = (
        db.session.query(GLJournalEntry)
        .options(selectinload(GLJournalEntry.lines).selectinload(GLJournalLine.account))
        .order_by(GLJournalEntry.entry_date.desc(), GLJournalEntry.id.desc())
    )
    if status:
        query = query.filter(GLJournalEntry.status == status)
    if source:
        query = query.filter(GLJournalEntry.source == source)
    if start:
        query = query.filter(GLJournalEntry.entry_date >= _parse_date(start))
    if end:
        query = query.filter(GLJournalEntry.entry_date <= _parse_date(end))
    if limit:
        query = query.limit(int(limit))
    return [serialize_journal_entry(entry) for entry in query.all()]


def get_journal_entry(entry_id):
    return serialize_journal_entry(_get_entry_or_404(entry_id))


def map_entries_by_source(source_ref_type, ref_ids=None):
    """Return {str(source_ref_id): {id, entry_no, status}} for a ref type.

    Used by document listings (报销 / 收款) to show whether each row already has
    a linked journal entry. Excludes void entries; on multiple entries per ref
    the newest wins.
    """
    if not source_ref_type:
        return {}
    query = (
        db.session.query(
            GLJournalEntry.id,
            GLJournalEntry.entry_no,
            GLJournalEntry.status,
            GLJournalEntry.source_ref_id,
        )
        .filter(GLJournalEntry.source_ref_type == source_ref_type)
        .filter(GLJournalEntry.status != "void")
        .filter(GLJournalEntry.source_ref_id.isnot(None))
        .order_by(GLJournalEntry.id.asc())
    )
    if ref_ids:
        cleaned = [int(rid) for rid in ref_ids if str(rid).strip()]
        if not cleaned:
            return {}
        query = query.filter(GLJournalEntry.source_ref_id.in_(cleaned))

    result = {}
    for entry_id, entry_no, status, ref_id in query.all():
        # newest wins because ordered ascending by id
        result[str(ref_id)] = {"id": entry_id, "entry_no": entry_no, "status": status}
    return result


def find_entry_by_source(source_ref_type, source_ref_id):
    """Return the newest non-void entry linked to a document, or None."""
    if not source_ref_type or not source_ref_id:
        return None
    entry = (
        db.session.query(GLJournalEntry)
        .options(selectinload(GLJournalEntry.lines).selectinload(GLJournalLine.account))
        .filter_by(source_ref_type=source_ref_type, source_ref_id=int(source_ref_id))
        .filter(GLJournalEntry.status != "void")
        .order_by(GLJournalEntry.id.desc())
        .first()
    )
    return serialize_journal_entry(entry) if entry else None


# --------------------------------------------------------------------------- #
# Reports: balances / trial balance / account ledger
# --------------------------------------------------------------------------- #
def _posted_totals_by_account(start=None, end=None):
    """Return {account_id: (debit_sum, credit_sum)} over posted entries."""
    query = (
        db.session.query(
            GLJournalLine.account_id,
            func.coalesce(func.sum(GLJournalLine.debit), 0),
            func.coalesce(func.sum(GLJournalLine.credit), 0),
        )
        .join(GLJournalEntry, GLJournalLine.entry_id == GLJournalEntry.id)
        .filter(GLJournalEntry.status == "posted")
        .group_by(GLJournalLine.account_id)
    )
    if start:
        query = query.filter(GLJournalEntry.entry_date >= _parse_date(start))
    if end:
        query = query.filter(GLJournalEntry.entry_date <= _parse_date(end))
    return {row[0]: (Decimal(row[1]), Decimal(row[2])) for row in query.all()}


def load_trial_balance(start=None, end=None):
    accounts = db.session.query(GLAccount).order_by(GLAccount.code.asc()).all()
    totals = _posted_totals_by_account(start, end)

    rows = []
    total_debit = Decimal("0.00")
    total_credit = Decimal("0.00")
    for account in accounts:
        debit, credit = totals.get(account.id, (Decimal("0.00"), Decimal("0.00")))
        opening = Decimal(account.opening_balance or 0)
        # debit-positive closing balance
        closing = opening + debit - credit
        if debit == 0 and credit == 0 and opening == 0 and account.status != "active":
            continue
        debit_balance = closing if closing > 0 else Decimal("0.00")
        credit_balance = -closing if closing < 0 else Decimal("0.00")
        total_debit += debit_balance
        total_credit += credit_balance
        rows.append(
            {
                "account_id": account.id,
                "code": account.code,
                "name": account.name,
                "account_type": account.account_type,
                "opening_balance": float(opening),
                "period_debit": float(debit),
                "period_credit": float(credit),
                "closing_balance": float(closing),
                "debit_balance": float(debit_balance),
                "credit_balance": float(credit_balance),
            }
        )

    return {
        "rows": rows,
        "total_debit": float(total_debit),
        "total_credit": float(total_credit),
        "balanced": total_debit == total_credit,
        "start": start,
        "end": end,
    }


def load_account_ledger(account_id, start=None, end=None):
    account = _get_account_or_404(account_id)

    # Opening = account opening balance + net of posted lines strictly before `start`.
    opening = Decimal(account.opening_balance or 0)
    if start:
        prior = (
            db.session.query(
                func.coalesce(func.sum(GLJournalLine.debit), 0),
                func.coalesce(func.sum(GLJournalLine.credit), 0),
            )
            .join(GLJournalEntry, GLJournalLine.entry_id == GLJournalEntry.id)
            .filter(
                GLJournalLine.account_id == account.id,
                GLJournalEntry.status == "posted",
                GLJournalEntry.entry_date < _parse_date(start),
            )
            .first()
        )
        opening += Decimal(prior[0]) - Decimal(prior[1])

    query = (
        db.session.query(GLJournalLine, GLJournalEntry)
        .join(GLJournalEntry, GLJournalLine.entry_id == GLJournalEntry.id)
        .filter(
            GLJournalLine.account_id == account.id,
            GLJournalEntry.status == "posted",
        )
        .order_by(GLJournalEntry.entry_date.asc(), GLJournalEntry.id.asc(), GLJournalLine.line_no.asc())
    )
    if start:
        query = query.filter(GLJournalEntry.entry_date >= _parse_date(start))
    if end:
        query = query.filter(GLJournalEntry.entry_date <= _parse_date(end))

    running = opening
    entries = []
    total_debit = Decimal("0.00")
    total_credit = Decimal("0.00")
    for line, entry in query.all():
        debit = Decimal(line.debit or 0)
        credit = Decimal(line.credit or 0)
        running += debit - credit
        total_debit += debit
        total_credit += credit
        entries.append(
            {
                "line_id": line.id,
                "entry_id": entry.id,
                "entry_no": entry.entry_no,
                "entry_date": entry.entry_date.isoformat() if entry.entry_date else None,
                "memo": entry.memo,
                "source": entry.source,
                "description": line.description,
                "debit": float(debit),
                "credit": float(credit),
                "balance": float(running),
            }
        )

    return {
        "account": serialize_account(account),
        "opening_balance": float(opening),
        "closing_balance": float(running),
        "total_debit": float(total_debit),
        "total_credit": float(total_credit),
        "entries": entries,
        "start": start,
        "end": end,
    }


def load_cash_summary():
    """Balances of every cash/bank account (for the Cash Book overview)."""
    accounts = (
        db.session.query(GLAccount)
        .filter(GLAccount.is_cash.is_(True))
        .order_by(GLAccount.code.asc())
        .all()
    )
    totals = _posted_totals_by_account()
    summary = []
    grand_total = Decimal("0.00")
    for account in accounts:
        debit, credit = totals.get(account.id, (Decimal("0.00"), Decimal("0.00")))
        balance = Decimal(account.opening_balance or 0) + debit - credit
        grand_total += balance
        summary.append(
            {
                "id": account.id,
                "code": account.code,
                "name": account.name,
                "cash_kind": account.cash_kind,
                "bank_account_no": account.bank_account_no,
                "currency": account.currency,
                "balance": float(balance),
            }
        )
    return {"accounts": summary, "total_balance": float(grand_total)}


# --------------------------------------------------------------------------- #
# Dashboard
# --------------------------------------------------------------------------- #
def load_gl_dashboard():
    accounts = list_accounts(include_inactive=True)
    recent_entries = list_journal_entries(limit=50)
    cash = load_cash_summary()
    return {
        "accounts": accounts,
        "recent_entries": recent_entries,
        "cash": cash,
    }


# --------------------------------------------------------------------------- #
# Reserved posting interface for operational documents (报销/收入/销售).
# Existing modules can call this on confirm to auto-post — not wired yet.
# --------------------------------------------------------------------------- #
def post_journal_from_source(
    source,
    source_ref_type,
    source_ref_id,
    lines,
    entry_date=None,
    memo=None,
    reference=None,
):
    """Create a posted journal entry originating from another module.

    Idempotent guard: if an entry already exists for the same
    (source_ref_type, source_ref_id) it is returned instead of duplicated.
    ``lines`` is a list of {account_id, debit, credit, description}.
    """
    existing = (
        db.session.query(GLJournalEntry)
        .filter_by(source_ref_type=source_ref_type, source_ref_id=source_ref_id)
        .filter(GLJournalEntry.status != "void")
        .first()
    )
    if existing:
        return serialize_journal_entry(_get_entry_or_404(existing.id))

    return create_journal_entry(
        {
            "entry_date": entry_date,
            "memo": memo,
            "reference": reference,
            "source": source,
            "source_ref_type": source_ref_type,
            "source_ref_id": source_ref_id,
            "status": "posted",
            "lines": lines,
        }
    )
