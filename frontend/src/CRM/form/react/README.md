# Form React Module

React rewrite for the CRM register/forms workspace.

## Structure

- `FormWorkspacePage.tsx`: page composition and wiring.
- `FormWorkspaceView.tsx`: presentational workspace, list, edit panels, create modal.
- `ExtraFieldEditor.tsx`: reusable extra-field editor for admin create/edit flows.
- `useFormWorkspace.ts`: centralized state, fetch/update actions, optimistic refresh flow.
- `useFormRealtime.ts`: reserved subscription hook for future socket updates.
- `showRegisterDetail.tsx`: React-hosted member detail modal entry and detail view.
- `api.ts`: `/api/form/*` client helpers.
- `types.ts`: local form, fee, extra field, and member types.

## Current scope

- Form list is React-driven.
- Create form is React-driven.
- Basic form fields, fees, extra fields, event binding, and member list are React-driven.
- Member detail is React-driven.

## Realtime reservation

- `useFormRealtime.ts` is the only place where future socket subscription should be attached.
- The page already exposes a local realtime toggle and refresh callback contract.

## Theme rule

- All colors must come from `frontend/src/theme/designTokens.ts`.
- If a new translucent, shadow, or border color is needed, add a token first and use the CSS variable in the workspace.
