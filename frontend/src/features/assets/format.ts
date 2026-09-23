/**
 * 资产模块的显示文案与数字格式。**只有本模块在用** —— 第二个模块要用的时候再提到
 * shared/lib，现在提前抽会变成「shared 里躺着一堆只有一处调用的函数」。
 *
 * ★ 下面这些中文标签是**沿用旧资产页面的原词**（旧前端 AssetWorkspace.tsx）。
 *   同一个 document_type 在新旧两套界面里必须是同一个词：单据是长期资料，
 *   用户会拿着纸质单子和屏幕对，改词等于让历史单据的叫法对不上。
 */
import type { DocumentStatus, DocumentType, MovementType, PartnerType } from "./types";

// --------------------------------------------------------------------------- //
// 单据类型
// --------------------------------------------------------------------------- //

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  purchase_in: "采购入库",
  manual_in: "手动入库",
  issue_out: "内部领用",
  transfer: "仓库调拨",
  sale_out: "卖出",
  sale_return: "销售退回",
  adjust: "盘点调整",
};

/**
 * 建单时能选的类型。
 *
 * ★ **卖出 / 销售退回不在里面，这是业务规则不是漏写**：销售单据由销售收入那边开，
 *   它们要走收款审核。在这里能开销售单的话，会出现一批财务侧不认识的单据。
 *   （旧页面也是这么限的，原话是「销售与退回请改走销售收入」。）
 *   已经存在的销售单据仍然可以在这里改 —— 见表单里的 fallback 选项。
 */
export const CREATABLE_DOCUMENT_TYPES: readonly DocumentType[] = [
  "purchase_in",
  "manual_in",
  "issue_out",
  "transfer",
  "adjust",
];

/** 后端 `INBOUND_DOCUMENT_TYPES`：这几种必须选**目标**仓库。 */
const INBOUND: readonly DocumentType[] = ["purchase_in", "manual_in", "sale_return"];
/** 后端 `OUTBOUND_DOCUMENT_TYPES`：这几种必须选**来源**仓库。 */
const OUTBOUND: readonly DocumentType[] = ["issue_out", "sale_out"];

/** 要不要填来源仓库。调拨两边都要；盘点调整用的是「来源」这一栏当仓库。 */
export function needsSourceWarehouse(documentType: DocumentType): boolean {
  return documentType === "transfer" || documentType === "adjust" || OUTBOUND.includes(documentType);
}

export function needsTargetWarehouse(documentType: DocumentType): boolean {
  return documentType === "transfer" || INBOUND.includes(documentType);
}

/** 来源仓库那一栏在盘点调整里叫「盘点仓库」，叫「来源仓库」会让人以为要出库。 */
export function sourceWarehouseLabel(documentType: DocumentType): string {
  return documentType === "adjust" ? "盘点仓库" : "来源仓库";
}

/**
 * 去向大类。**不是用户填的**，按单据类型推出来 —— 旧页面就是这么写的，
 * 后端只是把它原样存下来（自由字符串列，没有校验）。
 */
export function resolveDestinationType(documentType: DocumentType): string {
  if (documentType === "purchase_in") return "supplier";
  if (documentType === "sale_out") return "customer";
  if (documentType === "sale_return") return "customer_return";
  if (documentType === "transfer") return "warehouse";
  if (documentType === "issue_out") return "person";
  return "other";
}

/** 只有这三种单据后端才保留 invoice_no / reference_*，其余类型传了也会被清掉。 */
export function keepsInvoiceFields(documentType: DocumentType): boolean {
  return documentType === "purchase_in" || documentType === "sale_out" || documentType === "sale_return";
}

/** 关联报销单只对采购入库有意义（旧页面同此）。 */
export function canLinkReimbursement(documentType: DocumentType): boolean {
  return documentType === "purchase_in";
}

// --------------------------------------------------------------------------- //
// 单据状态 / 流水
// --------------------------------------------------------------------------- //

export const DOCUMENT_STATUS_META: Record<
  DocumentStatus,
  { text: string; variant: "neutral" | "warning" | "success" }
