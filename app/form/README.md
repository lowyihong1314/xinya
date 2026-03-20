# Form

This package owns registration form rendering, registration flow, fee config, extra field config, and form PDF export.

## Files
- `routes.py`: Flask routes for `/form/*`.
- `services.py`: form CRUD, member registration, fee and field management.
- `realtime.py`: Socket.IO helpers for wait-register room broadcasts.
- `pdf.py`: HTML-to-PDF merge helper.

## Notes
- External URL prefix stays `/form` for compatibility.
- Event poster and template rendering remain in this package because they are form-facing behavior.
