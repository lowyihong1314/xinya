# fahui

CRM dharma-event workspace with YLP/Lamp entry selection, payment review, and YLP order lookup.

## Files

- `FahuiPage.tsx`: selection-first dharma-event workspace with page-level detail views for payment review and YLP order lookup.
- `api.ts`: unified FAHUI review APIs plus YLP order/detail fetches.
- `types.ts`: shared FAHUI payment types and YLP order/detail types.

## Scope

This module now covers:

- unified lamp + YLP payment review
- selection-first entry flow: choose `YLP` or `Lamp` before entering the next tool
- YLP order search by version and keyword
- page-level detail views with Back navigation instead of modal overlays
- YLP order detail lookup and quotation download

## Backend endpoints

- `/api/payment/review`
- `/api/payment/review/:paymentId/approve`
- `/api/payment/review/:paymentId/revoke`
- `/api/payment/review/:paymentId`
- `/api/fahui_router/versions`
- `/api/fahui_router/orders/search`
- `/api/fahui_router/orders/:orderId`
- `/api/payment/orders/:orderId/payments`
- `/api/payment/orders/:orderId/quotation`

Legacy aliases such as `/api/fahui_router/get_versions`, `/api/payment/download_quotiton/:orderId`, and `/api/lampRegistration_API/approve_payment` are still preserved for backward compatibility.

## Important dependencies

- `LAMP_META` is imported from `frontend/src/lamp/lampMeta.ts` to render human-readable lamp labels in the lamp review flow.

## Upgrade notes

- This module depends on lamp-domain metadata from outside CRM, so changes to lamp type constants should be reviewed here too.
- Payment cards now distinguish `lamp` and `ylp` through a shared `type` field.
- Approval state now has explicit `is_approved` / `status` fields, while `submitter_id` remains for avatar compatibility.
- Detail interactions now stay inside the page view; destructive actions still use confirmation dialogs, but order/payment detail itself no longer opens in an overlay.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
