# src

Primary application source tree for the React frontend.

## Layout strategy

This directory mixes three kinds of code:

- app shell code that is always mounted (`app`, `router`, `theme`, `types`)
- shared utilities and reusable UI (`components`, `js`, `event/shared`)
- feature modules that map to routes or legacy mount points (`album`, `info`, `lamp`, `music`, `profile`, `changyou`, `CRM`)

## Route-facing modules

- `album/react`: home page, event detail page, image detail page, media upload and event flow helpers
- `info/react`: public intro page with authenticated edit mode
- `profile/react`: profile, footprints, avatar upload, membership renewal
- `music/react`: album and track workspace plus playback helpers
- `changyou/react`: changyou list, detail, and room views
- `CRM/react`: main CRM landing page and CRM feature modules

## Shared infrastructure

- `app`: provider composition and current-user state
- `router`: app layout, navbar config, route table, and legacy query translation
- `theme`: source of CSS custom properties used across the React UI
- `types`: `Window` extensions used by the hybrid legacy/React runtime
- `components`: shared hero/media components
- `js`: media lookup, alert modals, attachment previews, OTP bootstrap, legacy style reset
- `event/shared`: event APIs, shared event types, and the app-wide event provider

## Conventions

- New React pages should prefer shared providers over ad-hoc global fetch logic.
- Feature-specific helpers should stay inside that feature unless they are reused by unrelated modules.
- Browser globals still exist for compatibility, so any change to global navigation or auth bridges must be reflected in `types/global.d.ts`.
- Most pages call `ensureDesignTokens()` locally so they remain safe even when mounted from legacy entrypoints.

## Upgrade notes

- The same backend API surface is currently consumed by both legacy code and React rewrites.
- Some folders contain compatibility entrypoints for old callers even after the route moved into React.
- When documenting a feature, inspect both the route component and any shared provider, API helper, or utility it imports from sibling directories.

## React Router Migration Track

- This source tree is still hybrid. Top-level routing is React Router-based, but some sub-features still emulate routing with search params, global bridges, or imperative mount points.
- New work in `src/` should default to React components, typed hooks/context, and route params or nested routes instead of `window.location.hash`, `window.__xinyaNavigate`, `window.app`, or search-param tab routers.
- UI helpers that currently mount directly on `document.body` should migrate toward one shared portal/modal layer. UI code should not add new imports from `static/js/form/*` or `static/js/sign_tools.js`.
