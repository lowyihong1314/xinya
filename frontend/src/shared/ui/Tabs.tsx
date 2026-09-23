/**
 * 页内分区切换。多个模块都需要（总账的现金/凭证/科目、CCTV 的直播/回放、
 * 收款的待办/已完成…）——不放 shared 的话每个模块会各造一个长得不一样的。
 *
 * 基于 Radix：方向键切换、aria-selected、焦点管理都由它处理。
 * 自己用 useState + 一排 Button 做的话，键盘用户没法用方向键在标签间移动。
 */
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";

import { cn } from "../lib/cn";

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        // overflow-x-auto：标签多了在手机上要能横滑，否则会被挤成两行或截断
        "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-[var(--radius-sm)] bg-muted p-1",
        className,
      )}
      {...props}
    />
  );
});

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-[calc(var(--radius-sm)-4px)]",
        "px-3 text-sm font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]",
        "disabled:pointer-events-none disabled:opacity-50",
        "data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        "data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn(
        "mt-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]",
        className,
      )}
      {...props}
    />
  );
});
