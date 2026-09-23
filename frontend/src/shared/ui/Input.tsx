import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "../lib/cn";

/**
 * 输入框。
 * ★ 字号必须 ≥16px（text-base）—— iOS Safari 对小于 16px 的输入框会**自动放大页面**，
 *   放大后就缩不回去，整个界面错位。这是踩过的坑，不要为了"好看"改小。
 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "flex h-10 w-full rounded-[var(--radius-sm)] border border-input bg-card px-3 py-2",
          "text-base text-foreground placeholder:text-muted-foreground",
          "transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--color-ring)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          className,
        )}
        {...props}
      />
    );
  },
);
