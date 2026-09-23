import { Badge } from "@/shared/ui";

import { DOCUMENT_STATUS_META, DOCUMENT_TYPE_LABELS, FINANCE_PAYMENT_LABELS } from "../format";
import type { DocumentStatus, DocumentType, FinancePaymentStatus } from "../types";

/**
 * 单据的三个标签。抽出来是因为概览页和单据页都在用 ——
 * 「已确认」在一个页面是绿色、在另一个页面是灰色，是最常见的那类小裂缝。
 *
 * 三个组件都做了「认不出来就原样显示」的兜底：status / document_type /
 * finance_payment_status 在库里都是**自由字符串列**，类型上查不出第四种值，
 * 真冒出来时要显示出来而不是崩掉或显示空白。
 */

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const meta = DOCUMENT_STATUS_META[status] as (typeof DOCUMENT_STATUS_META)[DocumentStatus] | undefined;
  return <Badge variant={meta?.variant ?? "neutral"}>{meta?.text ?? status}</Badge>;
}

export function DocumentTypeBadge({ type }: { type: DocumentType }) {
  return <Badge variant="info">{DOCUMENT_TYPE_LABELS[type] ?? type}</Badge>;
}

/** 只有推送过收款审核的销售单据才有这个标签；没推送时调用方直接不渲染。 */
export function FinanceStatusBadge({ status }: { status: FinancePaymentStatus }) {
  // 待审核是「还没做完」→ 提醒色；核对通过是绿；未通过是红。
  const variant = status === "checked" ? "success" : status === "fail" ? "danger" : "warning";
  return <Badge variant={variant}>{FINANCE_PAYMENT_LABELS[status] ?? status}</Badge>;
}
