import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";

import { cn } from "../lib/cn";

/**
 * 下拉选择。**用原生 <select>**，不用 Radix Select。
 *
 * 原因：手机上原生 select 会唤起系统选择器（iOS 的滚轮、Android 的列表），
 * 比任何自绘下拉都好用，而且天然支持键盘、读屏、搜索首字母。
 * 需要「可搜索 / 多选 / 自定义选项渲染」时才换成组合框，那是另一个组件。
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "flex h-10 w-full appearance-none rounded-[var(--radius-sm)] border border-input bg-card",
            "px-3 pr-9 text-base text-foreground",
            "transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--color-ring)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      </div>
    );
  },
);
