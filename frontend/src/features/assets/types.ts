/**
 * 资产 / 库存。后端 backend/api/asset/（挂载前缀 /asset）。
 *
 * ★ **形状来自后端代码，未实测。** /asset/* 每条路由函数体的第一行都是
 *   `require_asset_*_permission()`，`node scripts/api-shape.mjs /asset/dashboard`
 *   只能拿到 401 的错误信封。所以下面每个键都是逐字抄自
 *   backend/api/asset/serializers.py 里那六个 `serialize_*` 函数的字面量 ——
 *   动后端序列化器的人要同步动这里。
 *
 * 数据是三层：**item（物品）→ sub_item（尺码/颜色，库存的最小单位）→ inventory
 * （某个仓库里某个 sub_item 的数量）**。数量只能由「单据确认」时产生的流水改动，
 * 没有任何一条接口能直接写 `inventory.quantity`（threshold 那条改的是预警线）。
 */

/** 单据类型。后端 `service.DOCUMENT_TYPES` 的七个值，多一个就是 400「document_type 不合法」。 */
export type DocumentType =
  | "purchase_in"
  | "manual_in"
  | "issue_out"
  | "transfer"
  | "sale_out"
  | "sale_return"
  | "adjust";

/**
 * 单据状态。后端是自由字符串列（不是数据库枚举），但只有这三个值会被写进去：
 * 建单 → draft，confirm → confirmed，cancel → cancelled。**没有回到 draft 的路**。
 */
export type DocumentStatus = "draft" | "confirmed" | "cancelled";

/**
 * 流水类型。入库/出库单直接用 document_type 当流水类型，只有这三个是单据类型里没有的：
 * 调拨拆成 transfer_out + transfer_in 两条，作废回滚记 cancel。
 */
export type MovementType = DocumentType | "transfer_in" | "transfer_out" | "cancel";

export type PartnerType = "supplier" | "customer" | "both";

/**
 * 销售单据推送到「收款审核」之后的收款状态（后端 account/service.py 的
 * `_FINANCE_PAYMENT_STATUSES`）。**null = 还没推送**，资产这边只负责推送那一步，
 * 后面的 checked / fail 是收款审核页面改的。
 */
export type FinancePaymentStatus = "process" | "checked" | "fail";

