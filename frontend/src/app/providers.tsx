/**
 * 全局 Provider 装配。顺序有讲究，从外到内：
 *   QueryClientProvider  服务端状态
 *   ToastProvider        轻提示（AuthProvider 里可能要报错）
 *   ConfirmProvider      确认框
 *   AuthProvider         会话（路由守卫依赖它）
 */
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { queryClient } from "@/shared/api/queryClient";
import { AuthProvider } from "@/shared/auth/AuthProvider";
import { ConfirmProvider, ToastProvider } from "@/shared/ui";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>{children}</AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
