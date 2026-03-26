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
