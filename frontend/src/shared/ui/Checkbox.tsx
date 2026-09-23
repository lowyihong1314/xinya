/**
 * 复选框。用原生 <input type="checkbox">，靠 appearance-none + 自绘样式。
 *
 * 不用 Radix Checkbox 的理由：原生的天然参与表单提交、支持 :indeterminate、
 * 读屏软件也最熟；Radix 那个的价值主要在「需要完全自定义的图标与动画」，
 * 我们不需要。
 */
import { Check } from "lucide-react";
import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "../lib/cn";

export const Checkbox = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type">
>(function Checkbox({ className, ...props }, ref) {
  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          "peer size-4 cursor-pointer appearance-none rounded-[4px] border border-input bg-card",
          "checked:border-primary checked:bg-primary",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
      <Check
        className="pointer-events-none absolute size-3 text-primary-foreground opacity-0 peer-checked:opacity-100"
        aria-hidden
      />
    </span>
  );
});
