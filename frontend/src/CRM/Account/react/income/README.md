# Income Workspace

## Purpose

- This folder holds the read-only finance dashboard for registration income.
- It does not manage payment records directly; it derives charts from the registration-form payment dataset.

## Main files

- `IncomeWorkspace.tsx`: fetches form data, filters checked payments, and renders KPI cards plus activity, month, and form rankings.

## Data sources

- Data is loaded through `fetchRegisterPaymentForms()` from `../register/api`.
- The component depends on `FormRecord` and `FormPayment` types from `frontend/src/CRM/form/react/types.ts`.
- Only payments with `status === "checked"` are included in totals and charts.

## Current analytics

- Total income, average payment amount, activity count, and form count.
- Monthly income trend.
- Activity income ranking.
- Form income ranking, optionally filtered by selected activity.

## Upgrade notes

- Any backend change to payment status names will silently change the charts because filtering is hard-coded to `checked`.
- Activity grouping depends on the event metadata attached to each form; if form-event linkage changes, verify the ranking output.
- This page is intentionally read-only, so mutation APIs should stay in `register/` rather than being added here.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
