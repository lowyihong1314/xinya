# router

Routing and shell-layout layer for the React app.

## Files

- `appRouter.tsx`: top-level route table built with `createHashRouter`.
- `AppLayout.tsx`: sticky navbar shell, outlet wrapper, and legacy page translation.
- `routeConfig.ts`: navbar items and path-to-page-key helpers.
- `LegacyMount.tsx`: mounts old non-router code into a React container.
- `LegacyQueryRedirect.tsx`: translates legacy `?page=` URLs during mount.
- `render_navbar.js`: compatibility bridge for old navigation helpers.

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
- `/image/:imageId`
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
- exposes `window.__xinyaNavigate`
- translates legacy `?page=...` query parameters into router paths
- syncs the floating music player controller on every relevant playback change

## Legacy compatibility

- `resolveLegacyPath()` maps old page keys such as `home`, `CRM`, `lamp_registration`, `event_detail`, and `image_detail` to current routes.
- `render_navbar.js` keeps the old `change_parms` and auth fetch bridge callable from non-React code.

## Upgrade notes

- The app uses hash routing, so route changes should go through React Router helpers, not direct location pathname assumptions.
- If a new feature needs a navbar item, update both `NAV_ITEMS` and `pageKeyFromPath()`.
- If a route must be reachable from legacy `?page=` links, add it to `resolveLegacyPath()` or `legacyPageToPath`.

## React Router Migration Track

- This folder already owns the top-level router, but it is not yet the only navigation authority because `AppLayout.tsx` still exposes `window.__xinyaNavigate`, still translates `?page=` links, and CRM still uses query params for internal module selection.
- Target route shape should move to nested paths such as `/crm/:module`, `/crm/finance/:tab`, and `/crm/permanent-registration/:section` so that `useSearchParams()` is no longer acting as an internal router.
- After all callers are moved to path-based navigation, delete `LegacyQueryRedirect`, `resolveLegacyPath()` fallback handling, and the compatibility helpers in `render_navbar.js`.
