# api/asset — 仓库 / 物品 / 库存单据

> v3：已从 Flask 蓝图搬到 FastAPI（原 `backend/app/asset/`）。
> `routes.py` → `router.py`，`services.py` → `service.py`，
> `serializers.py` / `exceptions.py` / `permissions.py` 原样平移（只换 import 来源）。
> URL 少了 `/api` 这一段：`/api/asset/...` → `/asset/...`。

Warehouse / asset item / stock document / inventory movement APIs.

## 模型（`models/asset.py`）
- `AssetItem` — 物品（名称 + 编码 `ITM-0001` + 单位）。
- `AssetSubItem` — 物品下的具体条目（尺码 / 颜色 / SKU / 条码），**库存的最小单位**。
- `AssetWarehouse` — 仓库（编码 `WH-0001`，可挂负责人）。
- `AssetPartner` — 往来对象（supplier / customer / both）。
- `AssetInventory` — 某仓库里某个子 item 的 `quantity` / `reserved_quantity` / `min_quantity`。
- `AssetStockDocument` + `AssetStockDocumentLine` — 单据头与明细，`status` ∈ draft/confirmed/cancelled。
- `AssetStockMovement` — 库存流水，**只增不减**（作废是写一条反向流水，不是删原行）。

## 路由（`/asset`，26 条）
- 只读：`GET /dashboard`、`/master-data`、`/inventory`、`/movements`、`/partners`、`/stock-documents`
- 仓库：`POST /warehouses`，`PATCH|DELETE /warehouses/<id>`
- 往来对象：`POST /partners`，`PATCH|DELETE /partners/<id>`
- 物品：`POST /items`，`PATCH|DELETE /items/<id>`，`POST /items/<id>/sub-items`，
  `PATCH|DELETE /sub-items/<id>`
- 单据：`POST /stock-documents`，`PATCH|DELETE /stock-documents/<id>`，
  `POST /stock-documents/<id>/{confirm,cancel,post-to-finance,invoice}`
- 预警线：`PATCH /inventory/<id>/threshold`

## 权限
MVP 沿用会计模块的权限，同时认资产自己的两个：
读 = `asset_read`|`asset_edit`|`account_read`|`account_edit`；写 = `asset_edit`|`account_edit`。

## 一条必须守住的规矩
**库存数量只能经由单据确认改变。** `confirm_stock_document` 生成 `AssetStockMovement`
并同步 `AssetInventory.quantity`，没有任何接口能直接写 quantity；
`PATCH /inventory/<id>/threshold` 改的是 `min_quantity`（预警线），不是库存。

## 发票文件
`POST /stock-documents/<id>/invoice`（multipart，字段名 `file`）落盘到
`DATA_ROOT/NAS/UTBA/asset_invoice/`，库里只存相对路径。
换文件时旧文件会被删掉。文件名**故意不过 `secure_filename`**（发票名常含中文，
那个函数会把中文整个清空），安全性由 `basename` + 重命名保证 —— 见 `service.py` 顶部 ⑤。
