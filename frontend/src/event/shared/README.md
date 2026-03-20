# Event Shared State

Shared React event source for the frontend.

## Goal

Keep album/home event data and CRM event management on the same state source instead of duplicating fetch logic and local globals.

## Structure

- `EventDataContext.tsx`: provider and shared hooks.
- `api.ts`: event list API fetchers.
- `types.ts`: shared event types.

## Rules

- New React event-related pages should read from `useEventData()`.
- `events` is the only shared sorted event list source.
- If CRM mutates event data, it should refresh or update this shared source instead of keeping a private event list.
- Future socket-based updates should also land here first.
