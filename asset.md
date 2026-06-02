# 资产管理模块需求草案

我查看了当前项目数据库后，确认这套系统目前主要集中在以下几类数据：

- 用户 / 会员：`user_data`、`nric_asset`、`membership_registration`
- 报名 / 表单：`regis_form`、`regis_member_data`、`regis_payment`、`youth_class_registration`
- 活动 / 文件：`event_data`、`event_file`、`files`
- 法会订单：`orders`、`order_items`、`item_form_data`
- 财务报销：`reimbursement_request`、`reimbursement_attachment`

当前数据库里还没有真正独立的“资产管理 / 仓库管理 / 库存管理”模块。

需要特别说明：

- `nric_asset` 这个表虽然名字里有 `asset`，但它其实是会员身份资料，不是资产库存。
- `orders`、`order_items`、`item_form_data` 这些表是法会订单专用结构，不适合直接拿来做通用资产和仓库库存。

所以我想新增一套独立的资产管理模块，用来支持：

- 资产管理
- 多仓库管理
- item 管理
- 子 item 管理
- 按仓库记录库存
- 按 size 记录衣服库存
- 库存流动单据管理
- 记录谁拿、拿去哪里、是否卖出、对应 invoice

## 我想要的业务效果

我希望系统可以支持这样的场景：

- 我有 3 个仓库
- 我在仓库里存放衣服这类资产
- 一个 item 可以有多个子 item
- 子 item 可以表示 size，像 `S / M / L / XL`
- 库存不是只记录“衣服总数”，而是要记录“某个仓库里，某个 size 还有多少件”

例如：

- 1 号仓库：衣服 `S` 码 20 件，`M` 码 35 件，`L` 码 18 件
- 2 号仓库：衣服 `S` 码 8 件，`M` 码 15 件，`L` 码 10 件
- 3 号仓库：衣服 `S` 码 0 件，`M` 码 6 件，`XL` 码 12 件

这代表库存维度应该是：

`仓库 + 子 item(size)`。

而不是只做：

`item + 总库存`

不然以后就没办法知道每个仓库、每个尺码分别剩多少。

## 建议新增的数据表

为了和当前数据库分层清楚，我建议新增独立表，而不是复用现有订单表。

### 1. `asset_warehouse`

用于管理仓库。

建议字段：

- `id`
- `name`：仓库名称
- `code`：仓库编号
- `location`：仓库地点
- `manager_user_id`：负责人
- `remark`
- `created_at`
- `updated_at`

示例数据：

- `WH-A / 1号仓库`
- `WH-B / 2号仓库`
- `WH-C / 3号仓库`

### 2. `asset_item`

用于管理主 item，也就是资产主档。

建议字段：

- `id`
- `name`：名称，例如“UTBA 衣服”
- `code`：item 编码
- `category`：分类，例如“衣服 / 法物流通 / 设备”
- `unit`：单位，例如“件”
- `status`
- `remark`
- `created_at`
- `updated_at`

这里的 `item` 是父层。

例如：

- `UTBA 衣服`

### 3. `asset_partner`

用于管理供应商、客户这类往来对象主档。

建议字段：

- `id`
- `name`
- `code`
- `partner_type`：`supplier / customer / both`
- `contact_person`
- `phone`
- `address`
- `status`
- `remark`
- `created_at`
- `updated_at`

这样采购入库、卖出、销售退回时，就不必每次手写对象名称，可以直接选主档。

### 4. `asset_sub_item`

用于管理子 item，也可以理解为规格、变体、子型号。

建议字段：

- `id`
- `item_id`
- `name`：子项名称，例如“衣服-S”
- `sku`
- `size`：例如 `S / M / L / XL`
- `color`：以后如果有颜色可以扩展
- `barcode`
- `status`
- `remark`
- `created_at`
- `updated_at`

这里的重点是：

- 一个 `asset_item` 可以对应多个 `asset_sub_item`
- 衣服的 size 最适合放在 `asset_sub_item`

例如：

- `UTBA 衣服 - S`
- `UTBA 衣服 - M`
- `UTBA 衣服 - L`
- `UTBA 衣服 - XL`

### 5. `asset_inventory`

用于记录每个仓库下，每个子 item 的当前库存。

建议字段：

- `id`
- `warehouse_id`
- `sub_item_id`
- `quantity`：当前库存
- `reserved_quantity`：预留库存，可先保留字段
- `min_quantity`：最低库存提醒
- `updated_at`

并建议加唯一约束：

- `UNIQUE(warehouse_id, sub_item_id)`

这样才能保证：

- 同一个仓库
- 同一个 size 的衣服
- 只有一条当前库存记录

