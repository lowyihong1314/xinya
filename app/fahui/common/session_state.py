from __future__ import annotations

from flask import has_request_context, session


def current_session_phone() -> str | None:
    if not has_request_context():
        return None
    value = session.get("phone")
    return str(value).strip() if value else None


def current_verified_phones() -> set[str]:
    if not has_request_context():
        return set()
    values = session.get("verified_phones", [])
    if not isinstance(values, list):
        return set()
    return {str(item).strip() for item in values if item}
