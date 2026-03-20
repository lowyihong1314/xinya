# Filesystem Module

Provides the new file manager API under `/api/files`.

## Files

- `routes.py`: REST-style file manager endpoints.
- `services.py`: path handling, permissions, uploads, deletes, shares, directory queries.
- `serializers.py`: file/list/history output shaping.
- `paths.py`: storage root definition.

## Main Routes

- `GET /api/files/history/views`
- `GET /api/files/tree`
- `POST /api/files/query`
- `GET /api/files/items/<id>`
- `GET /api/files/items/<id>/content`
- `POST /api/files/items/archive`
- `POST /api/files/uploads`
- `POST /api/files/directories`
- `POST /api/files/items/move`
- `PATCH /api/files/items/<id>/rename`
- `GET /api/files/directories/detail`
- `PATCH /api/files/directories/rename`
- `GET /api/files/items/<id>/permissions`
- `PUT /api/files/directories/permissions`
- `DELETE /api/files/permissions/<id>`
- `DELETE /api/files/directories`
- `DELETE /api/files/items`
- `GET /api/files/trash`
- `POST /api/files/trash/<id>/restore`
- `POST /api/files/shares`
- `GET /api/files/shares/<token>/download`

## Current Gaps

Remaining gaps:

- permanent delete from trash
- share list / revoke APIs
- copy file / copy directory APIs
- finer-grained single-file permission update API
- search API

## Notes

- This module does not preserve the old `/api/file_system/*` route shape.
- Frontend file manager code has already been switched to `/api/files/*`.
