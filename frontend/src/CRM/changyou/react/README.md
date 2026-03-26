# CRM Changyou React Module

React admin workspace for managing songbook content.

## Files

- `SongbookAdminPage.tsx`: searchable admin editor for song metadata, publication state, and content editing.

## What the page does

- loads entries through the admin-only songbook list endpoint
- filters by query and variant
- paginates results
- loads full entry detail when a list item is selected
- supports creating a new song entry
- supports updating and deleting the selected entry
- supports DOCX import from a configured server-side path

## Shared dependencies

This page intentionally reuses the public changyou domain layer:

- API helpers from `frontend/src/changyou/react/api.ts`
- `SongbookEntry` types from `frontend/src/changyou/react/types.ts`

## Backend endpoints used here

- `/api/songbook/list?include_unpublished=1`
- `/api/songbook/entry/:entryId`
- `/api/songbook/entry`
- `/api/songbook/entry/:entryId`
- `/api/songbook/import_docx`

## Upgrade notes

- The default import path is hardcoded in `SongbookAdminPage.tsx`, so deployment path changes require code changes unless this becomes configurable.
- Because this page shares types with the reader experience, adding new song fields should be coordinated across both CRM and non-CRM changyou modules.
