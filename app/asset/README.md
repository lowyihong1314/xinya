# Asset Module

Handles warehouse, asset item, stock document, and inventory movement APIs.

## Main Routes

- `GET /api/asset/dashboard`
- `POST /api/asset/warehouses`
- `POST /api/asset/partners`
- `POST /api/asset/items`
- `POST /api/asset/items/<item_id>/sub-items`
- `POST /api/asset/stock-documents`
- `POST /api/asset/stock-documents/<document_id>/confirm`

## Notes

- MVP reuses `account_read` / `account_edit` permissions and also recognizes `asset_read` / `asset_edit`.
- Stock changes should happen through stock documents; confirmation generates movement rows and updates `asset_inventory`.