> = {
  // 草稿还没动过库存，用提醒色表示「这件事还没做完」
  draft: { text: "草稿", variant: "warning" },
  confirmed: { text: "已确认", variant: "success" },
  // 作废是终态，不是错误，所以用中性色而不是红色
  cancelled: { text: "已作废", variant: "neutral" },
};

export const FINANCE_PAYMENT_LABELS: Record<string, string> = {
  process: "待收款审核",
  checked: "收款已核对",
  fail: "收款未通过",
};

/**
 * 流水类型的中文。
 *
 * 调拨和盘点要看符号才说得清是哪一头：调拨拆成两条流水（出 -N / 入 +N），
 * 盘点调整一条流水可正可负（盘盈 / 盘亏）。所以这里要同时看 movement_type、
 * 单据类型和数量符号，只看一个字段会把「盘亏」显示成「盘点调整」。
 */
export function movementTypeLabel(
  movementType: MovementType,
  documentType: DocumentType,
  quantityDelta: number,
): string {
  if (movementType === "cancel") return "作废回滚";
  if (movementType === "transfer_in") return "调拨入库";
  if (movementType === "transfer_out") return "调拨出库";
  if (documentType === "transfer") return quantityDelta >= 0 ? "调拨入库" : "调拨出库";
  if (documentType === "adjust") return quantityDelta >= 0 ? "盘盈调整" : "盘亏调整";
  return DOCUMENT_TYPE_LABELS[documentType] ?? documentType;
}

// --------------------------------------------------------------------------- //
// 往来单位
// --------------------------------------------------------------------------- //

export const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  supplier: "供应商",
  customer: "客户",
  both: "供应商 + 客户",
};

export const PARTNER_TYPE_OPTIONS: readonly PartnerType[] = ["supplier", "customer", "both"];

/**
 * 某种单据该配哪种往来单位。采购只配供应商、销售只配客户，both 两边都算。
 * 后端**不校验这件事**，所以这只是帮用户少选错，不是硬约束。
 */
export function allowedPartnerTypes(documentType: DocumentType): readonly PartnerType[] {
  if (documentType === "purchase_in") return ["supplier", "both"];
  if (documentType === "sale_out" || documentType === "sale_return") return ["customer", "both"];
  return PARTNER_TYPE_OPTIONS;
}

/** 往来单位/物品的 status 只有「是不是 active」两种含义，别的值一律按停用处理。 */
export function isActive(status: string | null | undefined): boolean {
  return status === "active";
}

// --------------------------------------------------------------------------- //
// 数字与日期
// --------------------------------------------------------------------------- //

const MONEY = new Intl.NumberFormat("en-MY", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * 金额。固定两位小数 + 千分位，不带货币符号。
 * 用它的地方一律配 `text-right font-mono tabular-nums` —— 单据金额要能竖着对齐才好核。
 */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return MONEY.format(value);
}

/** 带符号的数量（流水用）。正数要显式带 +，否则 12 和 -12 扫一眼分不出是进是出。 */
export function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * 时间戳。后端存的是 `datetime.utcnow()` 的**裸时间**（没有时区标记），
 * 交给 `new Date()` 会被当成本地时间，差 8 小时还看不出来。
 * 所以这里只按字符串裁剪，不做任何时区换算 —— 要修得后端先带上时区。
 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 16).replace("T", " ");
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

/** 子物品的一行说明：「名字 · size M · 藏青」。空字段自动跳过。 */
export function subItemLabel(sub: { name: string; size?: string | null; color?: string | null }): string {
  const parts = [sub.name];
  if (sub.size) parts.push(`size ${sub.size}`);
  if (sub.color) parts.push(sub.color);
  return parts.join(" · ");
}

/**
 * 一张单据的金额合计 = 各行 line_amount 之和。
 *
 * 明细行的 line_amount 允许为 null（没填单价也没填金额的内部领用就是这样），
 * **整单一行都没有金额时返回 null**，让调用方显示 "—" 而不是骗人的 0.00。
 */
export function documentTotal(lines: ReadonlyArray<{ line_amount: number | null }>): number | null {
  let sum = 0;
  let seen = false;
  for (const line of lines) {
    if (line.line_amount === null) continue;
    sum += line.line_amount;
    seen = true;
  }
  if (!seen) return null;
  return Math.round(sum * 100) / 100;
}
