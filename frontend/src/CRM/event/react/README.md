# Event Table React Module

React rewrite for the CRM event table workspace.

## Structure

- `EventTablePage.tsx`: page composition and controller wiring.
- `EventTableView.tsx`: search, event list, detail editor, organizer panel.
- `useEventTableController.ts`: centralized state and backend updates.
- `useEventTableRealtime.ts`: reserved hook for future socket updates.
- `api.ts`: event table HTTP helpers.
- `types.ts`: event and organizer types.

## Current scope

- Event list is React-driven.
- Search is React-driven.
- Event detail editing is React-driven.
- Organizer adding still reuses the legacy `select_users_modal.js` selector.

## Theme rule

- All colors must come from `frontend/src/theme/designTokens.ts`.
- If a new tint, shadow, or border color is needed, add a token first and then consume the CSS variable here.
