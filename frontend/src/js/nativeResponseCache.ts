import { IS_APK } from "./apiBase";
import {
  NativeResponseCachePluginBridge,
  type CachedResponseHeaders,
  type NativeResponseCachePlugin,
} from "../mobile/native/responseCachePlugin";
export type {
  CachedResponseHeaders,
  NativeCacheStats as NativeResponseCacheStats,
  NativeResponseCacheEntry,
  NativeResponseCachePlugin,
} from "../mobile/native/responseCachePlugin";

export const NativeResponseCache: NativeResponseCachePlugin = NativeResponseCachePluginBridge;

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

export async function getNativeResponseCacheStats() {
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
    return await NativeResponseCache.getStats();
  } catch (error) {
    console.warn("getNativeResponseCacheStats failed:", error);
    return {
      entryCount: 0,
      totalBytes: 0,
      maxBytes: 0,
      trimmedEntries: 0,
      trimmedBytes: 0,
    };
  }
}

export async function trimNativeResponseCache(maxBytes?: number) {
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
    return await NativeResponseCache.trim({ maxBytes });
  } catch (error) {
    console.warn("trimNativeResponseCache failed:", error);
    return await getNativeResponseCacheStats();
  }
}
