// 订单有两个不同的 status，界面上必须分清楚：
//   order_status —— 存在 orders.status 列，订单本身的流程（Draft / confirm / paid / cancel…）
//   status       —— 由付款记录实时算出来的汇总（none / pending / paid / rejected）
// 这里统一成中文标签，列表、详情、摘要抽屉共用，避免各处显示不一致。
export const ORDER_STATUS_LABELS: Record<string, string> = {
  Draft: "草稿",
  draft: "草稿",
  confirm: "已确认",
  confirmed: "已确认",
  paid: "已付款",
  process: "处理中",
  cancel: "已取消",
  cancelled: "已取消",
  delete: "已删除",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  none: "未付款",
  pending: "待审核",
  paid: "已付款",
  approved: "已审核",
  rejected: "已拒绝",
};

/** orders.status（订单流程状态）；空值按草稿处理，和后端一致。 */
export function orderStatusLabel(value?: string | null): string {
  const raw = String(value || "").trim() || "Draft";
  return ORDER_STATUS_LABELS[raw] || raw;
}

/** 付款汇总状态（实时算的，不入库）。 */
export function paymentStatusLabel(value?: string | null): string {
  const raw = String(value || "").trim().toLowerCase() || "none";
  return PAYMENT_STATUS_LABELS[raw] || raw;
}
