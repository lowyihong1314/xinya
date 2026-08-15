// AI 读单（read_bill）结果 → 报销表单字段的统一映射。
// 新建申请、批量申请两处都调这里，保证「AI 填出来的东西」在两边完全一致。
import { readBillToLineItems, type LineItemDraft } from "./lineItems";
import type { ReadBillData } from "./types";

export type ReadBillPatch = {
  request_date?: string;
  purchase_datetime?: string;
  purpose?: string;
  vendor_name?: string;
  vendor_address?: string;
  vendor_contact_number?: string;
  lineItems?: LineItemDraft[];
};

export type ReadBillFillResult = {
  patch: ReadBillPatch;
  /** 实际被填上的字段中文名，给用户看「AI 改了什么」 */
  filledLabels: string[];
  lineCount: number;
  total: number;
};

export function stringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function normalizeMoneyValue(value: unknown): string {
  const text = stringValue(value).replace(/[^\d.-]/g, "");
  if (!text) return "";
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "";
}

function toDateInputValue(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function normalizeReceiptDate(value: unknown): string {
  const rawValue = stringValue(value);
  if (!rawValue) return "";

  const isoMatch = rawValue.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  // 收据上常见 dd/mm/yyyy；数字 > 12 的那一位当日
  const dmyMatch = rawValue.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmyMatch) {
    const [, first, second, yyyy] = dmyMatch;
    const dd = Number(first) > 12 ? first : second;
    const mm = dd === first ? second : first;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? "" : toDateInputValue(parsed);
}

export function normalizeReceiptDateTime(value: unknown): string {
  const rawValue = stringValue(value);
  if (!rawValue) return "";

  const normalized = rawValue.replace(" ", "T");
  const match = normalized.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:T(\d{1,2}):(\d{2})(?::\d{2})?)?/);
  if (match) {
    const [, yyyy, mm, dd, hh = "00", min = "00"] = match;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T${hh.padStart(2, "0")}:${min}`;
  }

  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) return "";
  const dd = toDateInputValue(parsed);
  const hh = String(parsed.getHours()).padStart(2, "0");
  const min = String(parsed.getMinutes()).padStart(2, "0");
  return `${dd}T${hh}:${min}`;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return "";
}

function readVendorRecord(data: ReadBillData): Record<string, unknown> {
  const vendorData = (data.vendorData || data.vendor_data) as unknown;
  return vendorData && typeof vendorData === "object" ? (vendorData as Record<string, unknown>) : {};
}

export function buildVendorFieldsFromReadBill(data: ReadBillData) {
  const vendor = readVendorRecord(data);
  return {
    vendor_name: firstText(data.vendorName, data.vendor_name, data.merchantName, data.merchant_name, vendor.name),
    vendor_address: firstText(data.vendorAddress, data.vendor_address, data.merchantAddress, data.merchant_address, vendor.address),
    vendor_contact_number: firstText(
      data.vendorPhone,
      data.vendor_phone,
      data.contactNumber,
      data.contact_number,
      data.merchantPhone,
      data.merchant_phone,
      vendor.phone,
    ),
  };
}

/**
 * 用途说明（说明性文字）。逐项内容已经进明细表，这里只留商家 / 收据号 / 分类 / AI 说明，
 * 也就是旧 ref1、ref2 合并后的位置。
 */
export function buildPurposeFromReadBill(data: ReadBillData): string {
  const merchantName = firstText(data.merchantName, data.merchant_name);
  const receiptNumber = firstText(data.receiptNumber, data.receipt_number);
  const expenseCategory = firstText(data.expenseCategory, data.expense_category);
  const description = stringValue(data.description);

  return [
    merchantName ? `商家：${merchantName}` : "",
    receiptNumber ? `收据号：${receiptNumber}` : "",
    expenseCategory && expenseCategory !== "OTHER" ? `分类：${expenseCategory}` : "",
    description ? `说明：${description}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildReadBillFill(data: ReadBillData): ReadBillFillResult {
  const patch: ReadBillPatch = {};
  const filledLabels: string[] = [];

  const lineItems = readBillToLineItems(data);
  if (lineItems.length) {
    patch.lineItems = lineItems;
    filledLabels.push(`用途明细 ${lineItems.length} 行`);
  }

  const requestDate = normalizeReceiptDate(
    data.receiptDate || data.receipt_date || data.purchaseDate || data.purchase_date,
  );
  if (requestDate) {
    patch.request_date = requestDate;
    filledLabels.push("日期");
  }

  const purchaseDateTime = normalizeReceiptDateTime(
    data.purchaseDateTime ||
      data.purchaseDatetime ||
      data.purchase_datetime ||
      data.receiptDateTime ||
      data.receipt_date_time ||
      data.receiptDate ||
      data.receipt_date,
  );
  if (purchaseDateTime) {
    patch.purchase_datetime = purchaseDateTime;
    filledLabels.push("采购日期");
  }

  const purpose = buildPurposeFromReadBill(data);
  if (purpose) {
    patch.purpose = purpose;
    filledLabels.push("用途说明");
  }

  const vendorFields = buildVendorFieldsFromReadBill(data);
  if (vendorFields.vendor_name) {
    patch.vendor_name = vendorFields.vendor_name;
    filledLabels.push("商家名称");
  }
  if (vendorFields.vendor_address) {
    patch.vendor_address = vendorFields.vendor_address;
    filledLabels.push("商家地址");
  }
  if (vendorFields.vendor_contact_number) {
    patch.vendor_contact_number = vendorFields.vendor_contact_number;
    filledLabels.push("商家联络号码");
  }

  const total = Number(normalizeMoneyValue(data.totalAmount || data.total_amount) || 0);

  return { patch, filledLabels, lineCount: lineItems.length, total };
}

export function formatConfidence(value: unknown): string {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "";
  const percent = number <= 1 ? number * 100 : number;
  return `${Math.round(percent)}%`;
}

export function confidencePercent(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  const percent = number <= 1 ? number * 100 : number;
  return Math.max(0, Math.min(100, Math.round(percent)));
}
