# Album React Module

React implementation for the album/home experience.

## Current scope

- `HomeAlbumPage.tsx` replaces the old home calendar entry from `init_event_data.js`.
- `EventDetailPage.tsx` is the new React shell for single-event pages.
- `ImageDetailPage.tsx` is the React image/video viewer route for `/image/:imageId`.
- Home event data now comes from the shared event provider in `frontend/src/event/shared`.
- `PhotoGrid.tsx` now owns the main photo grid in React.
- `EditEventModal.tsx` now owns event info editing in React.
- `UploadMediaModal.tsx` now owns media upload in React.
- `EventFlowModal.tsx` now owns event flow management in React.
- Legacy redirect helpers have been removed from `frontend/src/album`.

## State rule

- Album home and CRM event management must read from the same `useEventData()` provider.
- New event-related React pages should not create their own standalone event list fetch layer.

## Theme rule

- All new colors must come from `frontend/src/theme/designTokens.ts`.
