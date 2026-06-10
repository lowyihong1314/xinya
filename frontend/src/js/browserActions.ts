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
type ShareUrlResult = ShareBlobResult | "copied";

export async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  legacyCopyTextToClipboard(text);
}

export async function shareUrlOrCopy(url: string, title: string, text = title): Promise<ShareUrlResult> {
  const normalizedUrl = normalizeShareUrl(url);

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url: normalizedUrl });
      return "shared";
    } catch (error) {
      if (isShareAbort(error) && !isNotAllowedShareError(error)) {
        return "cancelled";
      }
      console.warn("Browser URL share failed, falling back to native plugin or copy", error);
    }
  }

  const nativeShared = await shareUrlWithCapacitorPlugin(normalizedUrl, title, text);
  if (nativeShared === "shared" || nativeShared === "cancelled") {
    return nativeShared;
  }

  await copyTextToClipboard(normalizedUrl);
  return "copied";
}

export function downloadUrl(url: string, filename?: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  if (filename) {
    anchor.download = filename;
  }
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => anchor.remove(), 0);
}

function legacyCopyTextToClipboard(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard API unavailable");
  }
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

function shouldUseShare(_isMobile?: boolean) {
  if (typeof window === "undefined") {
    return false;
  }
  return isMobileNativeRuntime();
}

async function shareBlob(blob: Blob, filename: string, options: DownloadShareOptions): Promise<ShareBlobResult> {
  const shareTitle = options.title || filename;
  const shareText = options.text || filename;
  const mimeType = blob.type || options.mimeType || "application/octet-stream";

  if (isAndroidNativeRuntime()) {
    const shared = await shareBlobWithNativePlugin(blob, filename, { ...options, mimeType });
    if (shared === "shared" || shared === "cancelled") {
      return shared;
    }
  }

  if (typeof navigator.share === "function" && typeof File !== "undefined") {
    const file = new File([blob], filename, { type: mimeType });
    if (canShareFiles([file])) {
      try {
        await navigator.share({ title: shareTitle, text: shareText, files: [file] });
        return "shared";
      } catch (error) {
        if (isUserShareCancel(error)) {
          return "cancelled";
        }
        console.warn("Browser file share failed, falling back to native plugin or download", error);
      }
    }
  }

  if (typeof navigator.share === "function" && options.fallbackUrl) {
    const fallbackUrl = normalizeShareUrl(options.fallbackUrl);
    try {
      await navigator.share({ title: shareTitle, text: shareText, url: fallbackUrl });
      return "shared";
    } catch (error) {
      if (isUserShareCancel(error)) {
        return "cancelled";
      }
      console.warn("Browser URL share failed, falling back to native plugin or download", error);
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
    if (isUserShareCancel(error)) {
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

function isUserShareCancel(error: unknown) {
  return isShareAbort(error) && !isNotAllowedShareError(error);
}

function isNotAllowedShareError(error: unknown) {
  return error instanceof DOMException && error.name === "NotAllowedError";
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