这张表才是库存核心表。

### 6. `asset_stock_document`

用于记录一张库存流动单据，也就是“单头”。

我建议以后不管是：

- 入库
- 出库
- 内部领用
- 仓库调拨
- 卖出
- 退货
- 盘点调整

都先建立一张 `asset_stock_document`，这样系统才知道这次流动的业务背景。

建议字段：

- `id`
- `document_no`：单号
- `document_type`：`purchase_in / manual_in / issue_out / transfer / sale_out / sale_return / adjust`
- `status`：`draft / confirmed / cancelled`
- `source_warehouse_id`
- `target_warehouse_id`
- `requester_user_id`：申请人
- `handler_user_id`：经手人
- `taken_by_user_id`：谁拿走
- `taken_by_name`：如果不是系统用户，也能手填名字
- `destination_type`：`person / department / event / customer / warehouse / other`
- `destination_text`：拿去哪里，例如“佛堂活动区 / 供灯处 / 某客户地址”
- `counterparty_id`：关联 `asset_partner`
- `counterparty_name`：往来对象，例如客户名、供应商名
- `event_id`：如果是活动领用，可以挂 event
- `invoice_no`
- `invoice_type`
- `invoice_file_path`
- `note`
- `created_by`
- `approved_by`
- `confirmed_at`
- `created_at`
- `updated_at`

这张表就是回答这些问题的核心：

- 谁拿：`taken_by_user_id` / `taken_by_name`
- 拿去哪里：`destination_type` + `destination_text`
- 是不是卖了：`document_type = sale_out`
- 对应哪张 invoice：`invoice_no` / `invoice_file_path`

### 7. `asset_stock_document_line`

用于记录一张库存单据里的明细，也就是“单身”。

因为一张单据可能不只一项货。

例如一张卖出单里，可能同时卖：

- 衣服 `M` 码 3 件
- 衣服 `L` 码 2 件
- 袈裟 1 件

建议字段：

- `id`
- `document_id`
- `sub_item_id`
- `quantity`
- `unit_cost`
- `unit_price`
- `line_amount`
- `remark`

这样设计后：

- 单头记录业务原因、拿货人、目的地、invoice
- 单身记录每个具体 item / 子 item 的数量和金额

### 8. `asset_stock_movement`

用于记录真正影响库存的流水账。

我建议这张表不要让用户直接编辑，而是：

- 先建 `asset_stock_document`
- 单据确认后
- 系统自动生成 `asset_stock_movement`
- 同时更新 `asset_inventory`

建议字段：

- `id`
- `document_id`
- `document_line_id`
- `warehouse_id`
- `sub_item_id`
- `movement_type`：`in / out / transfer_in / transfer_out / adjust / sale_out / sale_return`
- `quantity_delta`：正数加库存，负数减库存
- `quantity_before`
- `quantity_after`
- `taken_by_user_id`
- `destination_text`
- `invoice_no`
- `created_by`
- `created_at`

这张表很重要，因为如果只有当前库存，没有流水，后面很难追查：

- 为什么数量变少
- 是谁拿走的
- 拿去哪里了
- 是内部领用、调仓，还是卖出了
- 对应哪张单据、哪张 invoice
- 是人工修正还是正常业务流动

### 9. `asset_invoice`（可选）

如果第一版只需要“记录卖了、留 invoice 编号和附件”，其实可以先不单独建 invoice 表，先把 invoice 信息放在 `asset_stock_document` 就够用了。

但如果以后要做：

- 正式销售单
- 多次付款
- 退款
- 打印 invoice
- 对账

那就建议再拆一张独立的 `asset_invoice`。

建议字段：

- `id`
- `invoice_no`
- `invoice_type`
- `customer_name`
- `customer_phone`
- `customer_address`
- `amount`
- `currency`
- `issued_at`
- `payment_status`
- `file_path`
- `note`

第一版我建议：

- 先不独立做 `asset_invoice`
- 先把 `invoice_no`、`invoice_file_path` 放在 `asset_stock_document`

这样开发量更小，但还是能满足“卖了以后要追 invoice”。

## 建议的数据关系

关系可以这样设计：

- 一个 `asset_item` 对应多个 `asset_sub_item`
- 一个 `asset_warehouse` 对应多个 `asset_inventory`
- 一个 `asset_sub_item` 对应多个 `asset_inventory`
- 一个 `asset_stock_document` 对应多个 `asset_stock_document_line`
- 一个 `asset_stock_document_line` 会生成一条或多条 `asset_stock_movement`
- 一个 `asset_sub_item` 会对应多个 `asset_stock_document_line`
- 一个 `asset_sub_item` 也会对应多个 `asset_stock_movement`

