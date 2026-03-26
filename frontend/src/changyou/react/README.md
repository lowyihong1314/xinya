# Changyou React Module

React implementation for songbook browsing, editing, and room entry.

## Files

- `ChangyouPage.tsx`: authenticated songbook list with query, variant filter, and pagination.
- `ChangyouDetailPage.tsx`: song detail reader with settings, chord-family transforms, local preference persistence, version switching, and personal edit mode.
- `ChangyouRoomPage.tsx`: simple route-level room landing shell that links back to the full room experience.
- `api.ts`: songbook list/detail requests, personal edits, admin CRUD helpers, and DOCX import.
- `types.ts`: `SongbookEntry` and version option types.
- `room/`: realtime room feature for controller/player flows.

## Backend endpoints

- `/api/songbook/list`
- `/api/songbook/entry/:entryId`
- `/api/songbook/entry/:entryId/my_edit`
- `/api/songbook/entry`
- `/api/songbook/entry/:entryId`
- `/api/songbook/import_docx`

## Important behaviors

- `ChangyouPage.tsx` forces auth and opens the shared login modal if needed.
- `ChangyouDetailPage.tsx` stores font size, navbar visibility, and chord family in localStorage.
- Chord-family switching is a frontend transformation of chord lines, not a separate backend payload.
- Song detail can switch between the base version and user-specific override versions.

## Upgrade notes

- `ChangyouRoomPage.tsx` at this level is currently a placeholder shell, not the full room implementation.
- If chord syntax changes in the stored song content, the transpose logic in `ChangyouDetailPage.tsx` will likely need updates.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
