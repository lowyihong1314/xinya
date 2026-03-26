# CRM Changyou

CRM-side songbook management module.

## Scope

This module is the admin counterpart of the frontend `changyou` feature. It manages songbook data that later appears in the public/authenticated changyou reader.

## Structure

- `react/`: songbook admin workspace

## Responsibilities

- search songbook entries including unpublished items
- create and edit song metadata and content
- publish or hide songs from the frontend changyou experience
- delete songbook entries
- bulk-import songbook content from a DOCX source

## Upgrade notes

- The CRM page reuses API helpers and types from `frontend/src/changyou/react`, so backend contract changes affect both admin and reader experiences.
- Treat this folder as the content-authoring side of the same domain, not as a separate data model.

## React Router Migration Track

- Follow the phased migration plan in `frontend/Agent_todo.md`; that file is the source of truth for the full React + React Router upgrade and legacy-removal sequence.
- End-state for this directory is React components, route params or nested routes, shared hooks/context, and React portals instead of query-string routers, `window` bridges, `window.app`, or DOM-built overlays.
- Do not add new legacy mounts, `createRoot(document.body)` helpers, or new UI imports from `static/js/*`; when this area is touched, migrate existing legacy control flow out instead of extending it.
