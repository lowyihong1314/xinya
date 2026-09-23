/**
 * 对 TanStack Query 的一层薄封装，统一「怎么取数」。
 *
 * 不是为了少打字，是为了**让所有页面的取数写法一致**：
 * 旧前端每个页面自己 useState+useEffect+三个布尔量，于是同一份数据在不同页面
 * 缓存策略不同、错误处理不同、有的还漏了取消。
 */
import { useQuery, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";

import type { ApiError } from "./errors";

export function useApiQuery<T>(
  key: QueryKey,
  fetcher: () => Promise<T>,
  options?: Omit<UseQueryOptions<T, ApiError, T, QueryKey>, "queryKey" | "queryFn">,
) {
  const result = useQuery<T, ApiError, T, QueryKey>({
    queryKey: key,
    queryFn: fetcher,
    ...options,
  });

  // ★ enabled:false 时 TanStack Query v5 的 status 停在 'pending'（fetchStatus 是
  //   'idle'），于是 `if (q.isPending) return <LoadingState/>` 会**永远**显示加载中。
  //
  //   这个组合在详情页里几乎必然出现：
  //       const id = Number(params.id)
  //       useApiQuery(key, fn, { enabled: Number.isFinite(id) })
  //   访问 /ledger/entries/abc → id 是 NaN → enabled false → 页面永久转圈，
  //   没有任何出口，用户只能退回去。react-router 对 :id 不做类型约束，
  //   所以这种 URL 随手一敲就能构造出来。
  //
  //   在这里统一修掉：查询被禁用且还没有数据时，isPending 报 false，
  //   页面就会往下走到「没有数据」的分支（通常是 EmptyState 或 ErrorState）。
  //   有 placeholderData 的情况不受影响（那时 data 非空）。
  const disabledAndIdle =
    options?.enabled === false && result.fetchStatus === "idle" && result.data === undefined;

  return {
    ...result,
    isPending: disabledAndIdle ? false : result.isPending,
    /** 查询因为参数不合法（或调用方主动关闭）而没有执行。页面可以据此渲染 404 态。 */
    isDisabled: disabledAndIdle,
  };
}
