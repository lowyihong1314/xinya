# Changyou React Module

React implementation for songbook browsing, editing, and room entry.

## Files

- `ChangyouPage.tsx`: authenticated songbook list with query, variant filter, and pagination.
- `ChangyouDetailPage.tsx`: song detail reader with settings, chord-family transforms, local preference persistence, version switching, and personal edit mode.
- `ChangyouRoomPage.tsx`: simple route-level room landing shell that links back to the full room experience.
- `api.ts`: songbook list/detail requests, personal edits, admin CRUD helpers, and DOCX import.
- `types.ts`: `SongbookEntry` and version option types.
- `room/`: realtime room feature for controller/player flows.

## Backend endpoints

- `/api/songbook/list`
- `/api/songbook/entry/:entryId`
- `/api/songbook/entry/:entryId/my_edit`
- `/api/songbook/entry`
- `/api/songbook/entry/:entryId`
- `/api/songbook/import_docx`

## Important behaviors

- `ChangyouPage.tsx` forces auth and opens the shared login modal if needed.
- `ChangyouDetailPage.tsx` stores font size, navbar visibility, and chord family in localStorage.
- Chord-family switching is a frontend transformation of chord lines, not a separate backend payload.
- Song detail can switch between the base version and user-specific override versions.

## Upgrade notes

- `ChangyouRoomPage.tsx` at this level is currently a placeholder shell, not the full room implementation.
- If chord syntax changes in the stored song content, the transpose logic in `ChangyouDetailPage.tsx` will likely need updates.
