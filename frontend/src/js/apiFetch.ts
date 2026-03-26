import { API_BASE } from "./apiBase";

// Wraps fetch() so that relative paths are prefixed with API_BASE.
// In normal web builds API_BASE is "" so behaviour is unchanged.
// In the APK build API_BASE is "https://utbabuddha.com".
export function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (typeof input === "string" && input.startsWith("/")) {
    input = `${API_BASE}${input}`;
  }
  return fetch(input, init);
}
