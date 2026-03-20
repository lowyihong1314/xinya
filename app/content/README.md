# Content Module

Handles informational content pages such as About Us and history timelines.

## Files

- `routes.py`: CRUD-style endpoints for `AboutUs` and `OurHistory`.

## Main Routes

- `GET /api/info/get_about_us_text`
- `GET /api/info/get_our_history`
- `POST|DELETE /api/info/about_us_text`
- `POST|DELETE /api/info/add_our_history`

## Notes

- This module is a direct migration target from the old `function/info.py`.
- If content logic grows, split database operations into a `services.py`.
- `OurHistory` images are stored under `static/images/info`.
