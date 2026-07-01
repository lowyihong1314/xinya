# Album Module

Album is now React-first.

## Routes

- `/` -> `react/HomeAlbumPage.tsx`
- `/event/:eventId` -> `react/EventDetailPage.tsx`
- `/image/:imageId` -> compatibility redirect to `/event/:eventId?img_id=:imageId`

## Active implementation

- `react/HomeAlbumPage.tsx`: monthly event calendar, hero, and daily event preview cards
- `react/EventDetailPage.tsx`: event hero, toolbar, photo/check-in tabs, edit modal, event flow modal, and upload modal
- `react/PhotoGrid.tsx`: infinite media wall with batch actions and popup preview
- `react/EventCheckInPanel.tsx`: same-day member check-in UI
- `react/EditEventModal.tsx`: event metadata, poster selection, and brochure management
- `react/UploadMediaModal.tsx`: batch media upload queue
- `react/EventFlowModal.tsx`: event flow CRUD and drag-reorder
- `react/mediaRealtime.ts`: socket room helper for live media updates

## Shared dependencies

- `frontend/src/event/shared` for event data, detail fetches, mutations, and brochure preview
- `frontend/src/components/CacheMediaPlayer` for media rendering
- `frontend/src/js/get_img.ts` for preview URL resolution

## Runtime notes

- Home page event list state comes from the shared `EventDataProvider`.
- Event detail page still performs a detail fetch because the shared provider only holds the sorted event list, not the full event payload.
- Media upload, deletion, rotation, and video processing feedback are reflected through socket notifications plus silent detail refreshes.

## Rules

- Do not add new legacy DOM helpers under `frontend/src/album`.
- New album work should extend the React implementation only.
- Shared event list data must come from `frontend/src/event/shared`.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
