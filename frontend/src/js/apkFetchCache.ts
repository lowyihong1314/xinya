import { API_BASE, IS_APK } from "./apiBase";
import {
  readNativeResponseCacheEntry,
  writeNativeResponseCacheEntry,
  invalidateNativeResponseCache,
} from "./nativeResponseCache";

const FETCH_CACHE_INSTALL_FLAG = "__xinyaApkFetchCacheInstalled";
const MAX_CACHEABLE_RESPONSE_BYTES = 4 * 1024 * 1024;

type GlobalFetchState = typeof globalThis & {
  [FETCH_CACHE_INSTALL_FLAG]?: boolean;
};

function shouldProxyPath(pathname: string) {
  return pathname.startsWith("/api/") || pathname.startsWith("/media/") || pathname.startsWith("/media_file/");
}

function isMutationLikePath(pathname: string) {
  return /\/(login|logout|delete|remove|update|edit|renew|register|upload|create|new|approve|submit|replace|reset|move|push|save|set_[^/]*|sign)(\/|$)/i.test(pathname);
}

function getApiBaseOrigin() {
  if (!API_BASE) {
    return "";
  }

  try {
    return new URL(API_BASE).origin;
  } catch {
    return "";
  }
}

function isLocalAppOrigin(origin: string) {
  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";
  return origin === currentOrigin || origin === "http://localhost" || origin === "https://localhost" || origin === "capacitor://localhost";
}

function rewriteApkUrl(rawUrl: string) {
  if (!IS_APK || !API_BASE) {
    return rawUrl;
  }

  if (rawUrl.startsWith("/") && shouldProxyPath(rawUrl)) {
    return `${API_BASE}${rawUrl}`;
  }

  try {
    const parsed = new URL(rawUrl, typeof window !== "undefined" ? window.location.href : undefined);
    if (!shouldProxyPath(parsed.pathname)) {
      return rawUrl;
    }

    const apiBaseOrigin = getApiBaseOrigin();
    if (!apiBaseOrigin || parsed.origin === apiBaseOrigin) {
      return parsed.toString();
    }

    if (!isLocalAppOrigin(parsed.origin)) {
      return rawUrl;
    }

    const rewritten = new URL(parsed.pathname + parsed.search + parsed.hash, API_BASE);
    return rewritten.toString();
  } catch {
    return rawUrl;
  }
}

function buildNormalizedRequest(input: RequestInfo | URL, init?: RequestInit) {
  let request: Request;

  if (input instanceof Request) {
    const rewrittenUrl = rewriteApkUrl(input.url);
    const baseRequest = rewrittenUrl !== input.url ? new Request(rewrittenUrl, input) : input;
    request = init ? new Request(baseRequest, init) : baseRequest;
  } else if (input instanceof URL) {
    request = new Request(rewriteApkUrl(input.toString()), init);
  } else {
    request = new Request(rewriteApkUrl(input), init);
  }

  if (!IS_APK || request.credentials !== "same-origin") {
    return request;
  }

  try {
    const url = new URL(request.url);
    const apiBaseOrigin = getApiBaseOrigin();
    if (!apiBaseOrigin || url.origin !== apiBaseOrigin || !shouldProxyPath(url.pathname)) {
      return request;
    }
  } catch {
    return request;
  }

  return new Request(request, { credentials: "include" });
}

function getRequestDescriptor(request: Request) {
  if (!IS_APK) {
    return null;
  }

  const method = request.method.toUpperCase();
  if (method !== "GET") {
    return null;
  }

  if (request.cache === "no-store") {
    return null;
  }

  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) {
    return null;
  }

  const apiBaseOrigin = getApiBaseOrigin();
  if (!apiBaseOrigin || url.origin !== apiBaseOrigin) {
    return null;
  }

  if (isMutationLikePath(url.pathname)) {
    return null;
  }

  return {
    cacheKey: `${method} ${url.toString()}`,
    url: url.toString(),
  };
}

function isTextLikeResponse(response: Response) {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType) {
    return true;
  }

  return (
    contentType.startsWith("text/")
    || contentType.includes("json")
    || contentType.includes("xml")
    || contentType.includes("javascript")
    || contentType.includes("x-www-form-urlencoded")
  );
}

function hasNoStoreDirective(response: Response) {
  const cacheControl = (response.headers.get("cache-control") ?? "").toLowerCase();
  return cacheControl.includes("no-store");
}

function isAbortError(error: unknown) {
  return Boolean(
    error
      && typeof error === "object"
      && "name" in error
      && (error as { name?: string }).name === "AbortError",
  );
}

function headersToRecord(headers: Headers) {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

async function cacheResponse(descriptor: {
  cacheKey: string;
  url: string;
}, response: Response) {
  if (!response.ok || hasNoStoreDirective(response) || !isTextLikeResponse(response)) {
    if (response.status === 401 || response.status === 403) {
      await invalidateNativeResponseCache({ cacheKey: descriptor.cacheKey });
    }
    return;
  }

  const bodyText = await response.clone().text();
  const bodyBytes = new TextEncoder().encode(bodyText).byteLength;
  if (bodyBytes > MAX_CACHEABLE_RESPONSE_BYTES) {
    return;
  }

  await writeNativeResponseCacheEntry({
    cacheKey: descriptor.cacheKey,
    url: descriptor.url,
    status: response.status,
    statusText: response.statusText,
    headers: headersToRecord(response.headers),
    body: bodyText,
  });
}

async function buildCachedResponse(cacheKey: string) {
  const entry = await readNativeResponseCacheEntry(cacheKey);
  if (!entry) {
    return null;
  }

  const headers = new Headers(entry.headers ?? {});
  headers.set("x-xinya-cache-hit", "native-response-cache");
  if (entry.updatedAt) {
    headers.set("x-xinya-cache-updated-at", String(entry.updatedAt));
  }

  return new Response(entry.body ?? "", {
    status: entry.status ?? 200,
    statusText: entry.statusText ?? "OK",
    headers,
  });
}

export function installApkFetchCache() {
  const globalState = globalThis as GlobalFetchState;
  if (!IS_APK || globalState[FETCH_CACHE_INSTALL_FLAG]) {
    return;
  }

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = buildNormalizedRequest(input, init);
    const descriptor = getRequestDescriptor(request);

    try {
      const response = await originalFetch(request);
      if (descriptor) {
        void cacheResponse(descriptor, response);
      }
      return response;
    } catch (error) {
      if (!descriptor || isAbortError(error)) {
        throw error;
      }

      const cachedResponse = await buildCachedResponse(descriptor.cacheKey);
      if (cachedResponse) {
        return cachedResponse;
      }

      throw error;
    }
  }) as typeof fetch;

  globalState[FETCH_CACHE_INSTALL_FLAG] = true;
}
