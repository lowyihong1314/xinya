# Finance React Module

This directory contains the React migration shell for the CRM finance workspace.

## Structure

- `FinancePage.tsx`: finance tabs and route state.
- `claim/`: claim list, create form, detail, API, types, shared styles.
- `income/`: income workspace boundary for later feature growth.
- `register/`: register payment workspace grouped by form, with status review and updates.
- `summarize_expense/`: expense charts grouped by event, with unassigned claims folded into one bucket.
- `ClaimWorkspace.tsx`: compatibility re-export to `claim/ClaimWorkspace`.
- `api.ts`: compatibility re-export to `claim/api`.
- `types.ts`: compatibility re-export to `claim/types`.
- `LegacyAccountPanel.tsx`: legacy bridge kept only for compatibility while older entrypoints still exist.

## Current scope

- `claim_req` now has search, pagination, and an internal max-height workspace.
- `income_req` is still a lightweight placeholder, but now lives in its own directory instead of staying inside `FinancePage.tsx`.
- `register` now focuses on `RegisPayment` review, grouped by form, with status switching for `process / checked / fail`.
- `summarize_expense` shows claim spending grouped by activity; claims without an event are grouped into `未关联活动`.

## URL state

- Active tab is stored in `account_router`.
- This keeps the current finance subpage stable while the rest of CRM uses `?crm=finance`.

## Theme rule

- Finance React components must use color variables from `frontend/src/theme/designTokens.ts`.
- If a translucent, border, or state color is missing, extend the token set first and then consume the new CSS variable.
