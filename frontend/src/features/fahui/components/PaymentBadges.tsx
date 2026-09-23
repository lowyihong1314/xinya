/**
 * 付款状态的两个徽章。
 *
 * ★ 之所以是**两个**而不是一个：后端有两套词，键名都叫 status 但取值不同 ——
 *     订单汇总：none / pending / paid / rejected（shared.order_payment_state）
 *     单条付款：pending / approved / rejected（payment_review 那套）
 *   合成一个组件就得在里面猜「这个 status 是哪一套」，猜错就显示成别的状态。
 *   分成两个，调用点在写的时候就必须想清楚自己拿的是哪一套。
 */
import { Badge } from "@/shared/ui";
import { ORDER_PAYMENT_LABELS, PAYMENT_STATUS_LABELS } from "../format";
import type { OrderPaymentStatus, PaymentRecordStatus } from "../types";

const ORDER_VARIANT: Record<OrderPaymentStatus, "neutral" | "warning" | "success" | "danger"> = {
  none: "neutral",
  pending: "warning",
  paid: "success",
  rejected: "danger",
};

/** 订单层面的付款汇总。 */
export function OrderPaymentBadge({ status }: { status: OrderPaymentStatus }) {
  // 后端这个字段是自由字符串落进枚举的，来了没见过的值就原样显示，别显示成空白
  const variant = ORDER_VARIANT[status] ?? "neutral";
  return <Badge variant={variant}>{ORDER_PAYMENT_LABELS[status] ?? status}</Badge>;
}

const RECORD_VARIANT: Record<PaymentRecordStatus, "warning" | "success" | "danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

/** 单条付款记录的审核状态。 */
export function PaymentStatusBadge({ status }: { status: PaymentRecordStatus }) {
  const variant = RECORD_VARIANT[status] ?? "neutral";
  return <Badge variant={variant}>{PAYMENT_STATUS_LABELS[status] ?? status}</Badge>;
}