也就是说：

- `item` 管理“资产主档”
- `sub_item` 管理“具体规格”
- `inventory` 管理“仓库里的现存数量”
- `stock_document` 管理“这次库存流动为什么发生、谁拿、去哪、是不是卖出”
- `stock_document_line` 管理“这张单据里每个具体货品”
- `stock_movement` 管理“最终落库的流水结果”

## 库存流动我希望怎么记

这个模块里，我希望系统不要只记录“库存少了 5 件”，而是要能回答完整业务问题。

### 1. 内部领用

例如：

- 1号仓库拿出 `M` 码衣服 5 件
- 由某位师兄拿走
- 拿去活动现场使用

建议记录方式：

- `document_type = issue_out`
- `source_warehouse_id = 1号仓库`
- `taken_by_user_id = 某用户`
- `destination_type = event`
- `destination_text = 浴佛节活动现场`

### 2. 仓库调拨

例如：

- 从 1号仓库调 10 件 `L` 码衣服到 2号仓库

建议记录方式：

- `document_type = transfer`
- `source_warehouse_id = 1号仓库`
- `target_warehouse_id = 2号仓库`

系统应生成两条流水：

- 1号仓库 `transfer_out`
- 2号仓库 `transfer_in`

### 3. 卖出

例如：

- 从 2号仓库卖出 `S` 码衣服 3 件
- 买家是某客户
- 开了一张 invoice

建议记录方式：

- `document_type = sale_out`
- `source_warehouse_id = 2号仓库`
- `counterparty_name = 客户名字`
- `destination_type = customer`
- `destination_text = 客户自取 / 寄送地址`
- `invoice_no = INV-2026-001`

### 4. 盘点修正

例如：

- 系统显示 20 件
- 实际只剩 18 件

建议记录方式：

- `document_type = adjust`
- `note = 盘点差异修正`

这样以后看历史时，就知道不是卖了，也不是别人拿走，而是盘点纠正。

## 衣服库存示例

如果我有 3 个仓库，管理衣服库存，建议数据长这样：

### 仓库

- 1号仓库
- 2号仓库
- 3号仓库

### Item

- `UTBA 衣服`

### 子 Item

- `UTBA 衣服 - S`
- `UTBA 衣服 - M`
- `UTBA 衣服 - L`
- `UTBA 衣服 - XL`

### 库存表示例

| 仓库 | item | 子 item | size | 库存 |
| --- | --- | --- | --- | --- |
| 1号仓库 | UTBA 衣服 | UTBA 衣服 - S | S | 20 |
| 1号仓库 | UTBA 衣服 | UTBA 衣服 - M | M | 35 |
| 1号仓库 | UTBA 衣服 | UTBA 衣服 - L | L | 18 |
| 2号仓库 | UTBA 衣服 | UTBA 衣服 - S | S | 8 |
| 2号仓库 | UTBA 衣服 | UTBA 衣服 - M | M | 15 |
| 2号仓库 | UTBA 衣服 | UTBA 衣服 - L | L | 10 |
| 3号仓库 | UTBA 衣服 | UTBA 衣服 - M | M | 6 |
| 3号仓库 | UTBA 衣服 | UTBA 衣服 - XL | XL | 12 |

## 我希望系统后续支持的操作

基础上我希望后面可以做这些功能：

- 新增仓库
- 编辑仓库
- 新增 item
- 编辑 item
- 新增子 item
- 给子 item 设置 size
- 查看每个仓库的库存
- 查看某个 item 在全部仓库的库存汇总
- 入库
- 出库
- 内部领用
- 仓库之间调拨
- 记录谁拿
- 记录拿去哪里
- 记录客户 / 供应商 / 活动用途
- 卖出并记录 invoice 编号
- 上传 invoice 附件
- 盘点修正库存
- 查看每张库存单据
- 查看库存流水记录

## 是否接入现有 `app/account` 系统

我认为可以接入，而且很适合接入现有财务工作区。

但我建议是：

- 前端接入 `CRM / finance`
- 后端不要把全部资产逻辑直接塞进 `app/account`
- 更合适的做法是“资产模块独立，财务模块联动”

### 为什么说可以接入

当前项目里，`finance` 已经是 CRM 的一个正式模块，不只是单纯报销页面。

它现在已经包含：

- 报销申请
- 收款审核
- 报名收入
- 支出分析

所以从用户使用习惯来说，把“资产管理 / 库存管理”放进财务工作区是合理的。

### 我建议的接法

#### 1. 前端接到 `FinancePage`

