# Event Shared State

Shared React event source for the frontend.

## Goal

Keep album pages, page heroes, and CRM event management on the same event model instead of duplicating fetch logic and browser globals.

## Files

- `EventDataContext.tsx`: app-wide provider, hook, month filtering helper, and `getEventById`.
- `api.ts`: shared event CRUD, event flow CRUD, event media upload, brochure upload, and check-in requests.
- `types.ts`: event list, detail, organizer, attachment, flow, and check-in types.
- `brochurePreview.tsx`: modal iframe preview for brochure files with Office Online fallback for non-PDF documents.

## Provider contract

`useEventData()` exposes:

- `events`
- `loading`
- `error`
- `refreshEvents()`
- `realtimeEnabled`
- `setRealtimeEnabled()`
- `getEventById()`
- `getEventsForMonth()`

## Backend endpoints used here

- `/api/event_data/get_all_event_sort`
- `/api/api/get_event/:eventId`
- `/api/event_data/new_event`
- `/api/event_data/set_poster/:eventId/:fileId`
- `/api/event_data/event_flow/...`
- `/media/upload_media`
- `/api/event_data/upload_brochure/:eventId`
- `/api/event_data/check_in/...`

## Current realtime status

The provider already has a `realtimeEnabled` flag and a reserved channel name, but there is no real event subscription implementation yet. Live event updates are still mostly a future extension point.

## Rules

- New React event-related pages should read from `useEventData()`.
- `events` is the shared sorted event list source for general event browsing.
- If a page mutates event data, it should refresh or reconcile this shared source instead of keeping a separate long-lived list.
- Brochure previews should reuse `openBrochurePreviewModal()` instead of embedding ad-hoc iframe logic.
