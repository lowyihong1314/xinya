# fahui

CRM dharma-event payment review module.

## Files

- `FahuiPage.tsx`: searchable payment review board with approval, removal, and detail overlays.
- `api.ts`: payment list fetch and review actions.
- `types.ts`: payment, registration, and lamp item types.

## Scope

This module currently focuses on lamp-registration payments that need CRM-side review:

- list all payments
- search by payer, phone, or devotee name
- inspect linked registrations and lamp selections
- approve a payment
- remove or revoke a payment record

## Backend endpoints

- `/api/lampRegistration_API/get_all_register_by_payment`
- `/api/lampRegistration_API/approve_payment`
- `/api/lampRegistration_API/remove_payment`

## Important dependencies

- `LAMP_META` is imported from `frontend/src/lamp/render_lamp_init.js` to render human-readable lamp labels.

## Upgrade notes

- This module depends on lamp-domain metadata from outside CRM, so changes to lamp type constants should be reviewed here too.
- Approval state is inferred partly from `submitter_id` and `paid_at`, so backend response shape changes can affect card rendering.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
