# profile

Current-user profile, footprint, and membership self-service feature.

## Route

- `/profile`

## Structure

- `react/`: main React implementation, API helpers, and local types

## Scope

This feature lets an authenticated user:

- view high-level account and activity summary
- update profile fields
- upload a profile image
- review registration and youth-class footprints
- start or renew membership actions
- log out from the current session

## Shared dependencies

- `useUserState()` for auth and current user data
- `designTokens` for page styling
- backend user-control APIs for profile, images, footprints, and membership renewal

## Upgrade notes

- The route is visible through the main router, but the page itself still contains its own guest-state gate.
- Domain-specific profile types in `react/types.ts` are effectively a frontend contract for the user-control API responses.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
