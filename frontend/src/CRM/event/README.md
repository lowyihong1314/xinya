# CRM Event

CRM event-table management module.

## Scope

This module is the admin-side editor for the shared event domain. It works on the same event list used by the public album and other event-aware features, but exposes CRUD and attachment-management actions for staff.

## Structure

- `react/`: event table page, controller, view, API helpers, and types

## Responsibilities

- browse and search events
- create new events
- update event metadata
- add organizers through the legacy user selector
- upload and remove brochures
- upload and remove event attachments
- delete events

## Shared dependency note

The CRM event table reads from `useEventData()` in `frontend/src/event/shared`, so backend event changes should stay aligned with the shared event provider contract.
