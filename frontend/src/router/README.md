# router

Routing and shell-layout layer for the React app.

## Files

- `appRouter.tsx`: top-level route table built with `createHashRouter`.
- `AppLayout.tsx`: sticky navbar shell, outlet wrapper, and React-driven legacy query redirects.
- `routeConfig.ts`: navbar items, path-to-page-key helpers, and pure route translation helpers.

## Current route table

Inside the app shell:

- `/`
- `/info`
- `/crm`
- `/profile`
- `/music`
- `/changyou`
- `/changyou/:entryId`
- `/lamp-registration`
- `/event/:eventId`
- `/image/:imageId` compatibility redirect
- `/login`
- `/not-found`

Standalone routes outside `AppLayout`:

- `/changyou-room`
- `/changyou-room/:roomId`
- `/payment-voucher-sign/:token`

## AppLayout responsibilities

`AppLayout.tsx` does more than layout:

- injects design tokens
- renders the navbar from `NAV_ITEMS`
- filters nav items by auth state
- translates legacy `?page=...` query parameters into router paths with `useLocation()` and `navigate()`
- syncs the floating music player controller on every relevant playback change

## Legacy compatibility

- `resolveLegacyPath()` maps old page keys such as `home`, `CRM`, `lamp_registration`, `event_detail`, and `image_detail` to current routes.
- Legacy inbound query links are handled inside `AppLayout`, but the router layer no longer exposes global navigation bridges.

## Upgrade notes

- The app uses hash routing, so route changes should go through React Router helpers, not direct location pathname assumptions.
- If a new feature needs a navbar item, update both `NAV_ITEMS` and `pageKeyFromPath()`.
- If a route must be reachable from legacy `?page=` links, add it to `resolveLegacyPath()` or `legacyPageToPath`.

## React Router Migration Track

- This folder now owns navigation purely through React Router primitives.
- A remaining broader app migration target is moving CRM module switching from query params to nested paths such as `/crm/:module` and `/crm/permanent-registration/:section`.
