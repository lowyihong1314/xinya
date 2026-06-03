import { API_BASE, IS_APK } from "./apiBase";
import { resolveCapacitor } from "../mobile/native/capacitor";
import {
  NativeMediaCachePluginBridge,
  type NativeMediaCachePlugin,
} from "../mobile/native/mediaCachePlugin";
export type {
  NativeCacheStats as NativeMediaCacheStats,
  NativeMediaCachePlugin,
  NativeMediaCacheResult,
} from "../mobile/native/mediaCachePlugin";

export type NativeCacheOptions = {
  cacheKey?: string;
  refreshKey?: string | number | boolean | null;
  resolveRelativeToApi?: boolean;
  staleWhileRevalidate?: boolean;
};

type ResolvedCacheEntry = {
  source: string;
  refreshToken: string;
  resolvedUrl: string;
};

export const NATIVE_MEDIA_CACHE_MIN_GB = 1;
export const NATIVE_MEDIA_CACHE_DEFAULT_GB = 10;
export const NATIVE_MEDIA_CACHE_MAX_GB = 50;
const GIGABYTE_BYTES = 1024 * 1024 * 1024;

const resolvedMediaCache = new Map<string, ResolvedCacheEntry>();
const pendingMediaCache = new Map<string, Promise<string>>();
const staleRevalidatedCache = new Set<string>();

export const NativeMediaCache: NativeMediaCachePlugin = NativeMediaCachePluginBridge;

export function mediaCacheGbToBytes(value: number) {
  const numeric = Number.isFinite(value) ? value : NATIVE_MEDIA_CACHE_DEFAULT_GB;
  const clampedGb = Math.min(
    NATIVE_MEDIA_CACHE_MAX_GB,
    Math.max(NATIVE_MEDIA_CACHE_MIN_GB, Math.round(numeric)),
  );
  return clampedGb * GIGABYTE_BYTES;
}

export function mediaCacheBytesToGb(value?: number | null) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return NATIVE_MEDIA_CACHE_DEFAULT_GB;
  }
  return Math.min(
    NATIVE_MEDIA_CACHE_MAX_GB,
    Math.max(NATIVE_MEDIA_CACHE_MIN_GB, Math.round(numeric / GIGABYTE_BYTES)),
  );
}

export function normalizeMediaSource(
  src?: string | null,
  options?: Pick<NativeCacheOptions, "resolveRelativeToApi">,
) {
  if (!src) {
    return "";
  }

  const trimmed = String(src).trim();
  if (!trimmed) {
    return "";
  }

  if (/^(data:|blob:|content:|file:|capacitor:)/i.test(trimmed)) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (options?.resolveRelativeToApi && trimmed.startsWith("/") && API_BASE) {
    return `${API_BASE}${trimmed}`;
  }

  return trimmed;
}

function isCacheableRemoteSource(source: string) {
  return /^https?:\/\//i.test(source);
}

function resolveLocalFileSrc(fileUri: string) {
  const capacitor = resolveCapacitor();
  if (typeof capacitor?.convertFileSrc === "function") {
    return capacitor.convertFileSrc(fileUri);
  }
  return fileUri;
}

function buildCacheIdentity(cacheKey: string, source: string, refreshToken: string) {
  return `${cacheKey}\n${source}\n${refreshToken}`;
}

function forgetStaleRevalidatedCache(options: { cacheKey?: string; prefix?: string }) {
  const { cacheKey, prefix } = options;
  if (cacheKey) {
    const identityPrefix = `${cacheKey}\n`;
    for (const key of [...staleRevalidatedCache]) {
      if (key.startsWith(identityPrefix)) {
        staleRevalidatedCache.delete(key);
      }
    }
  }

  if (prefix) {
    for (const key of [...staleRevalidatedCache]) {
      if (key.startsWith(prefix)) {
        staleRevalidatedCache.delete(key);
      }
    }
  }
}

function revalidateNativeCachedUrlOnce(cacheKey: string, source: string, refreshToken: string) {
  const identity = buildCacheIdentity(cacheKey, source, refreshToken);
  if (staleRevalidatedCache.has(identity)) {
    return;
  }
  staleRevalidatedCache.add(identity);
  void NativeMediaCache.cacheMedia({
    url: source,
    cacheKey,
    staleWhileRevalidate: true,
  }).catch((error) => {
    staleRevalidatedCache.delete(identity);
    console.warn("revalidateNativeCachedUrlOnce failed:", error);
  });
}

