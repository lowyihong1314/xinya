import { cn } from "../lib/cn";

/**
 * 骨架屏。列表/详情首次加载时用它占位，比转圈好 —— 用户能预判内容的形状，
 * 而且切换到真内容时不会整页跳动（布局位移）。
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-[var(--radius-sm)] bg-muted", className)} {...props} />;
}
