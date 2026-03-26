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

## Main capabilities

- browse directory tree and breadcrumb path
- switch between grid and list views
- inspect selected file metadata and permission history
- upload files or whole folders
- create folders
- rename files and directories
- move files
- create zip archives from selected files
- create share links
- move items to trash and restore trash items
- set directory permissions for users or departments

## Backend endpoints

- `/api/files/history/views`
- `/api/files/tree`
- `/api/files/query`
- `/api/files/items/:fileId`
- `/api/files/items/:fileId/permissions`
- `/api/files/trash`
- `/api/files/directories`
- `/api/files/directories/rename`
- `/api/files/items/:fileId/rename`
- `/api/files/items/move`
- `/api/files/items`
- `/api/files/shares`
- `/api/files/trash/:trashId/restore`
- `/api/files/permissions/:permissionId`
- `/api/files/directories/permissions`
- `/api/files/uploads`
- `/api/files/items/archive`

## Theme

This module uses global design tokens from:

- `frontend/src/theme/designTokens.ts`

Prefer consuming those tokens instead of introducing hardcoded colors in new components.

## Rule Of Thumb

- Keep page files focused on composition.
- Put fetch logic in `api.ts`.
- Put stateful orchestration in hooks/controllers.
- Keep single `.tsx` files under roughly 600 lines.

## Upgrade notes

- `useFileSystemController.ts` bootstraps from history first and falls back to `/home`, so history endpoint failures should not block the whole module.
- Directory permissions depend on CRM user-control APIs; permission UI changes should be reviewed together with that module.
