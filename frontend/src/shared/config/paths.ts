/**
 * 路径拼接。所有「内部路径 → 可用 URL」的转换都走这里。
 *
 * 为什么要单独一层：前缀会被**多条链路**各拼一次（http 客户端拼一次、
 * 缓存层重拼 URL 又一次、后端给的地址前端再拼一次）。
 * 所以下面每个函数都必须**幂等**——这是防重复前缀的唯一一道防线。
 */

import { API_ROOT, BASE_PATH, PUBLIC_ORIGIN } from "./env";

/** 带协议或协议相对的绝对地址一律原样放行：那是别人拼好的，再加工就是双前缀。 */
export function isAbsoluteUrl(path: string): boolean {
  return path.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(path);
}

/**
 * 内部路径 → 带前缀的相对路径（给 fetch / EventSource 用）。
 *
 *   BASE_PATH = ""            apiPath("/members") → "/members"
 *   BASE_PATH = "/UTBA_DEMO"  apiPath("/members") → "/UTBA_DEMO/members"
 */
export function apiPath(path: string): string {
  const raw = String(path ?? "");
  if (isAbsoluteUrl(raw)) return raw;

  // 统一成单个前导斜杠，免得 "members" 和 "/members" 拼出两种结果。
  const normalized = `/${raw.replace(/^\/+/, "")}`;
  if (!BASE_PATH) return normalized;
  // 幂等：已经带前缀就不再补
  if (normalized === BASE_PATH || normalized.startsWith(`${BASE_PATH}/`)) return normalized;
  return `${BASE_PATH}${normalized}`;
}

/** 内部路径 → 完整请求 URL（含 origin）。http 客户端用它。 */
export function apiUrl(path: string): string {
  const raw = String(path ?? "");
  if (isAbsoluteUrl(raw)) return raw;
  return `${API_ROOT}/${raw.replace(/^\/+/, "")}`;
}

/**
 * 内部路径 → 可对外分享的绝对 URL（二维码、短链、分享卡片）。
 * 用 PUBLIC_ORIGIN 而不是 location.origin：APK 里后者是 capacitor://localhost，
 * 拿它拼出来的二维码扫不开。
 */
export function publicUrl(path: string): string {
  const raw = String(path ?? "");
  if (isAbsoluteUrl(raw)) return raw;
  return `${PUBLIC_ORIGIN}${apiPath(raw)}`;
}
