/**
 * 鉴权相关的后端调用。**只有这一个文件知道登录接口长什么样。**
 *
 * 后端路径（v3 扁平，无 /api 段）：
 *   POST {BASE}/user_control/login          用户名密码 → 下发会话 Cookie
 *   POST {BASE}/user_control/logout
 *   GET  {BASE}/user_control/get_user_data  当前用户 + 权限
 *   POST {BASE}/mobile/session/login        APK：换取 access/refresh 令牌
 *   POST {BASE}/mobile/session/refresh
 */
import { http } from "../api/client";
import type { CurrentUser } from "./types";

/**
 * 从用户对象里摊平权限名。
 *
 * ★ 后端 GET /user_control/get_user_data 返回的是 User.to_dict() **平铺在顶层**，
 *   且**没有顶层 permissions 键** —— 权限挂在 departments[].permissions[].name 下。
 *   这与后端 core/auth.py 的 get_current_user_permissions 是同一套口径。
 *   读顶层 permissions 的话永远是空集，表现是所有带权限的菜单/按钮都不显示。
 */
function flattenPermissions(user: CurrentUser | null): string[] {
  if (!user) return [];
  const names = new Set<string>();
  for (const dept of user.departments ?? []) {
    for (const perm of dept.permissions ?? []) {
      if (perm?.name) names.add(perm.name);
    }
  }
  return [...names];
}

export async function fetchCurrentUser(): Promise<{ user: CurrentUser | null; permissions: string[] }> {
  const data = await http.get<Record<string, unknown>>("/user_control/get_user_data");
  // 用户字段平铺在顶层（没有 user 外壳）。留一手认 data.user，
  // 是为了万一哪天后端包了一层，不会静默变成"未登录"。
  const raw = (data.user as CurrentUser | undefined) ?? (data as unknown as CurrentUser);
  const user = raw && raw.id !== undefined ? raw : null;
  return { user, permissions: flattenPermissions(user) };
}

export async function loginWithPassword(username: string, password: string): Promise<void> {
  await http.post("/user_control/login", { username, password });
}

export async function logout(): Promise<void> {
  // ⚠️ 是 **GET** 不是 POST —— 后端 backend/api/user_control/router.py 就是这么定义的
  //    （沿袭 Flask 时代的 @user_control_bp.get("/logout")）。
  //    写成 POST 会 405，而 AuthProvider 的 finally 仍然会清空本地会话，
  //    于是表现成「点退出看着成功了，但服务端会话还在」—— 换个标签页刷新又登录着。
  await http.get("/user_control/logout");
}

export interface MobileSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export async function loginMobileSession(username: string, password: string): Promise<MobileSession> {
  return http.post<MobileSession>("/mobile/session/login", { username, password });
}

export async function refreshMobileSession(refreshToken: string): Promise<MobileSession> {
  return http.post<MobileSession>("/mobile/session/refresh", { refresh_token: refreshToken });
}
