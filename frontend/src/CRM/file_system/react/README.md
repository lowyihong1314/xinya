# File System React

React-based file manager UI for `/api/files/*`.

Primary user-facing entry now lives under CRM:

- `#/crm?crm=files`

Legacy route compatibility:

- `#/files` redirects to the CRM files module.

## Structure

- `FileSystemPage.tsx`: page-level composition only.
- `useFileSystemController.ts`: state and async action orchestration.
- `FileSystemView.tsx`: presentational layout and subcomponents.
- `api.ts`: filesystem HTTP client helpers.
- `types.ts`: shared types for the module.
- `utils.ts`: formatting and browser helpers.
- `styles.ts`: local component style objects.

## Mount Modes

- Standalone: used by legacy compatibility route `#/files`.
- Embedded: used inside CRM at `#/crm?crm=files` to avoid double page shells.

## Theme

This module uses global design tokens from:

- `frontend/src/theme/designTokens.ts`

Prefer consuming those tokens instead of introducing hardcoded colors in new components.

## Rule Of Thumb

- Keep page files focused on composition.
- Put fetch logic in `api.ts`.
- Put stateful orchestration in hooks/controllers.
- Keep single `.tsx` files under roughly 600 lines.
