# Public API Module

Contains small, general-purpose API endpoints that do not justify their own domain package yet.

## Files

- `routes.py`: event lookup and registration/form-related lightweight reads.

## Main Routes

- `GET /api/api/ping`
- `GET /api/api/get_event/<event_id>`
- `GET /api/api/get_file_data/<file_id>`
- `GET /api/api/forms`
- `GET /api/api/members`
- `GET /api/api/payments`

## Notes

- The `/api/api/*` prefix is legacy and currently preserved.
- If this module grows, split it by domain instead of letting it become another catch-all.
