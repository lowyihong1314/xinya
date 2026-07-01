# Album React Module

React implementation for the album/home experience.

## Files

- `HomeAlbumPage.tsx`: monthly calendar view and selected-date event panel.
- `EventDetailPage.tsx`: full event detail route, hero, tabs, admin actions, and media room subscription.
- `PhotoGrid.tsx`: infinite event media wall with selection state and popup preview.
- `PhotoGridBatchActions.tsx`: multi-select toolbar for download and delete actions.
- `EditEventModal.tsx`: event metadata editor, poster chooser, and brochure upload/remove flow.
- `EventCheckInPanel.tsx`: user search and check-in rollback UI for a selected event day.
- `EventFlowModal.tsx`: event flow editor with timing calculation and drag-reorder.
- `UploadMediaModal.tsx`: upload queue UI for images and videos.
- `mediaRealtime.ts`: socket.io helper for event media room notifications.

## Current scope

- `HomeAlbumPage.tsx` replaces the old home calendar entry from `init_event_data.js`.
- `EventDetailPage.tsx` is the React shell for single-event pages.
- Photo preview is handled inside the event listing route through `?img_id=...`.
- Home event data comes from the shared event provider in `frontend/src/event/shared`.
- Upload and photo grid actions now live completely inside React.
- Legacy redirect helpers have been removed from `frontend/src/album`.

## Backend integrations

- shared event endpoints from `frontend/src/event/shared/api.ts`
- `/api/api/get_file_data/:imageId` for legacy image-route redirects
- `/media/rotate_file/:fileId/:angle`
- `/media/download_files`
- `/media/delete_files`
- realtime media updates over socket rooms joined through `mediaRealtime.ts`

## State rule

- Album home and CRM event management must read from the same `useEventData()` provider.
- New event-related React pages should not create their own standalone event list fetch layer.

## Theme rule

- All new colors must come from `frontend/src/theme/designTokens.ts`.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
