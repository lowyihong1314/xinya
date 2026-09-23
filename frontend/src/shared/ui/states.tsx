/**
 * 加载 / 空 / 错误 三态。
 *
 * 为什么单独抽出来：旧前端每个页面各写各的三态，于是同一个「加载中」在不同页面
 * 长得不一样、错误提示有的显示技术细节有的一片空白。
 * 这三个组件是**唯一**的三态写法，页面只管传文案。
 */
import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { ApiError } from "../api/errors";
import { cn } from "../lib/cn";
import { Button } from "./Button";

export function LoadingState({ label = "加载中…", className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn("flex min-h-40 flex-col items-center justify-center gap-3 text-muted-foreground", className)}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-6 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({
  title = "暂无内容",
  description,
  action,
  className,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-40 flex-col items-center justify-center gap-3 px-6 text-center", className)}>
      <Inbox className="size-8 text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * 错误态。
 * ★ 给用户看的是**后端的中文文案**，不是异常堆栈。ApiError.message 已经是
 *   从 {"status":"error","message":"…"} 里挖出来的那句话。
 *   非 ApiError（代码 bug）才退回通用文案 —— 把 TypeError 原文甩给用户没有意义。
 */
export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const message =
    error instanceof ApiError
      ? error.message
      : "出了点问题，请稍后再试";

  return (
    <div
      className={cn("flex min-h-40 flex-col items-center justify-center gap-3 px-6 text-center", className)}
      role="alert"
    >
      <AlertCircle className="size-8 text-destructive" aria-hidden />
      <p className="text-sm text-foreground">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      ) : null}
    </div>
  );
}
