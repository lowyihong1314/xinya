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