export async function invalidateNativeMediaCache(options: {
  cacheKey?: string;
  prefix?: string;
} = {}) {
  const { cacheKey, prefix } = options;

  if (cacheKey) {
    resolvedMediaCache.delete(cacheKey);
    pendingMediaCache.delete(cacheKey);
  }

  if (prefix) {
    for (const key of [...resolvedMediaCache.keys()]) {
      if (key.startsWith(prefix)) {
        resolvedMediaCache.delete(key);
      }
    }
    for (const key of [...pendingMediaCache.keys()]) {
      if (key.startsWith(prefix)) {
        pendingMediaCache.delete(key);
      }
    }
  }
  forgetStaleRevalidatedCache(options);

  if (!IS_APK || (!cacheKey && !prefix)) {
    return;
  }

  try {
    await NativeMediaCache.invalidate({ cacheKey, prefix });
  } catch (error) {
    console.warn("invalidateNativeMediaCache failed:", error);
  }
}

export async function clearAllNativeMediaCache() {
  resolvedMediaCache.clear();
  pendingMediaCache.clear();
  staleRevalidatedCache.clear();

  if (!IS_APK) {
    return;
  }

  try {
    await NativeMediaCache.clearAll();
  } catch (error) {
    console.warn("clearAllNativeMediaCache failed:", error);
  }
}

export async function getNativeMediaCacheStats() {
  if (!IS_APK) {
    return {
      entryCount: 0,
      totalBytes: 0,
      maxBytes: 0,
      trimmedEntries: 0,
      trimmedBytes: 0,
    };
  }

  try {
    return await NativeMediaCache.getStats();
  } catch (error) {
    console.warn("getNativeMediaCacheStats failed:", error);
    return {
      entryCount: 0,
      totalBytes: 0,
      maxBytes: 0,
      trimmedEntries: 0,
      trimmedBytes: 0,
    };
  }
}

export async function trimNativeMediaCache(maxBytes?: number) {
  if (!IS_APK) {
    return {
      entryCount: 0,
      totalBytes: 0,
      maxBytes: 0,
      trimmedEntries: 0,
      trimmedBytes: 0,
    };
  }

  try {
    return await NativeMediaCache.trim({ maxBytes });
  } catch (error) {
    console.warn("trimNativeMediaCache failed:", error);
    return await getNativeMediaCacheStats();
  }
}

export async function setNativeMediaCacheMaxGb(maxGb: number) {
  if (!IS_APK) {
    return {
      entryCount: 0,
      totalBytes: 0,
      maxBytes: mediaCacheGbToBytes(maxGb),
      trimmedEntries: 0,
      trimmedBytes: 0,
    };
  }

  try {
    return await NativeMediaCache.setMaxBytes({ maxBytes: mediaCacheGbToBytes(maxGb) });
  } catch (error) {
    console.warn("setNativeMediaCacheMaxGb failed:", error);
    return await trimNativeMediaCache(mediaCacheGbToBytes(maxGb));
  }
}

export async function resolveNativeCachedUrl(
  src?: string | null,
  options: NativeCacheOptions = {},
) {
  const normalizedSource = normalizeMediaSource(src, options);
  if (!normalizedSource || !IS_APK || !isCacheableRemoteSource(normalizedSource)) {
    return normalizedSource;
  }

  const cacheKey = options.cacheKey ?? `src:${normalizedSource}`;
  const refreshToken = String(options.refreshKey ?? "");
  const cached = resolvedMediaCache.get(cacheKey);
  if (
    cached
    && cached.source === normalizedSource
    && cached.refreshToken === refreshToken
  ) {
    if (options.staleWhileRevalidate) {
      revalidateNativeCachedUrlOnce(cacheKey, normalizedSource, refreshToken);
    }
    return cached.resolvedUrl;
  }

  const previous = resolvedMediaCache.get(cacheKey);
  if (
    previous
    && (previous.source !== normalizedSource || previous.refreshToken !== refreshToken)
  ) {
    await invalidateNativeMediaCache({ cacheKey });
  }

  const pending = pendingMediaCache.get(cacheKey);
  if (pending && !previous) {
    return pending;
  }

  const identity = buildCacheIdentity(cacheKey, normalizedSource, refreshToken);
  if (options.staleWhileRevalidate) {
    staleRevalidatedCache.add(identity);
  }

  const task = NativeMediaCache.cacheMedia({
    url: normalizedSource,
    cacheKey,
    staleWhileRevalidate: options.staleWhileRevalidate,
  })
    .then((result) => {
      const fileUri = result.fileUri ? String(result.fileUri) : "";
      const resolvedUrl = fileUri ? resolveLocalFileSrc(fileUri) : normalizedSource;
      resolvedMediaCache.set(cacheKey, {
        source: normalizedSource,
        refreshToken,
        resolvedUrl,
      });
      return resolvedUrl;
    })
    .catch((error) => {
      console.warn("resolveNativeCachedUrl failed:", error);
      resolvedMediaCache.delete(cacheKey);
      staleRevalidatedCache.delete(identity);
      return normalizedSource;
    })
    .finally(() => {
      pendingMediaCache.delete(cacheKey);
    });

  pendingMediaCache.set(cacheKey, task);
  return task;
}
