# event

Shared event domain layer used by multiple React features.

## Scope

This folder is not a routed page by itself. It holds shared event state and event-specific helpers that are consumed by:

- the album home page and event detail experience
- shared hero content on other pages
- CRM event management screens

## Structure

- `shared/`: event provider, API helpers, shared types, and brochure preview modal

## Runtime role

- `EventDataProvider` is mounted globally in `src/app/App.tsx`.
- Any React page that needs the shared sorted event list should prefer `useEventData()`.

## Upgrade notes

- Treat this folder as the domain source of truth for event list state.
- If an event mutation page appears to manage its own list privately, that is a drift risk; prefer refreshing or updating the shared provider state instead.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
