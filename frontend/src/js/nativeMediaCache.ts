import { API_BASE, IS_APK } from "./apiBase";

type NativeMediaCacheResult = {
  fileUri?: string;
  mimeType?: string;
  size?: number;
};

export interface NativeMediaCachePlugin {
  cacheMedia(options: {
    url: string;
    cacheKey: string;
    force?: boolean;
    staleWhileRevalidate?: boolean;
  }): Promise<NativeMediaCacheResult>;

  invalidate(options: {
    cacheKey?: string;
    prefix?: string;
  }): Promise<void>;

  clearAll(): Promise<void>;
}

type CapacitorLike = {
  registerPlugin?: <T>(name: string) => T;
  Plugins?: Record<string, unknown>;
  convertFileSrc?: (filePath: string) => string;
};

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

const resolvedMediaCache = new Map<string, ResolvedCacheEntry>();
const pendingMediaCache = new Map<string, Promise<string>>();
const staleRevalidatedCache = new Set<string>();

function resolveCapacitor() {
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorLike }).Capacitor ?? null;
}

function createUnavailablePlugin(): NativeMediaCachePlugin {
  const noop = async () => undefined;
  return {
    cacheMedia: async () => {
      throw new Error("NativeMediaCache plugin is unavailable in this runtime");
    },
    invalidate: noop,
    clearAll: noop,
  };
}

function isNativeMediaCachePlugin(value: unknown): value is NativeMediaCachePlugin {
  return Boolean(
    value
      && typeof value === "object"
      && typeof (value as NativeMediaCachePlugin).cacheMedia === "function"
      && typeof (value as NativeMediaCachePlugin).invalidate === "function"
      && typeof (value as NativeMediaCachePlugin).clearAll === "function",
  );
}

export const NativeMediaCache: NativeMediaCachePlugin = (() => {
  const capacitor = resolveCapacitor();
  const fromGlobal = capacitor?.Plugins?.NativeMediaCache;
  if (isNativeMediaCachePlugin(fromGlobal)) return fromGlobal;
  const register = capacitor?.registerPlugin;
  if (typeof register === "function") return register<NativeMediaCachePlugin>("NativeMediaCache");
  return createUnavailablePlugin();
})();

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
