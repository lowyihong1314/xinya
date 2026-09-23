# Common

Shared helpers for FAHUI subdomains.

## Modules
- `payment.py`: shared payment upload, file-resolution, and review-state helpers for lamp and YLP.
- `payment_review.py`: unified FAHUI payment serializer and review workflow for lamp + YLP, keyed by `type`.
- `payment_routes.py`: unified FAHUI payment review/detail routes mounted under `/api/payment/*`.
- `ylp_storage.py`: YLP asset/data path resolution helpers.
- `session_state.py`: request/session helpers shared by FAHUI flows.
