/**
 * 路由守卫。放在路由表里，不要在页面组件内部自己判断 ——
 * 页面内判断意味着组件已经开始渲染（可能已经发了请求），才发现没权限。
 */
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "./AuthProvider";

/** 会话还没拉回来时的占位。不渲染任何东西会让登录页闪一下。 */
function SessionPending() {
  return (
    <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      正在确认登录状态…
    </div>
  );
}

/** 要求已登录。未登录 → 跳登录页，并把原地址带上，登录后跳回去。 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <SessionPending />;
  if (!user) {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?from=${encodeURIComponent(from)}`} replace />;
  }
  return <>{children}</>;
}

/**
 * 要求某个权限（多个时满足任意一个即可）。
 * 未登录走登录页，已登录但没权限走 403 —— 两者提示不同，混在一起会让
 * 有账号但没权限的人反复被弹去登录。
 */
export function RequirePermission({
  anyOf,
  children,
}: {
  anyOf: readonly string[];
  children: ReactNode;
}) {
  const { user, loading, hasAny } = useAuth();
  const location = useLocation();

  if (loading) return <SessionPending />;
  if (!user) {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?from=${encodeURIComponent(from)}`} replace />;
  }
  if (!hasAny(anyOf)) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}
