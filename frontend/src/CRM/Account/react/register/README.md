# Register Payment Review (收款审核)

## Purpose

- Finance-side review of **all registration payments across scopes** — 报名表单 (form), 会员
  (membership), 青少年佛学班 (youth_class) — in one flat ERP listing→detail workspace.
- Finance users inspect payment proofs and change payment status. For **form‑scope** payments they can
  also replace the proof image and remove failed records; membership/youth payments are status‑only
  here (their records are managed in their own modules).

## Main files

- `RegisterWorkspace.tsx`: the whole workspace — a flat ERP table of all payments with status + 来源
  filters, and a refresh‑safe detail view (via `?payment_id=`) with facts, proof image, status
  buttons, and form‑only replace/delete. Rewritten from the old form‑grouped 3‑pane layout.
- `api.ts`: `fetchFinancePayments({scope,status})` + `updateFinancePaymentStatus` (unified account
  endpoints); plus the kept form‑scope `fetchRegisterPaymentForms` (used by income analytics),
  `replaceRegisterPaymentProof`, `deleteRegisterPayment`.
- `types.ts`: `FinancePayment` (cross‑scope payment shape) + `SCOPE_FILTERS` / `STATUS_FILTERS`.

## API usage

- `/api/account/payments?scope=&status=`: unified cross‑scope payment list (source of the table).
- `/api/account/payments/:paymentId/status`: unified status update; dispatches by `payment_scope` to
  the scope's service so membership/youth activation side‑effects still fire.
- Form‑scope only: `/api/form/payment/proof_image/:id/replace` (replace) and
  `/api/form/payment/:id` (delete).

## Business rules in code

- Default filter is `process` (pending reviews first); 来源 filter defaults to 全部.
- The detail view is refresh‑safe via the `payment_id` search param (plus `pay_status` / `pay_scope`).
- Proof replacement is only offered for form‑scope records still `process`; deletion only for
  form‑scope `fail` records. Membership/youth detail shows status buttons only.
- Status buttons are gated by `account_edit` (`getUserPermissionNames(user)`); `account_read` can view.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
