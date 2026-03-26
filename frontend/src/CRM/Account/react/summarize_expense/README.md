# Expense Summary Workspace

## Purpose

- This folder contains the read-only expense analytics view for the finance module.
- It summarizes claim records by activity, month, and individual claim amount.

## Main files

- `SummarizeExpenseWorkspace.tsx`: loads claims, applies activity filtering, and renders KPI cards plus ranking charts.

## Data sources

- Data comes from `fetchClaims()` in `../claim/api`.
- Charts are built from `ClaimRecord` values in `../claim/types`.
- Claims without an `event_id` are grouped into the fallback bucket `未关联活动`.

## Current analytics

- Total expense, average per claim, activity category count, and linked-event count.
- Activity expense ranking.
- Monthly expense trend.
- Per-claim amount ranking inside the selected activity filter.

## Upgrade notes

- The page currently uses whatever `fetchClaims()` returns; it does not apply an extra status filter. If the backend starts returning drafts or rejected items, analytics will change immediately.
- Activity labels are derived from claim event data, so event schema changes should be validated against both expense charts and the claim detail page.
- This is intentionally a derived dashboard. Keep mutation and approval logic in `claim/`.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
