# YLP

YLP-specific backend modules for the 盂兰盆法会 flow.

## Modules
- `routes.py`: order search/detail/customer endpoints.
- `services.py`: order serialization and owner/session access rules.
- `shared.py`: YLP-only shared helpers for version normalization, pricing, and payment status.
- `payment_routes.py` / `payment_services.py`: YLP order-linked payment flow such as create/list-by-order, quotation, and receipt.
- `board_routes.py` / `board_services.py`: board placement and paiwei item editing.
- `print_routes.py` / `print_generator.py` / `print_points.py`: paiwei preview and printable PDF generation.
- `receipt.py`: receipt printer payload generation.

## Compatibility
- Canonical routes now live beside legacy aliases in the same blueprints, so old clients can keep working while newer code uses clearer endpoint names.
- YLP payment upload now reuses [payment.py](/home/yukang/flaskapp/xinya/app/fahui/common/payment.py), while cross-fahui review/detail routes now live in [payment_routes.py](/home/yukang/flaskapp/xinya/app/fahui/common/payment_routes.py) and [payment_review.py](/home/yukang/flaskapp/xinya/app/fahui/common/payment_review.py).
