# Finance React Module

## Entry points

- `FinancePage.tsx` is the live finance workspace and is mounted as CRM module `finance`.
- `LegacyAccountPanel.tsx` is only a bridge for older entry paths that still expect the legacy panel bootstrap.
- `ClaimWorkspace.tsx`, `api.ts`, and `types.ts` are compatibility re-exports that forward to `claim/`.

## Tabs

- `claim_req`: claim list, create form, detail view, approval, and voucher workflow.
- `register`: payment review grouped by registration form, with `process / checked / fail / all` filters.
- `income_req`: read-only income analytics built from checked registration payments.
- `summarize_expense`: read-only claim analytics grouped by event and month.

## State and routing

- `FinancePage.tsx` stores the active tab in the `account_router` search param.
- The finance workspace is designed to sit under `?crm=finance`, so tab changes should preserve the parent CRM query state.

## Shared dependencies

- All screens use `frontend/src/theme/designTokens.ts` for styling tokens.
- Claim flows depend on `frontend/src/CRM/shared/showEventPicker` and `static/js/sign_tools.js`.
- Register and income flows depend on `frontend/src/CRM/form/react/types.ts` and the `/api/form/get_all_form` payload shape.

## Upgrade notes

- If you rename a tab key, update any deep links and the defaulting logic in `isFinanceTabKey`.
- The register and income tabs both assume payment data is embedded in the form list response; a backend split into separate payment endpoints would require both screens to change together.
- Public voucher signing is not mounted inside the CRM shell; that route lives in `frontend/src/router/appRouter.tsx`.
