# gl — 总账 / Cash Book frontend

`LedgerWorkspace` takes a `view` prop and renders one section — each is its own
sidebar entry under 财务 (`?account_router=gl` / `gl_cash` / `gl_accounts` / `gl_reports`):

- `JournalTab` (`gl`) — 会计凭证. Balanced multi-line entry form (live debit/credit totals),
  list with expandable line detail, post/void/delete actions.
- `CashBookTab` (`gl_cash`) — 现金账. Cash/bank balance cards + per-account running-balance
  ledger. **Read-only** — flows come only from posted journal entries written via the
  "写 JE" button on 报销申请 / 收款审核. There is no quick-entry form.
- `AccountsTab` (`gl_accounts`) — 科目表. CRUD over the chart of accounts; check "资金账户"
  to include an account in the Cash Book.
- `ReportsTab` (`gl_reports`) — 报表. Trial balance + per-account ledger (with date range).

`api.ts` wraps `/api/gl/*`; `types.ts` mirrors the backend serializers; `glStyles.ts`
holds the shared CSS-variable table styling (matches `claim`).

Write actions require the `account_edit` permission.
