import { IS_APK } from "./apiBase";

type CachedResponseHeaders = Record<string, string>;

export type NativeResponseCacheEntry = {
  exists?: boolean;
  url?: string;
  status?: number;
  statusText?: string;
  headers?: CachedResponseHeaders;
  body?: string;
  updatedAt?: number;
};

export interface NativeResponseCachePlugin {
  setEntry(options: {
    cacheKey: string;
    url: string;
    status: number;
    statusText?: string;
    headers?: CachedResponseHeaders;
    body?: string;
  }): Promise<void>;

  getEntry(options: {
    cacheKey: string;
  }): Promise<NativeResponseCacheEntry>;

  invalidate(options: {
    cacheKey?: string;
    prefix?: string;
  }): Promise<void>;

  clearAll(): Promise<void>;
}

type CapacitorLike = {
  registerPlugin?: <T>(name: string) => T;
  Plugins?: Record<string, unknown>;
};

function resolveCapacitor() {
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorLike }).Capacitor ?? null;
}

function createUnavailablePlugin(): NativeResponseCachePlugin {
  const noop = async () => undefined;
  const missing = async () => {
    throw new Error("NativeResponseCache plugin is unavailable in this runtime");
  };

  return {
    setEntry: missing,
    getEntry: missing,
    invalidate: noop,
    clearAll: noop,
  };
}

function isNativeResponseCachePlugin(value: unknown): value is NativeResponseCachePlugin {
  return Boolean(
    value
      && typeof value === "object"
      && typeof (value as NativeResponseCachePlugin).setEntry === "function"
      && typeof (value as NativeResponseCachePlugin).getEntry === "function"
      && typeof (value as NativeResponseCachePlugin).invalidate === "function"
      && typeof (value as NativeResponseCachePlugin).clearAll === "function",
  );
}

export const NativeResponseCache: NativeResponseCachePlugin = (() => {
  const capacitor = resolveCapacitor();
  const fromGlobal = capacitor?.Plugins?.NativeResponseCache;
  if (isNativeResponseCachePlugin(fromGlobal)) return fromGlobal;
  const register = capacitor?.registerPlugin;
  if (typeof register === "function") {
    return register<NativeResponseCachePlugin>("NativeResponseCache");
  }
  return createUnavailablePlugin();
})();

export async function readNativeResponseCacheEntry(cacheKey: string) {
  if (!IS_APK || !cacheKey) {
    return null;
  }

  try {
    const entry = await NativeResponseCache.getEntry({ cacheKey });
    if (!entry?.exists) {
      return null;
    }
    return entry;
  } catch (error) {
    console.warn("readNativeResponseCacheEntry failed:", error);
    return null;
  }
}

export async function writeNativeResponseCacheEntry(entry: {
  cacheKey: string;
  url: string;
  status: number;
  statusText?: string;
  headers?: CachedResponseHeaders;
  body?: string;
}) {
  if (!IS_APK) {
    return;
  }

  try {
    await NativeResponseCache.setEntry(entry);
  } catch (error) {
    console.warn("writeNativeResponseCacheEntry failed:", error);
  }
}

export async function invalidateNativeResponseCache(options: {
  cacheKey?: string;
  prefix?: string;
} = {}) {
  const { cacheKey, prefix } = options;
  if (!IS_APK || (!cacheKey && !prefix)) {
    return;
  }

  try {
    await NativeResponseCache.invalidate({ cacheKey, prefix });
  } catch (error) {
    console.warn("invalidateNativeResponseCache failed:", error);
  }
}

export async function clearAllNativeResponseCache() {
  if (!IS_APK) {
    return;
  }

  try {
    await NativeResponseCache.clearAll();
  } catch (error) {
    console.warn("clearAllNativeResponseCache failed:", error);
  }
}
