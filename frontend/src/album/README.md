# Album Module

Album is now React-first.

## Active implementation

- `react/HomeAlbumPage.tsx`
- `react/EventDetailPage.tsx`
- `react/PhotoGrid.tsx`
- `react/EditEventModal.tsx`
- `react/UploadMediaModal.tsx`
- `react/EventFlowModal.tsx`
- `react/ImageDetailPage.tsx`

## Rules

- Do not add new legacy DOM helpers under `frontend/src/album`.
- New album work should extend the React implementation only.
- Shared event list data must come from `frontend/src/event/shared`.
