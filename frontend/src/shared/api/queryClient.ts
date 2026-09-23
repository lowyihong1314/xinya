/**
 * TanStack Query 的全局配置。
 *
 * 为什么引入它：旧前端每个页面自己写 useState + useEffect + loading/error 三件套，
 * 同一份数据在不同页面各拉一次、改完还要手工通知别处刷新。
 * 服务端状态交给 Query 管之后，缓存、去重、失效、重试是一套统一规则。
 */
import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "./errors";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 30 秒内重复请求同一个 key 直接用缓存。页面间切换来回跳不会每次都打后端。
      staleTime: 30_000,
      // ★ 401/403/404 绝不重试：重试改变不了结果，只会让「会话过期」
      //   这件事延迟三倍才被发现，用户看着转圈。
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          if (error.status === 401 || error.status === 403 || error.status === 404) return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      // 写操作一律不重试：重复提交比失败更糟（重复报销单、重复付款）。
      retry: false,
    },
  },
});
