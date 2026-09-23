import { Badge } from "@/shared/ui";

import type { JournalEntryStatus } from "../types";

/**
 * 凭证状态标签。列表、详情、明细账三处都在用，所以抽出来 ——
 * 「已过账」在一个页面是绿色、在另一个页面是灰色，是旧前端最常见的那类小裂缝。
 */
const STATUS: Record<JournalEntryStatus, { text: string; variant: "success" | "warning" | "neutral" }> = {
  // 草稿还没进账本，用提醒色表示「这件事还没做完」
  draft: { text: "草稿", variant: "warning" },
  posted: { text: "已过账", variant: "success" },
  // 作废是终态，不是错误，所以用中性色而不是红色
  void: { text: "已作废", variant: "neutral" },
};

export function EntryStatusBadge({ status }: { status: JournalEntryStatus }) {
  // 后端 status 是自由字符串列（不是数据库枚举），真冒出第四种值时不要崩 ——
  // 类型上查不出来，所以这里显式当成「可能没有」来取。
  const meta = STATUS[status] as (typeof STATUS)[JournalEntryStatus] | undefined;
  return <Badge variant={meta?.variant ?? "neutral"}>{meta?.text ?? status}</Badge>;
}
