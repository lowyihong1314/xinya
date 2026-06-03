import { Share } from "@capacitor/share";
import { isAndroidNativeRuntime, isMobileNativeRuntime } from "../mobile/native/capacitor";
import { NativeFileSharePluginBridge } from "../mobile/native/fileSharePlugin";
import { API_BASE } from "./apiBase";
import { apiFetch } from "./apiFetch";

type DownloadShareOptions = {
  isMobile?: boolean;
  title?: string;
  text?: string;
  mimeType?: string;
  fallbackUrl?: string;
};

type ShareBlobResult = "shared" | "cancelled" | "unsupported";

export async function copyTextToClipboard(text: string) {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard API unavailable");
  }

  await navigator.clipboard.writeText(text);
}

export function downloadUrl(url: string, filename?: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  if (filename) {
    anchor.download = filename;
  }
  anchor.rel = "noopener";
  anchor.click();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function downloadBlobOrShare(blob: Blob, filename: string, options: DownloadShareOptions = {}) {
  if (shouldUseShare(options.isMobile)) {
    const shared = await shareBlob(blob, filename, options);
    if (shared === "shared" || shared === "cancelled") {
      return shared;
    }
  }

  downloadBlob(blob, filename);
  return "downloaded";
}

export async function downloadUrlOrShare(url: string, filename?: string, options: DownloadShareOptions = {}) {
  if (shouldUseShare(options.isMobile)) {
    try {
      const response = await fetchDownloadUrl(url);
      const blob = await response.blob();
      const resolvedFilename = filename || getFilenameFromResponse(response) || getFilenameFromUrl(url) || "download";
      const shared = await shareBlob(blob, resolvedFilename, { ...options, fallbackUrl: options.fallbackUrl || url });
      if (shared === "shared" || shared === "cancelled") {
        return shared;
      }
    } catch (error) {
      if (!isShareAbort(error)) {
        throw error;
      }
      return "cancelled";
    }
  }

  downloadUrl(url, filename);
  return "downloaded";
}

async function fetchDownloadUrl(url: string) {
  if (url.startsWith("blob:") || url.startsWith("data:")) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("下载失败");
    }
    return response;
  }

  const response = await apiFetch(url, { credentials: "include" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    throw new Error(payload?.error || payload?.message || "下载失败");
  }
  return response;
}

function shouldUseShare(isMobile?: boolean) {
  if (typeof window === "undefined") {
    return false;
  }
  if (typeof isMobile === "boolean") {
    return isMobile;
  }
  return isMobileNativeRuntime() || window.matchMedia?.("(max-width: 900px)").matches;
}

async function shareBlob(blob: Blob, filename: string, options: DownloadShareOptions): Promise<ShareBlobResult> {
  const shareTitle = options.title || filename;
  const shareText = options.text || filename;
  const mimeType = blob.type || options.mimeType || "application/octet-stream";

  if (typeof navigator.share === "function" && typeof File !== "undefined") {
    const file = new File([blob], filename, { type: mimeType });
    if (canShareFiles([file])) {
      try {
        await navigator.share({ title: shareTitle, text: shareText, files: [file] });
        return "shared";
      } catch (error) {
        if (isShareAbort(error)) {
          return "cancelled";
        }
        throw error;
      }
    }
  }

  if (isAndroidNativeRuntime()) {
    const shared = await shareBlobWithNativePlugin(blob, filename, { ...options, mimeType });
    if (shared === "shared" || shared === "cancelled") {
      return shared;
    }
  }

  if (typeof navigator.share === "function" && options.fallbackUrl) {
    const fallbackUrl = normalizeShareUrl(options.fallbackUrl);
    try {
      await navigator.share({ title: shareTitle, text: shareText, url: fallbackUrl });
      return "shared";
    } catch (error) {
      if (isShareAbort(error)) {
        return "cancelled";
      }
      throw error;
    }
  }

  if (options.fallbackUrl) {
    return shareUrlWithCapacitorPlugin(options.fallbackUrl, shareTitle, shareText);
  }

  return "unsupported";
}

async function shareBlobWithNativePlugin(
  blob: Blob,
  filename: string,
  options: DownloadShareOptions,
): Promise<ShareBlobResult> {
  try {
    const safeFilename = sanitizeFilename(filename);
    const data = await blobToBase64(blob);
    await withTimeout(
      NativeFileSharePluginBridge.shareBase64File({
        base64Data: data,
        filename: safeFilename,
        mimeType: options.mimeType || blob.type || "application/octet-stream",
        title: options.title || filename,
        text: options.text || filename,
        dialogTitle: options.title || filename,
      }),
      20_000,
    );

    return "shared";
  } catch (error) {
    if (isShareAbort(error)) {
      return "cancelled";
    }
    console.warn("Native share failed, falling back to browser download", error);
    return "unsupported";
  }
}

async function shareUrlWithCapacitorPlugin(
  url: string,
  title: string,
  text: string,
): Promise<ShareBlobResult> {
  if (!isMobileNativeRuntime()) {
    return "unsupported";
  }

  try {
    const canShare = await Share.canShare().catch(() => ({ value: false }));
    if (!canShare.value) {
      return "unsupported";
    }
    await Share.share({
      title,
      text,
      url: normalizeShareUrl(url),
      dialogTitle: title,
    });
    return "shared";
  } catch (error) {
    if (isShareAbort(error)) {
      return "cancelled";
    }
    console.warn("Native URL share failed, falling back to browser download", error);
    return "unsupported";
  }
}

function canShareFiles(files: File[]) {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.canShare !== "function") {
    return true;
  }
  try {
    return nav.canShare({ files });
  } catch {
    return false;
  }
}

function isShareAbort(error: unknown) {
  return (
    (error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "NotAllowedError")) ||
    (error instanceof Error && /cancel/i.test(error.message))
  );
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.includes(",") ? result.split(",", 2)[1] : result);
    };
    reader.readAsDataURL(blob);
  });
}

function sanitizeFilename(filename: string) {
  const safeName = filename
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return safeName || "download";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Native share timed out")), timeoutMs);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function getFilenameFromResponse(response: Response) {
  const header = response.headers.get("content-disposition") || "";
  const encodedMatch = header.match(/filename\\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }
  const plainMatch = header.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] || "";
}

function getFilenameFromUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    const lastPart = parsed.pathname.split("/").filter(Boolean).pop();
    return lastPart ? decodeURIComponent(lastPart) : "";
  } catch {
    return "";
  }
}

function normalizeShareUrl(url: string) {
  if (/^https?:\/\//i.test(url)) {
    if (API_BASE && typeof window !== "undefined" && url.startsWith(window.location.origin)) {
      return `${API_BASE}${new URL(url).pathname}${new URL(url).search}`;
    }
    return url;
  }
  if (url.startsWith("/") && API_BASE) {
    return `${API_BASE}${url}`;
  }
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}
