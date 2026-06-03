import { API_BASE } from "./apiBase";
import { getNativeAuthorizationHeader, shouldUseMobileNativeAuth } from "../mobile/native/authHeader";

// Wraps fetch() so that relative paths are prefixed with API_BASE.
// In normal web builds API_BASE is "" so behaviour is unchanged.
// In the APK build API_BASE is "https://utbabuddha.com".
export async function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const originalInput = input;
  if (typeof input === "string" && input.startsWith("/")) {
    input = `${API_BASE}${input}`;
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
