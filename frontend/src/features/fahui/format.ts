/**
 * 法会模块的显示文案与格式化。**只有本模块在用**。
 *
 * ★ 这里全是**展示**用的换算，不是校验文案。所有错误提示一律用后端返回的
 *   中文原文（ApiError.message），本文件不参与。
 */
import type { BoardStatus, OrderPaymentStatus, PaymentRecordStatus } from "./types";

const MONEY = new Intl.NumberFormat("en-MY", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 金额。固定两位小数 + 千分位，配 `text-right font-mono tabular-nums` 竖着对齐。 */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return MONEY.format(value);
}

/**
 * 订单的 created_at。
 * ★ 后端给的是 `"%y-%m-%d_%H:%M"` —— **两位年份 + 下划线**，例如 "26-09-23_14:05"。
 *   既不是 ISO 也不是 "YYYY-MM-DD HH:MM:SS"，交给 new Date() 会得到 Invalid Date。
 *   所以这里只把下划线换成空格，不做任何解析。
 */
export function formatOrderTime(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace("_", " ");
}

/**
 * 付款记录的时间戳（ISO）与日志的时间戳（"YYYY-MM-DD HH:MM:SS"）。
 * 两种都是**裸时间**（后端 utcnow() 不带时区），交给 new Date() 会被当本地时间
 * 差 8 小时还看不出来，所以同样只按字符串裁剪，不做时区换算。
 */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 16).replace("T", " ");
}

/** 软删除桶：删单 = 把 version 改成 "DELETE"，不是一届法会。 */
export const DELETED_VERSION = "DELETE";

export function versionLabel(version: string): string {
  return version === DELETED_VERSION ? "已删除的单" : version;
}

/** 默认选中的版本：最新的一届真实法会（版本清单是倒序的，"DELETE" 排在最前面）。 */
export function defaultVersion(versions: readonly string[] | undefined): string {
  if (!versions?.length) return "";
  return versions.find((v) => v !== DELETED_VERSION) ?? versions[0] ?? "";
}

/** 订单的付款汇总。四个值来自 shared.order_payment_state。 */
export const ORDER_PAYMENT_LABELS: Record<OrderPaymentStatus, string> = {
  none: "未付款",
  pending: "待审核",
  paid: "已付款",
  rejected: "已拒绝",
};

/** 单条付款记录的审核状态。文案照抄后端 payment_review.PAYMENT_STATUS_LABELS。 */
export const PAYMENT_STATUS_LABELS: Record<PaymentRecordStatus, string> = {
  pending: "待审核",
  approved: "已批准",
  rejected: "已拒绝/撤回",
};

/** 牌位打印 / 上板进度。 */
export const BOARD_STATUS_LABELS: Record<BoardStatus, string> = {
  empty: "无牌位",
  unprinted: "未打印",
  none: "未上板",
  partial: "部分上板",
  all: "已上板",
};

/**
 * 牌位表单字段 → 中文名。**镜像**后端 ylp/order_log.py 的 FIELD_LABELS，
 * 认不出来的键原样显示（后端也是这么兜的），所以后端加字段这里不会崩。
 */
const FIELD_LABELS: Record<string, string> = {
  owner: "阳上",
  deceased: "对象",
  relation: "关系",
  surname: "姓氏",
  suffix: "后缀",
  father: "父",
  mother: "母",
  quantity: "数量",
  price: "金额",
  code: "牌位类型",
  item_name: "项目名称",
  customer_name: "功德主",
  name: "联络人",
  phone: "电话",
  email: "Email",
  status: "订单状态",
  version: "版本",
};

export function fieldLabel(name: string): string {
  return FIELD_LABELS[name] ?? (name || "字段");
}

/** 付款方式：后端存的是自由字符串（bank / qr / cash / …），认不出的原样显示。 */
export function paymentModeLabel(mode: string | null): string {
  if (!mode) return "—";
  const key = mode.trim().toLowerCase();
  if (key === "bank") return "银行转账";
  if (key === "qr") return "扫码";
  if (key === "cash") return "现金";
  return mode;
}

/** 付款类型：ylp = 盂兰盆牌位，lamp = 点灯。 */
export function paymentTypeLabel(type: string): string {
  if (type === "lamp") return "点灯";
  if (type === "ylp") return "牌位";
  return type;
}