前端可以在财务工作区新增一个 tab，例如：

- `asset`
- `inventory`
- `asset_stock`

这样用户仍然是在同一个 `CRM > 财务` 入口里工作，只是多一个“资产 / 库存”页签。

这个方式的好处是：

- 用户入口统一
- 财务、报销、库存放在一起比较顺
- 卖出、领用、采购、invoice 后续都比较容易串起来

#### 2. 后端独立成 `app/asset`

虽然前端适合放在财务模块里，但后端我不建议把资产 API 全部写进 `app/account/routes.py` 和 `app/account/services.py`。

原因是 `app/account` 当前重点还是：

- 报销申请
- 审批
- voucher
- 财务统计

如果把仓库、item、库存、调拨、卖出、invoice 全塞进去，后面会越来越难维护。

所以更合适的结构是：

- `app/account` 继续负责财务流程
- 新增 `app/asset`
- 资产自己的 `routes.py / services.py / serializers.py / permissions.py`

然后前端的 `FinancePage` 去调用 `app/asset` 的接口。

### 我建议的联动关系

#### 1. 采购入库联动报销

如果某次采购是通过报销单产生的，可以在 `asset_stock_document` 上挂：

- `reference_type = reimbursement_request`
- `reference_id = reimbursement_request.id`

这样以后看库存来源时，就知道这批货是从哪张报销单买回来的。

#### 2. 卖出联动 invoice

如果资产卖出，就在 `asset_stock_document` 上记录：

- `document_type = sale_out`
- `invoice_no`
- `invoice_file_path`

第一版可以先这样做。

以后如果发票逻辑变复杂，再拆独立 `asset_invoice` 表。

#### 3. 内部领用和调拨不一定进账

不是所有库存流动都要进入财务账。

例如：

- 内部领用
- 仓库调拨
- 盘点调整

这些动作更适合记录在资产系统里，不一定要直接变成 `app/account` 的报销或收入记录。

也就是说：

- 资产系统负责“货怎么流动”
- account 系统负责“钱怎么流动”

这两个系统有关联，但不应该混成同一套表。

### 权限建议

第一版有两种做法。

#### 方案 A：直接复用 account 权限

先复用现有权限：

- `account_submit_claim`
- `account_submit_income`
- `account_read`
- `account_edit`

优点：

- 开发快
- 不用马上改权限系统

缺点：

- 以后如果有人能看财务但不能管库存，就不够细

#### 方案 B：新增 asset 权限

后续更推荐单独加：

- `asset_read`
- `asset_edit`
- `asset_approve`（如果以后有审批）

这样就能把“财务权限”和“库存权限”拆开。

我比较建议：

- MVP 先复用 `account_*`
- 第二阶段再拆 `asset_*`

### 我建议的最终结构

- CRM 左侧入口仍然走 `finance`
- `FinancePage` 增加一个资产 tab
- 后端新增 `app/asset`
- `app/asset` 通过 `reference_type / reference_id` 或专用字段去关联 `reimbursement_request`、invoice、event

这样做的结果是：

- 用户看起来是在同一个财务系统里
- 开发结构上又不会把 `app/account` 弄得太臃肿
- 后续要做报销采购、销售 invoice、库存分析都能继续扩展

## MVP 建议

如果先做第一版，我建议最少先落地这 7 个部分：

1. `asset_warehouse`
2. `asset_item`
3. `asset_sub_item`
4. `asset_inventory`
5. `asset_stock_document`
6. `asset_stock_document_line`
7. `asset_stock_movement`

第一版先把“多仓库 + item + 子 item + size + 当前库存 + 单据 + 库存流水”做出来，就已经可以满足衣服库存管理，而且能回答：

- 谁拿了
- 拿去哪里
- 是内部领用还是卖出
- 对应哪张 invoice

后续如果要继续扩展，再考虑增加：

- 供应商
- 采购单
- 条码
- 图片
- 批次
- 成本价
- 预警通知

## 结论

基于当前数据库结构，我不建议把资产库存直接塞进现有 `orders`、`order_items`、`item_form_data` 或 `nric_asset`。

更合适的做法是新增一套独立的资产模块，核心思想是：

- 用 `warehouse` 管仓库
- 用 `item` 管主资产
- 用 `sub_item` 管 size / 规格
- 用 `inventory` 管每个仓库里的实时库存
- 用 `stock_document` 管库存流动单据
- 用 `stock_document_line` 管单据明细
- 用 `stock_movement` 管所有库存变化记录

这样未来不只是管理衣服，也可以继续扩展到：

- 法会用品
- 书籍
- 设备
- 其他可库存的物品
