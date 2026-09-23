/**
 * 合并 className。
 *
 * clsx 负责条件拼接，tailwind-merge 负责**后写的覆盖先写的**——
 * 没有它的话 `cn("p-2", "p-4")` 会两个都留着，最终取哪个由 CSS 里的顺序决定，
 * 表现是「传了 className 却没生效」。组件库的可覆盖性全靠这一行。
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
