# Changyou Room React Module

Realtime room experience for changyou controller and player screens.

## Files

- `ChangyouRoomPage.tsx`: full room feature with room list, room creation, controller UI, and player UI.
- `api.ts`: room CRUD and current-song push helpers.
- `socket.ts`: socket.io join helper for changyou room updates.

## Roles

The room payload includes a `role` field:

- `controller`: can choose a song, select base or user-edited versions, and push content to the room
- `player`: receives the current pushed song and renders a display-friendly reading screen

## Backend endpoints

- `/api/changyou_room/list`
- `/api/changyou_room/create`
- `/api/changyou_room/room/:roomId`
- `/api/changyou_room/room/:roomId/current`
- `/api/changyou_room/room/:roomId/push`

## Realtime flow

- The room page joins `changyou:${roomId}` over socket.io.
- The controller pushes a selected song entry and version selection to the backend.
- The player screen updates when `changyou_room_update` events arrive.
- A QR code is generated client-side so another device can open the player URL quickly.

## Upgrade notes

- `api.ts` currently types the returned `entry` as `any`; tightening that contract would reduce drift between room playback and songbook detail pages.
- This room implementation lives separately from the placeholder `../ChangyouRoomPage.tsx`, so check both files before changing routing behavior.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
