import { API_BASE } from "./apiBase";
import { apiPath } from "./basePath";
import { getNativeAuthorizationHeader, shouldUseMobileNativeAuth } from "../mobile/native/authHeader";

// 包一层 fetch()：以 "/" 开头的内部路径统一补上 origin 和项目前缀。
//   网页版   API_BASE=""  BASE_PATH=""            → "/api/x"（和加前缀之前逐字节一致）
//   网页版   API_BASE=""  BASE_PATH="/UTBA_DEMO"  → "/UTBA_DEMO/api/x"
//   APK 版   API_BASE="https://utbabuddha.com"    → "https://utbabuddha.com/UTBA_DEMO/api/x"
// 全仓 400 个调用点里有 394 个走这里，所以前缀只在这一处拼；
// 剩下那些自己拼 `${API_BASE}${path}` 的地方要改用 basePath.ts 的 API_ROOT / apiPath()。
export async function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const originalInput = input;
  if (typeof input === "string" && input.startsWith("/")) {
    // apiPath() 是幂等的：调用方若已经拼过前缀（或 APK 缓存层重拼过一次），不会补成双前缀。
    input = `${API_BASE}${apiPath(input)}`;
  }

  let nextInit = init;
  if (shouldAttachNativeAuthorization(originalInput, input)) {
    const authorization = await getNativeAuthorizationHeader();
    if (authorization) {
      const requestHeaders = isRequest(originalInput) ? originalInput.headers : undefined;
      const headers = new Headers(init?.headers || requestHeaders);
      if (!headers.has("Authorization")) {
        headers.set("Authorization", authorization);
      }
      nextInit = { ...init, headers };
    }
  }

  return fetch(input, nextInit);
}

function isRequest(input: string | URL | Request): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function shouldAttachNativeAuthorization(originalInput: string | URL | Request, normalizedInput: string | URL | Request) {
  if (!shouldUseMobileNativeAuth()) return false;
  if (typeof originalInput === "string" && originalInput.startsWith("/")) return true;

  const base = API_BASE.replace(/\/+$/, "");
  if (!base) return false;

  const url = typeof normalizedInput === "string" ? normalizedInput : normalizedInput.toString();
  return url === base || url.startsWith(`${base}/`);
}
