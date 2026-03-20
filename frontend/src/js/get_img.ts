import heic2any from "heic2any";

type ImageLookupResponse = {
  status?: string;
  ready?: boolean;
  kind?: string;
  path?: string;
};

export type SmartMediaAsset = {
  kind: "image" | "video" | "unsupported";
  url: string;
};

export type SmartMediaVariant = "auto" | "cache" | "base";

const FALLBACK_IMAGE_URL = "/static/images/file_icon/broken-image.png";
const smartImageCache = new Map<string, Promise<string>>();
const smartMediaCache = new Map<string, Promise<SmartMediaAsset>>();
const convertedHeicUrls = new Map<string, string>();
const MEDIA_INFO_STORAGE_PREFIX = "xinya:media-info:v3:";

async function fetchImageInfo(id: number | string, variant: string): Promise<ImageLookupResponse | null> {
  const storageKey = `${MEDIA_INFO_STORAGE_PREFIX}${id}:${variant}`;
  const cached = readStoredMediaInfo(storageKey);
  if (cached) {
    return cached;
  }

  const response = await fetch(`/media/get_event_image/${id}/${variant}`, {
    credentials: "include",
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as ImageLookupResponse | null;
  if (payload?.status === "success" && payload.ready && payload.path) {
    writeStoredMediaInfo(storageKey, payload);
  }
  return payload;
}

function isHeicPath(url: string) {
  return /\.(heic|heif)$/i.test(url);
}

function isPreferredImagePath(url: string) {
  return /\.(png|jpe?g|heic|heif)$/i.test(url);
}

function isVideoPath(url: string) {
  return /\.mp4$/i.test(url);
}

function normalizeFileType(fileType?: string | null) {
  return String(fileType || "").trim().toLowerCase();
}

function isPreferredImageType(fileType?: string | null) {
  return ["png", "jpg", "jpeg", "heic", "heif"].includes(normalizeFileType(fileType));
}

function isBaseVideoType(fileType?: string | null) {
  return ["mp4", "mov"].includes(normalizeFileType(fileType));
}

async function convertHeicUrlToObjectUrl(url: string) {
  const cached = convertedHeicUrls.get(url);
  if (cached) {
    return cached;
  }

  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error("HEIC 文件读取失败");
  }

  const blob = await response.blob();
  const converted = await heic2any({
    blob,
    toType: "image/jpeg",
    quality: 0.9,
  });
  const normalizedBlob = Array.isArray(converted) ? converted[0] : converted;
  const objectUrl = URL.createObjectURL(normalizedBlob as Blob);
  convertedHeicUrls.set(url, objectUrl);
  return objectUrl;
}

async function resolveMediaUrl(id: number | string, type: string) {
  const variants = type === "cache" ? ["cache"] : [type, "cache"];

  for (const variant of variants) {
    const info = await fetchImageInfo(id, variant);
    if (!info || info.status !== "success" || !info.ready) {
      continue;
    }

    if (info.kind && info.kind !== "image") {
      continue;
    }

    if (!info.path) {
      continue;
    }

    const url = `/media_file/${info.path}`;
    if (isHeicPath(url)) {
      return convertHeicUrlToObjectUrl(url);
    }
    return url;
  }

  return FALLBACK_IMAGE_URL;
}

async function resolveMediaAsset(
  id: number | string,
  fileType?: string | null,
  variant: SmartMediaVariant = "auto",
): Promise<SmartMediaAsset> {
  const normalizedType = normalizeFileType(fileType);

  const variants = variant === "base" ? ["base", "cache"] : variant === "cache" ? ["cache", "base"] : ["cache", "base"];

  for (const candidate of variants) {
    const info = await fetchImageInfo(id, candidate).catch(() => null);
    if (!info?.status || info.status !== "success" || !info.ready || !info.path) {
      continue;
    }

    const url = `/media_file/${info.path}`;
    if ((info.kind === "video" || isBaseVideoType(normalizedType) || isVideoPath(url)) && /\.mp4$/i.test(url)) {
      return { kind: "video", url };
    }
    if ((!info.kind || info.kind === "image") && isPreferredImagePath(url)) {
      if (isHeicPath(url)) {
        return { kind: "image", url: await convertHeicUrlToObjectUrl(url) };
      }
      return { kind: "image", url };
    }
  }

  return { kind: "unsupported", url: FALLBACK_IMAGE_URL };
}

export async function smartImageURL(id: number | string, type = "base") {
  const cacheKey = `${id}:${type}`;
  const cached = smartImageCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const task = resolveMediaUrl(id, type).catch((error) => {
    console.warn("smartImageURL failed:", error);
    return FALLBACK_IMAGE_URL;
  });

  smartImageCache.set(cacheKey, task);
  return task;
}

export async function smartMediaAsset(id: number | string, fileType?: string | null, variant: SmartMediaVariant = "auto") {
  const cacheKey = `${id}:media:${normalizeFileType(fileType)}:${variant}`;
  const cached = smartMediaCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const task = resolveMediaAsset(id, fileType, variant)
    .then((asset) => {
      if (asset.kind === "unsupported") {
        smartMediaCache.delete(cacheKey);
      }
      return asset;
    })
    .catch((error) => {
      console.warn("smartMediaAsset failed:", error);
      smartMediaCache.delete(cacheKey);
      return { kind: "unsupported", url: FALLBACK_IMAGE_URL } as SmartMediaAsset;
    });

  smartMediaCache.set(cacheKey, task);
  return task;
}

export function clearSmartImageCache(id?: number | string) {
  if (id === undefined) {
    smartImageCache.clear();
    smartMediaCache.clear();
    return;
  }

  for (const key of smartImageCache.keys()) {
    if (key.startsWith(`${id}:`)) {
      smartImageCache.delete(key);
    }
  }

  for (const key of smartMediaCache.keys()) {
    if (key.startsWith(`${id}:`)) {
      smartMediaCache.delete(key);
    }
  }
}

function readStoredMediaInfo(key: string) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as ImageLookupResponse;
  } catch {
    return null;
  }
}

function writeStoredMediaInfo(key: string, payload: ImageLookupResponse) {
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // ignore localStorage failures
  }
}
