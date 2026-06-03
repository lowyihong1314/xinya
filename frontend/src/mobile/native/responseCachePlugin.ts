import { resolveNativePlugin } from "./capacitor";

export type CachedResponseHeaders = Record<string, string>;

export type NativeResponseCacheEntry = {
  exists?: boolean;
  url?: string;
  status?: number;
  statusText?: string;
  headers?: CachedResponseHeaders;
  body?: string;
  updatedAt?: number;
};

export type NativeCacheStats = {
  entryCount?: number;
  totalBytes?: number;
  maxBytes?: number;
  trimmedEntries?: number;
  trimmedBytes?: number;
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

  getStats(): Promise<NativeCacheStats>;

  trim(options?: {
    maxBytes?: number;
  }): Promise<NativeCacheStats>;

  clearAll(): Promise<void>;
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
    getStats: async () => ({
      entryCount: 0,
      totalBytes: 0,
      maxBytes: 0,
      trimmedEntries: 0,
      trimmedBytes: 0,
    }),
    trim: async () => ({
      entryCount: 0,
      totalBytes: 0,
      maxBytes: 0,
      trimmedEntries: 0,
      trimmedBytes: 0,
    }),
    clearAll: noop,
  };
}

function isNativeResponseCachePlugin(value: unknown): value is NativeResponseCachePlugin {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as NativeResponseCachePlugin).setEntry === "function" &&
      typeof (value as NativeResponseCachePlugin).getEntry === "function" &&
      typeof (value as NativeResponseCachePlugin).invalidate === "function" &&
      typeof (value as NativeResponseCachePlugin).getStats === "function" &&
      typeof (value as NativeResponseCachePlugin).trim === "function" &&
      typeof (value as NativeResponseCachePlugin).clearAll === "function",
  );
}

export const NativeResponseCachePluginBridge = resolveNativePlugin<NativeResponseCachePlugin>(
  "NativeResponseCache",
  isNativeResponseCachePlugin,
  createUnavailablePlugin,
);
