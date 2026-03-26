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

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
