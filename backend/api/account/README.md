# api/account — 报销申请 · 财政收款 · Payment Voucher

> v3：已从 Flask 蓝图搬到 FastAPI（原 `backend/app/account/`）。
> `routes.py` → `router.py`，`services.py` → `service.py`，其余文件原样平移，
> 另新增一个 `uploads.py`（werkzeug FileStorage / request.form 的薄垫片）。
> URL 少了 `/api` 这一段：`/api/account/...` → `/account/...`，其余路径一字未动。

## 文件

| 文件 | 作用 |
| --- | --- |
| `router.py` | 21 条路由。两个旧蓝图（`account_bp` 16 条 + `payment_voucher_bp` 5 条）合成一个 router，挂载路径与原来逐字一致。 |
| `service.py` | 业务逻辑：报销单 CRUD/审批、AI 读单、财政收款聚合、Payment Voucher 上下文。 |
| `serializers.py` | 报销单 → JSON。前端列表/详情页、PDF、公开签名页共用同一份。 |
| `permissions.py` | 本模块自己的权限判定（抛 AccountError，不走 core.auth 的装饰器）。 |
| `exceptions.py` | 异常 → 状态码映射。⚠️ `ValidationError` 在这里是 **400**（gl 那边是 422）。 |
| `pdf.py` | reportlab 画三种 PDF。**完全不依赖框架**，搬迁时一字节没改。 |
| `read_bill_ark.py` | 直连 BytePlus(Ark) 读收据。配置已从 `env_value()` 改为直接读 `settings`。 |
| `uploads.py` | 搬迁新增：把 starlette 的 `UploadFile`/`FormData` 包成 Flask 的 `request.form` / `request.files` 形状，让 `service.py` 能逐字照搬。 |

## 路由（`/account`）

### 报销申请
- `POST   /submit_new_claim`（multipart）→ 201
- `GET    /get_all_claim`
- `POST   /claim/read_bill`（multipart）— AI 读单
- `POST   /claim/report` — 批量导出 PDF
- `POST   /claim_decision/{id}` — 审批（approve / reject）
- `POST   /claim/{id}/withdraw_decision` — 撤回**自己**的签名（只要求登录）
- `PUT    /claim/{id}`、`DELETE /delete_claim/{id}`
- `POST   /claim/{id}/attachments`（multipart）、`DELETE /claim/attachments/{id}`
- `PUT    /claim/{id}/event` — 关联活动（只要求登录；已批准的单也可改）

### 财政收款（聚合列表）
- `GET    /payments?scope=&status=`
- `POST   /payments/manual`、`DELETE /payments/manual/{id}`
- `POST   /payments/{id}/status`
- `POST   /payments/report` — 导出 PDF

### Payment Voucher（`/account/print_payment_voucher`）
- `GET  /download_payment_voucher/{id}`、`GET /share_payment_voucher/{id}`
- `GET  /public/{token}`、`POST /public/{token}/sign`、`GET /public/{token}/download`
  —— 这三条**凭 token 免登录**，是设计（要发给供应商签收）。

## 权限

三个权限名是分开的，别合并（legacy 的 `account` / `account_submit` 已不再使用）：

| 权限 | 能做什么 |
| --- | --- |
| `account_submit_claim` | 提交报销、AI 读单 |
| `account_read` | 查看**全部**报销单、收款列表、导出报表 |
| `account_edit` | 审批 / 编辑 / 删除报销，改收款状态，新建手动收款 |

列表接口（`require_claim_list_permission`）三者任一即可；只有 `account_submit_claim`
的人在 `list_claims_for_user` 里被过滤成「只看自己提交的」。

## 收款 id 的命名空间

`/payments` 把四路来源聚合成一张表，靠 id 偏移量区分，`update_finance_payment_status`
按**从大到小**的顺序分发：

| 偏移量 | 来源 | 表 |
| --- | --- | --- |
| `3_000_000_000` | 手动收款 | `ManualIncome` |
| `2_000_000_000` | 销售出库/退回 | `AssetStockDocument` |
| `1_000_000_000` | 法会 YLP / Lamp | `FahuiPayment` |
| （无偏移） | 报名 form / membership / youth_class | `RegisPayment` |

## ⚠️ 迁移期未清的账

1. **`POST /payments/{id}/status` 对 form / membership / youth_class 三个 scope 现在是坏的。**
   它转发到还没搬的 `app/form/services.py`、`app/user_control/membership.py`，
   那两个模块的函数体里真的在调 `flask.jsonify()` —— FastAPI 进程里没有 Flask 应用
   上下文，会抛 RuntimeError。manual / sales / fahui 三个 scope 正常。
   **这不是本次搬迁改坏的**，是跨模块依赖；等那两个模块搬完，把两处 import 换掉即可。
2. **法会那两处懒 import 会在运行时把 flask 拉进进程**
   （`normalize_fahui_payment_status` 在 `/payments` 列表的必经之路上）。
   函数本身不碰 flask，只是所在模块顶上 import 了它。与
   `api/public_api/router.py` 里那处法会 import 是同一笔账，等 `app/fahui` 搬完自然干净。
3. `delete_manual_finance_payment` 对「不带偏移量的小 id」也会照删（见 service.py ★④），
   原行为，本次不修。

## 与 Flask 的已知行为差异

- body 不是合法 JSON 时：Flask `get_json(silent=True)` 当 `{}` 继续走 → 业务 400；
  FastAPI 直接 422。都是失败，文案不同。
- multipart 的**非文件**字段单条上限 16 MB（starlette 的机制，Flask 没有这个概念）。
  文件部分不受限，仍由 nginx 的 `client_max_body_size` 管。
- Payment Voucher 的 `share_url` 和签名成功后的 `download_url` 改走
  `core.urls.absolute_url()` / `public_url()`：去掉了已不存在的 `/api` 段，
  并补上 BASE_PATH（旧值在 `/UTBA_DEMO` 下点开是 404）。
