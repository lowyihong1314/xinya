/**
 * 对 TanStack Query 的一层薄封装，统一「怎么取数」。
 *
 * 不是为了少打字，是为了**让所有页面的取数写法一致**：
 * 旧前端每个页面自己 useState+useEffect+三个布尔量，于是同一份数据在不同页面
 * 缓存策略不同、错误处理不同、有的还漏了取消。
 */
import { useQuery, type UseQueryOptions, type QueryKey } from "@tanstack/react-query";

import type { ApiError } from "./errors";

export function useApiQuery<T>(
  key: QueryKey,
  fetcher: () => Promise<T>,
  options?: Omit<UseQueryOptions<T, ApiError, T, QueryKey>, "queryKey" | "queryFn">,
) {
  return useQuery<T, ApiError, T, QueryKey>({ queryKey: key, queryFn: fetcher, ...options });
}
