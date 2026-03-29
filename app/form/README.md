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

## Permission Model
- Public registration and payment submission routes stay public.
- `form_read`: read the CRM form workspace, form detail, fee list, and extra-field list.
- `form_edit`: create/edit/delete forms, fees, extra fields, linked events, and member records.
- `member_detail`: view sensitive member detail inside the Members section, including parental data and payment records.
- `youth_class_read`: read the youth-class CRM workspace.
- `youth_class_edit`: edit youth-class fee settings and applicant/payment statuses.
- Register-payment review routes under `/payment/*` are still tied to finance permission `account_edit`, while proof-image reads allow finance readers and form member-detail readers.
