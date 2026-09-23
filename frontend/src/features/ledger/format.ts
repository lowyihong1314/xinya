/**
 * 总账的显示文案与数字格式。**只有本模块在用** —— 第二个模块要用金额格式化时
 * 再提到 shared/lib，现在提前抽会变成「shared 里躺着一个只有一处调用的函数」。
 */
import type { AccountType } from "./types";

/**
 * 金额。固定两位小数 + 千分位。
 *
 * 会计表格里的数字要能**竖着对齐**才好核对，所以：
 *   · 位数固定（0 显示成 0.00，不是 0）
 *   · 用它的地方一律配 `text-right font-mono tabular-nums`
 * 不带货币符号：科目自己有 currency 字段，混币种时把符号写死会骗人。
 */
const MONEY = new Intl.NumberFormat("en-MY", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return MONEY.format(value);
}

/** 借贷表格里的 0 用短横显示：满屏 0.00 会盖住真正有数的那几行。 */
export function formatAmountCell(value: number): string {
  return value ? MONEY.format(value) : "—";
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

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: "资产",
  liability: "负债",
  equity: "权益",
  income: "收入",
  expense: "费用",
};

/** 下拉选项用，顺序是会计科目表的习惯顺序（资产→负债→权益→收入→费用）。 */
export const ACCOUNT_TYPE_OPTIONS: readonly AccountType[] = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
];

/** cash_kind 是自由字符串，后端没有枚举约束，所以认不出来的值原样显示。 */
export function cashKindLabel(kind: string | null): string {
  if (kind === "cash") return "现金";
  if (kind === "bank") return "银行";
  return kind || "—";
}

/** 科目状态只有「是不是 active」两种含义，别的值一律按停用处理（后端也这么判）。 */
export function isAccountActive(status: string): boolean {
  return status === "active";
}
