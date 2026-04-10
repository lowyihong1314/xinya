# src

Primary application source tree for the React frontend.

## Layout strategy

This directory mixes three kinds of code:

- app shell code that is always mounted (`app`, `router`, `theme`, `types`)
- shared utilities and reusable UI (`components`, `js`, `event/shared`)
- feature modules that map to routes or route-compatible entrypoints (`album`, `info`, `lamp`, `music`, `profile`, `changyou`, `CRM`)

## Route-facing modules

- `album/react`: home page, event detail page, image detail page, media upload and event flow helpers
- `info/react`: public intro page with authenticated edit mode
- `profile/react`: profile, footprints, avatar upload, membership renewal
- `music/react`: album and track workspace plus playback helpers
- `changyou/react`: changyou list, detail, and room views
- `CRM/react`: main CRM landing page and CRM feature modules

## Shared infrastructure

- `app`: provider composition and current-user state
- `router`: app layout, navbar config, route table, app chrome state, and navigation bridge helpers
- `theme`: source of CSS custom properties used across the React UI
- `types`: ambient frontend declarations such as `vite/client`
- `components`: shared hero/media components
- `js`: media lookup, OTP bootstrap, overlay dialogs, attachment previews, and browser action helpers
- `event/shared`: event APIs, shared event types, and the app-wide event provider

## Conventions

- New React pages should prefer shared providers over ad-hoc global fetch logic.
- Feature-specific helpers should stay inside that feature unless they are reused by unrelated modules.
- Cross-cutting overlays should go through the shared overlay host rather than creating ad-hoc roots.
- Pages that rely on theme variables should use `useEnsureDesignTokens()` inside React instead of mutating the DOM during render.

## Upgrade notes

- The same backend API surface is still consumed by both routed React views and a few compatibility shims.
- Some folders keep route-compatible wrappers for older callers even after the main experience moved into React Router.
- When documenting a feature, inspect both the route component and any shared provider, API helper, or utility it imports from sibling directories.

## Router and UI Rules

- New work in `src/` should default to React components, typed hooks/context, and route params or nested routes.
- Navigation should go through React Router or `navigateWithRouter()`, not direct `window.location.hash` mutation.
- Overlay UI should use the shared app overlay host instead of creating one-off roots on `document.body`.
- UI code should not add new imports from `static/js/form/*` or new legacy mount helpers.
