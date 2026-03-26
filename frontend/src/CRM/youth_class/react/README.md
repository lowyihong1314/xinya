# Youth Class React Module

## Entry point

- `YouthClassRegistrationPage.tsx` is the only page in this directory and is embedded by the permanent-registration workspace.

## Current behavior

- Loads youth-class entries and fee settings in parallel.
- Uses `FeePanel` to manage fee options.
- Generates a QR code for the public registration URL.
- Shows summary stats for paid, rejected, processing, and no-payment entries.
- Lets admins copy applicant payment links and update payment review status.

## Public link and APIs

- The public registration URL exposed by the page is `${window.location.origin}/template/youth-class-registration`.
- Entry list comes from `/api/form/youth-class-registration/entries`.
- Settings are loaded and saved through `/api/form/youth-class-registration/settings`.
- Payment review uses `/api/form/youth-class-registration/payment/:paymentId/status`.

## Shared patterns

- Fee normalization and summaries reuse the same helpers as the CRM form workspace.
- The page uses `qrcode` on the client to generate a shareable image rather than relying on a backend QR asset.

## Upgrade notes

- This module looks similar to membership but uses different endpoints and slightly different status labels, so keep the two pages aligned deliberately instead of by copy-paste.
- The component reloads all entries after a payment-status change; if performance becomes an issue, optimize this refresh path carefully without breaking the visible stats.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
