"""JSON serializers for the general-ledger module."""


def _num(value):
    if value is None:
        return None
    return float(value)


def _resolve_user_name(user):
    if user is None:
        return None
    return (
        getattr(user, "display_name", None)
        or getattr(user, "name_NRIC", None)
        or getattr(user, "username", None)
    )


def serialize_account(account):
    return {
        "id": account.id,
        "code": account.code,
        "name": account.name,
        "account_type": account.account_type,
        "parent_id": account.parent_id,
        "is_cash": bool(account.is_cash),
        "cash_kind": account.cash_kind,
        "bank_account_no": account.bank_account_no,
        "currency": account.currency,
        "opening_balance": _num(account.opening_balance),
        "status": account.status,
        "remark": account.remark,
        "created_at": account.created_at.isoformat() if account.created_at else None,
        "updated_at": account.updated_at.isoformat() if account.updated_at else None,
    }


def serialize_journal_line(line):
    account = line.account
    return {
        "id": line.id,
        "entry_id": line.entry_id,
        "account_id": line.account_id,
        "account_code": account.code if account else None,
        "account_name": account.name if account else None,
        "account_type": account.account_type if account else None,
        "is_cash": bool(account.is_cash) if account else False,
        "line_no": line.line_no,
        "debit": _num(line.debit) or 0.0,
        "credit": _num(line.credit) or 0.0,
        "description": line.description,
    }


def serialize_journal_entry(entry, include_lines=True):
    payload = {
        "id": entry.id,
        "entry_no": entry.entry_no,
        "entry_date": entry.entry_date.isoformat() if entry.entry_date else None,
        "memo": entry.memo,
        "reference": entry.reference,
        "source": entry.source,
        "source_ref_type": entry.source_ref_type,
        "source_ref_id": entry.source_ref_id,
        "status": entry.status,
        "total_debit": _num(entry.total_debit) or 0.0,
        "total_credit": _num(entry.total_credit) or 0.0,
        "created_by": entry.created_by,
        "created_by_name": _resolve_user_name(entry.creator),
        "posted_at": entry.posted_at.isoformat() if entry.posted_at else None,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
    }
    if include_lines:
        payload["lines"] = [serialize_journal_line(line) for line in entry.lines]
    return payload
