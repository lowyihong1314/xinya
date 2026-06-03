import { resolveNativePlugin } from "./capacitor";

export type NativeMediaCacheResult = {
  fileUri?: string;
  mimeType?: string;
  size?: number;
};

export type NativeCacheStats = {
  entryCount?: number;
  totalBytes?: number;
  maxBytes?: number;
  trimmedEntries?: number;
  trimmedBytes?: number;
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

  getStats(): Promise<NativeCacheStats>;

  trim(options?: {
    maxBytes?: number;
  }): Promise<NativeCacheStats>;

  setMaxBytes(options: {
    maxBytes: number;
  }): Promise<NativeCacheStats>;

  clearAll(): Promise<void>;
}

function createUnavailablePlugin(): NativeMediaCachePlugin {
  const noop = async () => undefined;
  return {
    cacheMedia: async () => {
      throw new Error("NativeMediaCache plugin is unavailable in this runtime");
    },
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
    setMaxBytes: async () => ({
      entryCount: 0,
      totalBytes: 0,
      maxBytes: 0,
      trimmedEntries: 0,
      trimmedBytes: 0,
    }),
    clearAll: noop,
  };
}

function isNativeMediaCachePlugin(value: unknown): value is NativeMediaCachePlugin {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as NativeMediaCachePlugin).cacheMedia === "function" &&
      typeof (value as NativeMediaCachePlugin).invalidate === "function" &&
      typeof (value as NativeMediaCachePlugin).getStats === "function" &&
      typeof (value as NativeMediaCachePlugin).trim === "function" &&
      typeof (value as NativeMediaCachePlugin).setMaxBytes === "function" &&
      typeof (value as NativeMediaCachePlugin).clearAll === "function",
  );
}

export const NativeMediaCachePluginBridge = resolveNativePlugin<NativeMediaCachePlugin>(
  "NativeMediaCache",
  isNativeMediaCachePlugin,
  createUnavailablePlugin,
);
