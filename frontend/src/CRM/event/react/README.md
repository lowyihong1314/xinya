# Event Table React Module

React rewrite for the CRM event table workspace.

## Structure

- `EventTablePage.tsx`: page composition and controller wiring.
- `EventTableView.tsx`: search, event list, detail editor, organizer panel.
- `useEventTableController.ts`: centralized state and backend updates.
- `useEventTableRealtime.ts`: reserved hook for future socket updates.
- `api.ts`: event table HTTP helpers.
- `types.ts`: event and organizer types.

## Current scope

- Event list is React-driven.
- Search is React-driven.
- Event detail editing is React-driven.
- Organizer adding still reuses the legacy `select_users_modal.js` selector.
- Brochure and event-file management are React-driven.
- Event creation and deletion are React-driven.

## Backend endpoints

- `/api/event_data/get_all_event_sort`
- `/api/event_data/new_event`
- `/api/event_data/delete_event/:eventId`
- `/api/event_data/upload_brochure/:eventId`
- `/api/event_data/event_file/upload/:eventId`
- `/api/event_data/event_file/delete/:fileId`

## Shared state model

- `useEventTableController.ts` reads the base event list from `useEventData()`.
- Mutations refresh the shared provider instead of keeping a CRM-only event cache.
- Selected event poster preview is resolved through `smartImageURL()`.

## Realtime note

`useEventTableRealtime.ts` is currently only a reserved hook and debug channel placeholder. There is no real event-table live update stream yet.

## Theme rule

- All colors must come from `frontend/src/theme/designTokens.ts`.
- If a new tint, shadow, or border color is needed, add a token first and then consume the CSS variable here.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
