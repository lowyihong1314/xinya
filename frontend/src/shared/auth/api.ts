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

interface UserDataResponse {
  user?: CurrentUser;
  permissions?: string[];
  [key: string]: unknown;
}

export async function fetchCurrentUser(): Promise<{ user: CurrentUser | null; permissions: string[] }> {
  const data = await http.get<UserDataResponse>("/user_control/get_user_data");
  // 后端这条历史上把用户字段平铺在顶层，也可能包在 user 里。两种都认下来，
  // 免得「登录成功但界面显示未登录」这种最难查的症状。
  const user = (data.user ?? (data.id !== undefined ? (data as unknown as CurrentUser) : null)) || null;
  const permissions = Array.isArray(data.permissions) ? data.permissions : [];
  return { user, permissions };
}

export async function loginWithPassword(username: string, password: string): Promise<void> {
  await http.post("/user_control/login", { username, password });
}

export async function logout(): Promise<void> {
  await http.post("/user_control/logout");
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
