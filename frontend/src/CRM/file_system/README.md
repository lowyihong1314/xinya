# CRM File System

Admin file-manager module.

## Route integration

- CRM module key: `files`
- legacy compatibility route: `#/files`

## Scope

This module provides an admin-facing file explorer with upload, move, rename, archive download, trash recovery, and permission management features.

## Structure

- `react/`: main page, view, controller, API helpers, styles, types, and utilities

## Shared dependency note

The file manager reuses CRM user and department data from `CRM/user_control/react/api.ts` when assigning directory permissions.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
