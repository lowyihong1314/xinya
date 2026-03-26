# CRM Shared

Reusable UI helpers shared across CRM modules.

## Files

- `showEventPicker.tsx`: modal event picker that returns the chosen event record through a promise.

## Event picker behavior

- fetches the full event list from `/api/event_data/get_all_event`
- supports client-side search by name, purpose, and date
- paginates results in groups of eight
- shows event images through `smartImageURL()`
- mounts a temporary React root on `document.body` and resolves with the selected event or `null`

## Why it matters

CRM modules that need to associate records with an event can reuse one picker instead of re-implementing event selection and preview logic in every module.

## Upgrade notes

- The picker currently fetches the full event list in one request, so very large event datasets may need server-side search or pagination later.
- Because the API returns lightweight event records, modules that need full event detail should still follow up with a detail request after selection.
