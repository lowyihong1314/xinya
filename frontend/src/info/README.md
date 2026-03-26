# info

Organization introduction and history feature.

## Route

- `/info`

## Scope

This feature renders the public-facing "about us" experience and also supports authenticated inline editing for organization content.

## Structure

- `react/`: page implementation, API helpers, and local types

## Key dependencies

- `PageHero` from `src/components`
- `useUserState()` for auth-aware editing
- CRM user-control data for the member card section
- shared design tokens from `src/theme`

## Data shown on the page

- paged member cards
- about-us text entries
- organization history timeline entries

## Upgrade notes

- This module mixes public browsing and authenticated editing in the same page component.
- Member data is not owned locally; it is fetched from CRM user-control APIs, so changes in CRM user shapes can affect `/info`.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