export interface AssetWarehouse {
  id: number;
  name: string;
  code: string;
  location: string | null;
  remark: string | null;
  manager_user_id: number | null;
  manager_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AssetPartner {
  id: number;
  name: string;
  code: string;
  partner_type: PartnerType;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  /** 自由字符串，后端只在不填时补 "active"，没有枚举约束。 */
  status: string;
  remark: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AssetSubItem {
  id: number;
  item_id: number;
  item_name: string | null;
  name: string;
  sku: string | null;
  size: string | null;
  color: string | null;
  barcode: string | null;
  status: string;
  remark: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AssetItem {
  id: number;
  name: string;
  code: string;
  category: string | null;
  unit: string | null;
  status: string;
  remark: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** 后端按 (size, name, id) 在 Python 侧排好序才发出来，前端不要再排。 */
  sub_items: AssetSubItem[];
}

export interface AssetInventoryRow {
  id: number;
  warehouse_id: number;
  warehouse_name: string | null;
  warehouse_code: string | null;
  sub_item_id: number;
  sub_item_name: string | null;
  size: string | null;
  color: string | null;
  item_id: number | null;
  item_name: string | null;
  item_code: string | null;
  quantity: number;
  reserved_quantity: number;
  /** = max(quantity - reserved_quantity, 0)，后端算好的，**不会出负数**。 */
  available_quantity: number;
  /** 预警线。这是库存页唯一能直接改的数字（PATCH .../threshold）。 */
  min_quantity: number;
  updated_at: string | null;
}

export interface AssetStockDocumentLine {
  id: number;
  document_id: number;
  sub_item_id: number;
  sub_item_name: string | null;
  item_name: string | null;
  size: string | null;
  quantity: number;
  /** Numeric(10,2) 经 `_to_float` 出来，是 number 不是字符串；没填就是 null。 */
  unit_cost: number | null;
  unit_price: number | null;
  line_amount: number | null;
  remark: string | null;
}

export interface AssetStockMovement {
  id: number;
  document_id: number;
  document_line_id: number | null;
  warehouse_id: number;
  warehouse_name: string | null;
  sub_item_id: number;
  sub_item_name: string | null;
  item_name: string | null;
  movement_type: MovementType;
  /** 带符号：出库/调拨出是负数，入库/调拨入是正数，作废回滚是原流水的相反数。 */
  quantity_delta: number;
  quantity_before: number;
  quantity_after: number;
  taken_by_user_id: number | null;
  taken_by_name: string | null;
  destination_text: string | null;
  invoice_no: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string | null;
}

export interface AssetStockDocument {
  id: number;
  /** `AST-{YYYYMMDDHHMMSS}-{6位}`，后端生成，前端不填也改不了。 */
  document_no: string;
  document_type: DocumentType;
  status: DocumentStatus;
  source_warehouse_id: number | null;
  source_warehouse_name: string | null;
  target_warehouse_id: number | null;
  target_warehouse_name: string | null;
  requester_user_id: number | null;
  requester_name: string | null;
  handler_user_id: number | null;
  handler_name: string | null;
  taken_by_user_id: number | null;
  /** ★ 先取单据上**冗余存的那一份**，再回退到关联用户的名字 —— 关联用户改名后，
   *  历史单据显示的仍然是「当时那个名字」。所以它可能和 taken_by_user_id 对不上。 */
  taken_by_name: string | null;
  /** 去向大类，由单据类型推出来（见 format.ts 的 `resolveDestinationType`），不是用户填的。 */
  destination_type: string | null;
  destination_text: string | null;
  counterparty_id: number | null;
  counterparty_code: string | null;
  counterparty_type: PartnerType | null;
  /** 同 taken_by_name：冗余存的名字优先，往来单位改名不影响历史单据。 */
  counterparty_name: string | null;
  event_id: number | null;
  event_name: string | null;
  invoice_no: string | null;
  invoice_type: string | null;
  /** DATA_ROOT 下的**相对路径**（`NAS/UTBA/asset_invoice/…`）。空串会被后端擦成 null，
   *  所以 `if (doc.invoice_file_path)` 判「有没有发票文件」是准的。 */
  invoice_file_path: string | null;
  /** 上面那个的 basename，路径为空时同样是 null。 */
  invoice_file_name: string | null;
  /** 目前只可能是 "reimbursement_request"（关联报销单）或 null。 */
  reference_type: string | null;
  reference_id: number | null;
  finance_payment_status: FinancePaymentStatus | null;
  note: string | null;
  created_by: number | null;
  created_by_name: string | null;
  approved_by: number | null;
  approved_by_name: string | null;
  confirmed_at: string | null;
  created_at: string | null;
  updated_at: string | null;

  /**
   * ★ lines / movements **两个键在下面这些接口里一定存在**，但内容取决于接口：
   *    · /asset/stock-documents  → lines 有值，movements 是 **[]**
   *    · /asset/movements        → movements 有值，lines 是 **[]**
   *    · /asset/dashboard 和所有写操作的返回 → 两个都有值
   *   （只有 `include_children=False` 时这两个键会整个消失，而本模块没有一条接口这么调。）
   *   所以「空数组」既可能是真没有、也可能是这条接口不给 —— 别拿 length 去判断业务。
   */
  lines: AssetStockDocumentLine[];
  movements: AssetStockMovement[];
}

/** 看板上那一排数字。后端算好的，不要在前端重算（重算会和后端的口径漂移）。 */
export interface AssetMetrics {
  warehouse_count: number;
  item_count: number;
  sub_item_count: number;
  /** 全部仓库、全部 sub_item 的 quantity 总和。 */
  inventory_unit_count: number;
  draft_document_count: number;
}

export interface AssetDashboardPayload {
  metrics: AssetMetrics;
  warehouses: AssetWarehouse[];
  partners: AssetPartner[];
  items: AssetItem[];
  inventory: AssetInventoryRow[];
  /** 最近 30 张，带 lines 和 movements。**后端写死 limit=30，没有翻页**。 */
  documents: AssetStockDocument[];
}

export type AssetMasterDataPayload = Pick<AssetDashboardPayload, "warehouses" | "partners" | "items">;
export type AssetInventoryPayload = Pick<AssetDashboardPayload, "warehouses" | "inventory">;
/** 单据列表。items 是给「建单选 sub_item」用的，所以列表接口顺带给了。 */
export type AssetDocumentsPayload = Pick<AssetDashboardPayload, "warehouses" | "items" | "documents">;
export type AssetMovementsPayload = Pick<AssetDashboardPayload, "documents">;
