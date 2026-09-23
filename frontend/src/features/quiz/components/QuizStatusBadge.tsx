import { Badge } from "@/shared/ui";

import type { QuizStatus } from "../types";

/**
 * 状态标签。**四个状态的说法只在这里定义一次** —— 老前端主持台写"倒数中"、
 * 抢答页写"准备中"，同一个 status 两种说法，现场两块屏幕对不上。
 */
const LABEL: Record<QuizStatus, { text: string; variant: "neutral" | "warning" | "success" }> = {
  draft: { text: "未发布", variant: "neutral" },
  waiting: { text: "倒数中", variant: "warning" },
  open: { text: "抢答中", variant: "success" },
  closed: { text: "已结束", variant: "neutral" },
};

export function QuizStatusBadge({ status }: { status: QuizStatus }) {
  // ?? 兜底不是多余的：status 是后端现算的字符串，哪天多一个状态时
  // 这里应该显示成"未发布"而不是整块渲染崩掉。
  const label = LABEL[status] ?? LABEL.draft;
  return <Badge variant={label.variant}>{label.text}</Badge>;
}
