---
name: gl-cash-book-module
description: Finance now has a full GL + Cash Book module (models/gl.py, app/gl, frontend Account/react/gl)
metadata:
  type: project
---

Added a complete double-entry General Ledger + Cash Book to the finance area (was previously missing — finance only had operational document modules: claim/register/income/summarize_expense/sales_income).

- Backend: `models/gl.py` (`GLAccount`, `GLJournalEntry`, `GLJournalLine`), blueprint `app/gl` at `/api/gl`, migration `b1c2d3e4f5a6` (chained off `a7b8c9d0e1f2`) seeds a standard MYR temple/NGO chart of accounts (codes 1000–5900).
- Cash/bank accounts are modeled as GL accounts flagged `is_cash`; the Cash Book is their ledger detail (single source of truth = journal lines). Balances stored debit-positive.
- Permissions reuse account module: read = `account_read`|`account_edit`, write = `account_edit`.
- Reports built: trial balance + per-account ledger. **No** income statement / balance sheet yet.
- **Manual "写 JE" from documents exists; auto-on-confirm still NOT wired.** Claim detail (`ClaimDetail`) and register payment detail (`RegisterWorkspace`) each have a "写 JE" button opening `Account/react/shared/WriteJEModal` — prefilled balanced 2-line entry, linked via `source_ref_type`/`source_ref_id` (claim=`reimbursement_request`, register=`register_payment`), created through idempotent `POST /api/gl/journal-entries/from-source` (backed by `services.post_journal_from_source`). Lookup: `GET /api/gl/journal-entries/by-source?ref_type&ref_id` (excludes void). The modal detects an existing JE and shows it read-only. What's NOT done: generating JEs automatically when a document is confirmed/approved.
- Shared detail chrome: `Account/react/shared/DocDetailHeader` (back + 上一单/下一单 prev-next nav + title + status + actions) now used by both ClaimDetail and RegisterWorkspace detail views for a unified look.
- Both listings (ClaimList + RegisterWorkspace list) show a **JE column**: whether the doc already has a linked posted journal entry (green entry_no chip) else "未入账". Backed by batch endpoint `GET /api/gl/journal-entries/source-map?ref_type=&ref_ids=` → `services.map_entries_by_source` (returns {ref_id: {id, entry_no, status}}, excludes void). Both listings have a header "当页全选" checkbox + per-row multi-select.
- **批量写 JE**: both listings have a multi-select "批量写 JE" button → `Account/react/shared/BatchWriteJEModal`. Pick one Dr + one Cr account (defaults by direction), optional unified date, then it loops the selected docs creating one posted JE each via idempotent `createGLEntryFromSource` (per-doc amount/date/memo). Already-posted docs and zero-amount docs are auto-skipped; shows created/skipped/failed summary. No new backend needed (reuses from-source).
- Both listings have a search input, a date-range filter (start/end), and every data-column `<th>` is click-to-sort (asc/desc toggle) via shared `Account/react/shared/tableSort.ts` (`toggleSort`/`sortArrow`/`sortRows`/`sortableThStyle`). Sort/filter/paginate all happen in the workspace (before pagination). For claim, `jeMap` was lifted from ClaimList up to ClaimWorkspace so the JE column is sortable and passed down as a prop.
- Register (收款审核) list gained claim-parity bulk actions: 清空选择 / 下载 XLSX (client-side `xlsx`) / 导出 Report. Report is a new backend PDF: `app/account/pdf.build_payment_report_pdf` + `services.build_payment_report_context` + route `POST /api/account/payments/report` (tabular, permission `require_claim_list_permission`).
- Frontend: `Account/react/gl/` — `LedgerWorkspace` shell + 4 sub-tabs (JournalTab/CashBookTab/AccountsTab/ReportsTab), claim-style tables. Exposed as FinancePage `gl` tab and CRM finance nav item "总账".

Related: [[sales-income-table-refactor]]
