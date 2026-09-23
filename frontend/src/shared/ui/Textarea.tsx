import { forwardRef, type TextareaHTMLAttributes } from "react";

import { cn } from "../lib/cn";

/** 多行输入。字号同样 ≥16px —— iOS 会放大页面，见 Input.tsx。 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "flex min-h-24 w-full rounded-[var(--radius-sm)] border border-input bg-card px-3 py-2",
          "text-base text-foreground placeholder:text-muted-foreground",
          "transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--color-ring)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
