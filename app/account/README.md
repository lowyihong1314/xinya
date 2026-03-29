# Account Module

Handles reimbursement claims and payment voucher download.

## Files

- `routes.py`: HTTP endpoints and response mapping.
- `services.py`: claim creation, listing, decisions, voucher context.
- `serializers.py`: reimbursement serialization for frontend/PDF.
- `permissions.py`: account-specific auth checks.
- `pdf.py`: ReportLab voucher generation.
- `exceptions.py`: typed domain errors.

## Main Routes

- `POST /api/account/submit_new_claim`
- `GET /api/account/get_all_claim`
- `POST /api/account/claim_decision/<request_id>`
- `DELETE /api/account/delete_claim/<request_id>`
- `GET /api/account/print_payment_voucher/download_payment_voucher/<request_id>`

## Notes

- API paths intentionally keep legacy frontend compatibility.
- Business logic should stay in `services.py`; avoid adding ORM-heavy logic to `routes.py`.
- Claim permissions are split into `account_submit`, `account_read`, and `account_edit`; legacy `account` is no longer used.
