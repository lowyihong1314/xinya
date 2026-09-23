/**
 * 统一的请求错误。
 *
 * 旧前端有 21 份各写各的 parseJson，因为后端历史上有好几种错误形状。
 * v3 后端已经收敛成**一套**：``{"status":"error","message":"..."}``
 * （见 docs/flask_to_fastAPI/00-迁移进度.md「已作废的方案」）。
 * 但仍有少数老接口发 ``{"error":"..."}``，所以这里把两种都认下来，
 * 对上层只暴露一个 ApiError。
 */

export class ApiError extends Error {
  /** HTTP 状态码。0 表示请求根本没发出去（断网、CORS、超时）。 */
  readonly status: number;
  /** 后端原样返回的响应体，方便个别调用点读自定义字段（如 quiz 的 reason）。 */
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  /** 会话失效。调用方据此跳登录页——这是全仓唯一判据，别再各写各的。 */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** 已登录但没权限。 */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** 网络层失败（没收到响应）。和「后端返回了 5xx」要分开提示。 */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

/** 从响应体里挖出给人看的错误文案。认三种键，都挖不到就用兜底。 */
export function extractMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    for (const key of ["message", "error", "detail"]) {
      const v = o[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return fallback;
}
