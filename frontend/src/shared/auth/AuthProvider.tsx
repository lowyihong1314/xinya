/**
 * 会话上下文。**全仓唯一**的「我是谁、我有什么权限」来源。
 *
 * 职责边界：
 *   · 启动时拉一次当前用户，拉完才渲染需要登录的页面（否则会闪一下登录页）
 *   · 登录 / 登出
 *   · 把 APK 的 Bearer 取值函数注入给 http 客户端
 *   · 订阅 http 客户端的 401 通知 —— 任何一条请求 401 都会让会话归零，
 *     不需要每个调用点自己判断「这个 401 要不要跳登录」
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { onUnauthorized, setBearerTokenGetter } from "../api/client";
import { IS_APK } from "../config/env";
import * as authApi from "./api";
import { tokenStore } from "./tokenStore";
import type { CurrentUser, SessionState } from "./types";

interface AuthContextValue extends SessionState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** 重新拉一次当前用户（改了资料、切了部门之后用）。 */
  refresh: () => Promise<void>;
  has: (permission: string) => boolean;
  hasAny: (permissions: readonly string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const EMPTY: ReadonlySet<string> = new Set();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [permissions, setPermissions] = useState<ReadonlySet<string>>(EMPTY);
  const [loading, setLoading] = useState(true);

  // APK：让 http 客户端能取到 Bearer。注册一次即可，网页版不注册（走 Cookie）。
  useEffect(() => {
    if (!IS_APK) return;
    setBearerTokenGetter(() => tokenStore.getAccess());
    return () => setBearerTokenGetter(null);
  }, []);

  const load = useCallback(async () => {
    try {
      const { user: u, permissions: p } = await authApi.fetchCurrentUser();
      setUser(u);
      setPermissions(new Set(p));
    } catch {
      // 401 是正常的「没登录」，不是异常。其它错误（断网、500）同样降级成未登录 ——
      // 此时让用户看登录页，比看一个白屏或者错误堆栈好。
      setUser(null);
      setPermissions(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 任何一条请求 401 → 会话归零。路由守卫会据此把人送到登录页。
  useEffect(
    () =>
      onUnauthorized(() => {
        setUser(null);
        setPermissions(EMPTY);
        if (IS_APK) tokenStore.clear();
      }),
    [],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      if (IS_APK) {
        const session = await authApi.loginMobileSession(username, password);
        tokenStore.set(session.access_token, session.refresh_token);
      } else {
        await authApi.loginWithPassword(username, password);
      }
      await load();
    },
    [load],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // ★ 无论后端登出成没成功，本地一律清空。
      //   反过来做（失败就不清）会让用户卡在「点了退出还是登录状态」。
      if (IS_APK) tokenStore.clear();
      setUser(null);
      setPermissions(EMPTY);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      permissions,
      loading,
      login,
      logout,
      refresh: load,
      has: (p) => permissions.has(p),
      hasAny: (ps) => ps.some((p) => permissions.has(p)),
    }),
    [user, permissions, loading, login, logout, load],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必须在 <AuthProvider> 内使用");
  return ctx;
}
