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
- `POST /api/account/claim/read_bill`
- `POST /api/account/claim_decision/<request_id>`
- `DELETE /api/account/delete_claim/<request_id>`
- `GET /api/account/print_payment_voucher/download_payment_voucher/<request_id>`

## Read Bill API

- `/api/account/claim/read_bill` proxies receipt images/PDFs to `https://nginx.yihong1031.com/read_bill_api`.
- Supported upstream model values are `auto`, `byteplus`, and `local`; this module defaults to `auto` unless `READ_BILL_DEFAULT_MODEL` is set.
- Upstream duplicate bypass uses `debug=true`. Legacy local `bypass=true` requests are accepted for compatibility but are converted to `debug=true` and not forwarded as `bypass`.
- PDF uploads first try text extraction through `/parse-text`; if no useful text is found, the first page is rendered to JPEG and sent to `/upload`.

## Notes

- API paths intentionally keep legacy frontend compatibility.
- Business logic should stay in `services.py`; avoid adding ORM-heavy logic to `routes.py`.
- Claim permissions are split into `account_submit_claim`, `account_read`, and `account_edit`; legacy `account` / `account_submit` are no longer used.
- `account_submit_income` is reserved for income submission flows; read/edit finance access still uses `account_read` / `account_edit`.
