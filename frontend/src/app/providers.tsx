/**
 * 全局 Provider 装配。顺序有讲究：
 *   QueryClientProvider 在外  ← AuthProvider 要用它发请求吗？不，Auth 直接用 http 客户端。
 *                                但页面组件两者都要，所以 Query 包在外层最简单。
 *   AuthProvider 在内        ← 路由守卫依赖它
 */
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { queryClient } from "@/shared/api/queryClient";
import { AuthProvider } from "@/shared/auth/AuthProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
