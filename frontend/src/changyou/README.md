# changyou

Songbook browsing and changyou room feature.

## Routes

- `/changyou` -> song list
- `/changyou/:entryId` -> song detail and editing view
- `/changyou-room` -> room landing page
- `/changyou-room/:roomId` -> room controller or player page

## Structure

- `react/`: main changyou React pages, APIs, and types

## Scope

This feature covers:

- authenticated songbook browsing
- song detail reading with font-size and chord-family settings
- per-user lyric/chord edits
- switching between base and user-edited versions
- realtime room playback for a controller screen and a player screen

## Upgrade notes

- Auth matters across almost the whole feature. Most screens open the shared login modal when the user is not authenticated.
- The room experience is split between a lightweight route shell in `react/ChangyouRoomPage.tsx` and the full room implementation under `react/room/`.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
