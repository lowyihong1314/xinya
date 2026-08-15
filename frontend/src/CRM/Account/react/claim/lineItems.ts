// 报销单「用途明细（line item）」的共享类型与工具：
// 整单金额恒等于各行小计之和，所以新建 / 批量 / 详情编辑三处都走这里，避免各写一套。
import type { ClaimLineItem, ReadBillData, ReadBillReceiptItem } from "./types";

export type LineItemDraft = {
  // 前端本地 key，仅用于 React list，不发给后端
  key: string;
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
  category: string;
};

let draftSeq = 0;

export function makeLineItemDraft(patch: Partial<LineItemDraft> = {}): LineItemDraft {
  draftSeq += 1;
  return {
    key: `line-${draftSeq}`,
    description: "",
    quantity: "",
    unit_price: "",
    amount: "",
    category: "",
    ...patch,
  };
}

export function emptyLineItems(): LineItemDraft[] {
  return [makeLineItemDraft()];
}

export function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyText(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "";
}

/** 数量 × 单价 → 小计（两者都填才算，否则保持用户手填的金额）。 */
export function autoLineAmount(line: LineItemDraft): string {
  const quantity = String(line.quantity || "").trim();
  const unitPrice = String(line.unit_price || "").trim();
  if (!quantity || !unitPrice) return line.amount;
  return moneyText(toNumber(quantity) * toNumber(unitPrice));
}

export function lineItemsTotal(lines: LineItemDraft[]): number {
  return Math.round(lines.reduce((total, line) => total + toNumber(line.amount), 0) * 100) / 100;
}

export function hasFilledLine(lines: LineItemDraft[]): boolean {
  return lines.some((line) => line.description.trim() && toNumber(line.amount) !== 0);
}

/** 校验：至少一行有说明 + 金额，合计要大于 0。返回错误文案或 null。 */
export function validateLineItems(lines: LineItemDraft[]): string | null {
  const filled = lines.filter((line) => line.description.trim() || String(line.amount).trim());
  if (!filled.length) return "请至少填写一行用途明细";
  const missingDescription = filled.find((line) => !line.description.trim());
  if (missingDescription) return "用途明细里有金额但缺项目说明";
  const missingAmount = filled.find((line) => !String(line.amount).trim());
  if (missingAmount) return "用途明细里有项目但缺金额";
  if (lineItemsTotal(filled) <= 0) return "明细合计金额必须大于 0";
  return null;
}

/** 组成提交给后端的数组（丢掉空白草稿行与本地 key）。 */
export function serializeLineItems(lines: LineItemDraft[]) {
  return lines
    .filter((line) => line.description.trim() || String(line.amount).trim())
    .map((line) => ({
      description: line.description.trim(),
      category: line.category.trim() || null,
      quantity: String(line.quantity).trim() ? toNumber(line.quantity) : null,
      unit_price: String(line.unit_price).trim() ? toNumber(line.unit_price) : null,
      amount: toNumber(line.amount),
    }));
}

/** 明细摘要（列表 / 搜索 / 导出用）：「咖啡 RM 11.00 · 纸巾 RM 4.25」 */
export function summarizeLineItems(items?: ClaimLineItem[] | null): string {
  return (items || [])
    .map((item) => `${item.description} RM ${Number(item.amount || 0).toFixed(2)}`)
    .join(" · ");
}

/** 后端返回的明细 → 编辑用草稿。 */
export function lineItemsToDrafts(items?: ClaimLineItem[] | null): LineItemDraft[] {
  if (!items?.length) return emptyLineItems();
  return items.map((item) =>
    makeLineItemDraft({
      description: item.description || "",
      quantity: item.quantity == null ? "" : String(item.quantity),
      unit_price: item.unit_price == null ? "" : String(item.unit_price),
      amount: item.amount == null ? "" : moneyText(Number(item.amount)),
      category: item.category || "",
    }),
  );
}

function readItemText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function readItemMoney(value: unknown): string {
  const text = readItemText(value).replace(/[^\d.-]/g, "");
  if (!text) return "";
  const parsed = Number(text);
  return Number.isFinite(parsed) ? moneyText(parsed) : "";
}

/**
 * AI 读单结果 → 明细草稿。
 * 收据逐项都在时优先用逐项；逐项合计和收据总额对不上（税/服务费/看漏行）就退回单行总额，
 * 免得提交金额少收一截。
 */
export function readBillToLineItems(data: ReadBillData): LineItemDraft[] {
  const receiptItems: ReadBillReceiptItem[] = data.receiptItems || data.receipt_items || [];
  const total = Number(readItemMoney(data.totalAmount || data.total_amount) || 0);

  const drafts = receiptItems
    .map((item) => {
      const description = readItemText(item.description);
      const amount = readItemMoney(item.lineTotal || item.line_total);
      if (!description && !amount) return null;
      const quantity = readItemText(item.quantity).replace(/[^\d.]/g, "");
      const category = readItemText(item.expenseCategory || item.expense_category);
      return makeLineItemDraft({
        description: description || "未命名项目",
        quantity,
        unit_price:
          quantity && amount && toNumber(quantity) > 0
            ? moneyText(toNumber(amount) / toNumber(quantity))
            : "",
        amount,
        category: category && category !== "OTHER" ? category : "",
      });
    })
    .filter((item): item is LineItemDraft => Boolean(item));

  if (drafts.length) {
    const sum = lineItemsTotal(drafts);
    if (!total || Math.abs(sum - total) < 0.05) return drafts;
    // 差额补一行，保证合计 = 收据总额，同时保留逐项信息
    const gap = Math.round((total - sum) * 100) / 100;
    return [
      ...drafts,
      makeLineItemDraft({ description: "其他 / 税费差额（AI 自动补足）", amount: moneyText(gap) }),
    ];
  }

  if (!total) return [];
  const fallbackDescription =
    readItemText(data.description) ||
    readItemText(data.merchantName || data.merchant_name) ||
    "收据消费";
  return [makeLineItemDraft({ description: fallbackDescription, amount: moneyText(total) })];
}
