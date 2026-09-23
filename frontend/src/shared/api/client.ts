/**
 * HTTP 客户端。**全仓所有后端请求都走这里**，没有例外。
 *
 * 它负责四件事，每件都是旧前端里散落各处、各写各的：
 *   ① 拼 URL（origin + BASE_PATH），见 shared/config/paths.ts
 *   ② 带上凭证（网页版 Cookie / APK 版 Bearer）
 *   ③ 解析响应，非 2xx 一律抛 ApiError
 *   ④ 401 时触发一次全局「会话失效」通知，由 AuthProvider 决定跳不跳登录页
 *
 * ⚠️ 不要在组件里直接 fetch()。绕过这里就绕过了前缀、凭证和 401 处理，
 *    表现是「本地好好的，加了 BASE_PATH 部署就 404」或者「会话过期后一直转圈」。
 */

import { apiUrl } from "../config/paths";
import { ApiError, extractMessage } from "./errors";

/** APK 的 Bearer 令牌取值函数。由 shared/auth 在启动时注入，避免这里反向依赖 auth。 */
let bearerTokenGetter: (() => string | null) | null = null;
export function setBearerTokenGetter(fn: (() => string | null) | null): void {
  bearerTokenGetter = fn;
}

/** 401 的全局订阅者（AuthProvider 注册一个）。 */
const unauthorizedHandlers = new Set<() => void>();
export function onUnauthorized(fn: () => void): () => void {
  unauthorizedHandlers.add(fn);
  return () => unauthorizedHandlers.delete(fn);
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  /** 请求体。普通对象会被 JSON 序列化；FormData / Blob / string 原样发送。 */
  body?: unknown;
  /** 查询参数。值为 undefined / null 的键会被跳过（不会发出 "?x=undefined"）。 */
  query?: Record<string, string | number | boolean | null | undefined>;
  /** 超时毫秒。默认 30 秒 —— 不设的话断网时请求会永远挂着，界面一直转圈。 */
  timeoutMs?: number;
}

function buildQuery(query: RequestOptions["query"]): string {
  if (!query) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function isPlainBody(body: unknown): boolean {
  return (
    body !== undefined &&
    body !== null &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof URLSearchParams) &&
    typeof body !== "string"
  );
}

export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, timeoutMs = 30_000, headers, signal, ...rest } = options;

  const finalHeaders = new Headers(headers);
  let finalBody: BodyInit | undefined;

  if (body !== undefined && body !== null) {
    if (isPlainBody(body)) {
      finalBody = JSON.stringify(body);
      // 只在自己序列化时设 Content-Type：FormData 必须让浏览器自己带 boundary，
      // 手工设了会让后端解析不出文件字段（表现是「上传后没收到文件」）。
      if (!finalHeaders.has("Content-Type")) finalHeaders.set("Content-Type", "application/json");
    } else {
      finalBody = body as BodyInit;
    }
  }

  // APK 版走 Bearer：壳里没有可靠的 Cookie（capacitor:// 与站点不同源）。
  const token = bearerTokenGetter?.();
  if (token && !finalHeaders.has("Authorization")) {
    finalHeaders.set("Authorization", `Bearer ${token}`);
  }

  // 自己的超时 controller 要和调用方传进来的 signal 合并，不能互相覆盖。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });

  let response: Response;
  try {
    response = await fetch(apiUrl(path) + buildQuery(query), {
      ...rest,
      headers: finalHeaders,
      body: finalBody,
      // 网页版靠会话 Cookie；跨域时必须显式带上，否则后端看到的是匿名请求。
      credentials: "include",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof DOMException && err.name === "AbortError";
    throw new ApiError(aborted ? "请求超时，请检查网络" : "网络连接失败", 0, null);
  }
  clearTimeout(timer);

  // 204 / 205 没有响应体，.json() 会抛 SyntaxError。
  const hasBody = response.status !== 204 && response.status !== 205;
  let parsed: unknown = null;
  if (hasBody) {
    const text = await response.text();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // 后端异常兜底发的可能是 HTML 错误页 / 纯文本。原样留着给 extractMessage。
        parsed = text;
      }
    }
  }

  if (!response.ok) {
    const message = extractMessage(parsed, `请求失败（${response.status}）`);
    if (response.status === 401) {
      for (const fn of unauthorizedHandlers) fn();
    }
    throw new ApiError(message, response.status, parsed);
  }

  return parsed as T;
}

export const http = {
  get: <T = unknown>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
  put: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PUT", body }),
  patch: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  delete: <T = unknown>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "DELETE" }),
};
