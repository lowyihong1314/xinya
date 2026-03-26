# CRM Shared

Reusable UI helpers shared across CRM modules.

## Files

- `showEventPicker.tsx`: modal event picker that returns the chosen event record through a promise.

## Event picker behavior

- fetches the full event list from `/api/event_data/get_all_event`
- supports client-side search by name, purpose, and date
- paginates results in groups of eight
- shows event images through `smartImageURL()`
- mounts a temporary React root on `document.body` and resolves with the selected event or `null`

## Why it matters

CRM modules that need to associate records with an event can reuse one picker instead of re-implementing event selection and preview logic in every module.

## Upgrade notes

- The picker currently fetches the full event list in one request, so very large event datasets may need server-side search or pagination later.
- Because the API returns lightweight event records, modules that need full event detail should still follow up with a detail request after selection.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
