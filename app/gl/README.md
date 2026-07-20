# app/gl — General Ledger + Cash Book

Double-entry accounting layer on top of the operational finance documents.

## Model (`models/gl.py`)
- `GLAccount` — chart of accounts. `account_type` ∈ asset/liability/equity/income/expense.
  Cash/bank accounts are flagged `is_cash` (with `cash_kind` = cash/bank) — the Cash Book
  is simply the ledger of those accounts. `opening_balance` is stored debit-positive.
- `GLJournalEntry` — voucher header. `status` ∈ draft/posted/void. `total_debit == total_credit`.
- `GLJournalLine` — debit/credit posting against an account.

## Routes (`/api/gl`)
- `GET  /dashboard` — accounts + recent entries + cash summary
- `GET/POST /accounts`, `PUT/DELETE /accounts/<id>`
- `GET/POST /journal-entries`, `GET/PUT/DELETE /journal-entries/<id>`,
  `POST /journal-entries/<id>/post`, `POST /journal-entries/<id>/void`
- `GET  /cash-summary` (cash/bank balances; Cash Book flows come from posted journal entries)
- `GET  /reports/trial-balance`, `GET /reports/account-ledger/<id>`

## Permissions
Reuses the account module: read = `account_read`|`account_edit`, write = `account_edit`.

## Reserved posting interface
`services.post_journal_from_source(source, ref_type, ref_id, lines, ...)` lets operational
modules (报销 / 收入 / 销售) auto-post a balanced entry on confirm. Idempotent on
(`source_ref_type`, `source_ref_id`). **Not wired to any document yet** — call it from the
relevant confirm path plus an account-mapping rule when auto-posting is desired.
