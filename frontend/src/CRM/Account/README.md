# Account

## Purpose

- This folder holds the CRM finance workspace, mounted from `frontend/src/CRM/react/crmModules.ts` as the `finance` module.
- The real implementation now lives in `react/`, but the top-level `Account` name is still kept for compatibility with older imports and backend templates.

## Current scope

- Claim submission, approval, attachment review, and payment voucher signing.
- Registration payment review for all CRM forms.
- Income analytics derived from confirmed registration payments.
- Expense analytics derived from claim records and linked events.

## Main files

- `react/FinancePage.tsx`: finance tab shell controlled by the `account_router` query param.
- `react/claim/`: complete claim workflow, including public voucher-sign route support.
- `react/register/`: finance review of `RegisPayment` records grouped by form.
- `react/income/`: read-only income charts built from checked payments.
- `react/summarize_expense/`: read-only expense charts built from claims.

## Key dependencies

- `frontend/src/CRM/form/react`: provides form and payment data used by the income and register tabs.
- `frontend/src/CRM/shared/showEventPicker`: lets claims and forms attach CRM events.
- `frontend/src/theme/designTokens.ts`: required source for colors and surfaces in the finance UI.
- `static/js/sign_tools.js`: still used for handwritten signature capture.

## Upgrade notes

- Keep `account_router` stable when adding or renaming tabs; the current tab is deep-linkable.
- `frontend/src/CRM/Account/react/ClaimWorkspace.tsx`, `api.ts`, and `types.ts` are compatibility re-export shims and should not grow new logic.
- The voucher signing flow depends on the separate router entry `/payment-voucher-sign/:token`; changes here usually require checking both CRM and public-entry behavior.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
