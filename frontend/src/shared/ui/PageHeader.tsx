import type { ReactNode } from "react";

import { cn } from "../lib/cn";

/**
 * 页面标题区。**每个页面的第一个元素都应该是它** —— 统一的标题层级是
 * 「UI 分区」最便宜也最有效的一半。
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** 右上角的操作按钮。手机上会换行到标题下方。 */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="font-serif text-2xl leading-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
