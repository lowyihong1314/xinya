from flask import Blueprint, jsonify, request

from app.gl.exceptions import GLError
from app.gl.permissions import require_gl_edit_permission, require_gl_read_permission
from app.gl.services import (
    create_account,
    create_journal_entry,
    delete_account,
    delete_journal_entry,
    find_entry_by_source,
    get_journal_entry,
    list_accounts,
    list_journal_entries,
    map_entries_by_source,
    load_account_ledger,
    load_cash_summary,
    load_gl_dashboard,
    load_trial_balance,
    post_journal_entry,
    post_journal_from_source,
    update_account,
    update_journal_entry,
    void_journal_entry,
)

gl_bp = Blueprint("gl", __name__)


def _error_response(exc):
    return jsonify({"status": "error", "message": exc.message}), exc.status_code


def _json_body():
    return request.get_json(silent=True) or {}


# --------------------------------------------------------------------------- #
# Dashboard
# --------------------------------------------------------------------------- #
@gl_bp.get("/dashboard")
def get_dashboard():
    try:
        require_gl_read_permission()
        return jsonify({"status": "success", "data": load_gl_dashboard()})
    except GLError as exc:
        return _error_response(exc)


# --------------------------------------------------------------------------- #
# Chart of accounts
# --------------------------------------------------------------------------- #
@gl_bp.get("/accounts")
def get_accounts():
    try:
        require_gl_read_permission()
        include_inactive = request.args.get("include_inactive", "1") != "0"
        return jsonify({"status": "success", "data": list_accounts(include_inactive)})
    except GLError as exc:
        return _error_response(exc)


@gl_bp.post("/accounts")
def post_account():
    try:
        require_gl_edit_permission()
        return jsonify({"status": "success", "data": create_account(_json_body())})
    except GLError as exc:
        return _error_response(exc)


@gl_bp.put("/accounts/<int:account_id>")
def put_account(account_id):
    try:
        require_gl_edit_permission()
        return jsonify({"status": "success", "data": update_account(account_id, _json_body())})
    except GLError as exc:
        return _error_response(exc)


@gl_bp.delete("/accounts/<int:account_id>")
def remove_account(account_id):
    try:
        require_gl_edit_permission()
        return jsonify({"status": "success", "data": delete_account(account_id)})
    except GLError as exc:
        return _error_response(exc)


# --------------------------------------------------------------------------- #
# Journal entries
# --------------------------------------------------------------------------- #
@gl_bp.get("/journal-entries")
def get_journal_entries():
    try:
        require_gl_read_permission()
        return jsonify(
            {
                "status": "success",
                "data": list_journal_entries(
                    status=request.args.get("status") or None,
                    source=request.args.get("source") or None,
                    start=request.args.get("start") or None,
                    end=request.args.get("end") or None,
                    limit=request.args.get("limit", 200),
                ),
            }
        )
    except GLError as exc:
        return _error_response(exc)


@gl_bp.get("/journal-entries/<int:entry_id>")
def get_journal_entry_detail(entry_id):
    try:
        require_gl_read_permission()
        return jsonify({"status": "success", "data": get_journal_entry(entry_id)})
    except GLError as exc:
        return _error_response(exc)


@gl_bp.post("/journal-entries")
def post_journal_entry_create():
    try:
        require_gl_edit_permission()
        return jsonify({"status": "success", "data": create_journal_entry(_json_body())})
    except GLError as exc:
        return _error_response(exc)


@gl_bp.put("/journal-entries/<int:entry_id>")
def put_journal_entry(entry_id):
    try:
        require_gl_edit_permission()
        return jsonify({"status": "success", "data": update_journal_entry(entry_id, _json_body())})
    except GLError as exc:
        return _error_response(exc)


@gl_bp.get("/journal-entries/by-source")
def get_journal_entry_by_source():
    try:
        require_gl_read_permission()
        entry = find_entry_by_source(
            request.args.get("ref_type"),
            request.args.get("ref_id"),
        )
        return jsonify({"status": "success", "data": entry})
    except GLError as exc:
        return _error_response(exc)


@gl_bp.get("/journal-entries/source-map")
def get_journal_entry_source_map():
    try:
        require_gl_read_permission()
        raw_ids = request.args.get("ref_ids")
        ref_ids = raw_ids.split(",") if raw_ids else None
        return jsonify(
            {
                "status": "success",
                "data": map_entries_by_source(request.args.get("ref_type"), ref_ids),
            }
        )
    except GLError as exc:
        return _error_response(exc)


@gl_bp.post("/journal-entries/from-source")
def post_journal_entry_from_source():
    try:
        require_gl_edit_permission()
        body = _json_body()
        entry = post_journal_from_source(
            source=body.get("source") or "manual",
            source_ref_type=body.get("source_ref_type"),
            source_ref_id=body.get("source_ref_id"),
            lines=body.get("lines") or [],
            entry_date=body.get("entry_date"),
            memo=body.get("memo"),
            reference=body.get("reference"),
        )
        return jsonify({"status": "success", "data": entry})
    except GLError as exc:
        return _error_response(exc)


@gl_bp.post("/journal-entries/<int:entry_id>/post")
def post_journal_entry_action(entry_id):
    try:
        require_gl_edit_permission()
        return jsonify({"status": "success", "data": post_journal_entry(entry_id)})
    except GLError as exc:
        return _error_response(exc)


@gl_bp.post("/journal-entries/<int:entry_id>/void")
def void_journal_entry_action(entry_id):
    try:
        require_gl_edit_permission()
        return jsonify({"status": "success", "data": void_journal_entry(entry_id)})
    except GLError as exc:
        return _error_response(exc)


@gl_bp.delete("/journal-entries/<int:entry_id>")
def remove_journal_entry(entry_id):
    try:
        require_gl_edit_permission()
        return jsonify({"status": "success", "data": delete_journal_entry(entry_id)})
    except GLError as exc:
        return _error_response(exc)


# --------------------------------------------------------------------------- #
# Cash book
# --------------------------------------------------------------------------- #
@gl_bp.get("/cash-summary")
def get_cash_summary():
    try:
        require_gl_read_permission()
        return jsonify({"status": "success", "data": load_cash_summary()})
    except GLError as exc:
        return _error_response(exc)


# --------------------------------------------------------------------------- #
# Reports
# --------------------------------------------------------------------------- #
@gl_bp.get("/reports/trial-balance")
def get_trial_balance():
    try:
        require_gl_read_permission()
        return jsonify(
            {
                "status": "success",
                "data": load_trial_balance(
                    start=request.args.get("start") or None,
                    end=request.args.get("end") or None,
                ),
            }
        )
    except GLError as exc:
        return _error_response(exc)


@gl_bp.get("/reports/account-ledger/<int:account_id>")
def get_account_ledger(account_id):
    try:
        require_gl_read_permission()
        return jsonify(
            {
                "status": "success",
                "data": load_account_ledger(
                    account_id,
                    start=request.args.get("start") or None,
                    end=request.args.get("end") or None,
                ),
            }
        )
    except GLError as exc:
        return _error_response(exc)
