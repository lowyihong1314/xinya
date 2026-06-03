import { downloadBlobOrShare } from "../../../js/browserActions";

export const itemsPerPage = 40;

export function joinPath(base: string, segment: string) {
  if (base === "/") return `/${segment.replace(/^\/+/, "")}`;
  return `${base}/${segment.replace(/^\/+/, "")}`;
}

export function formatBytes(size: number) {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export function triggerDownload(blob: Blob, filename: string, isMobile = false) {
  return downloadBlobOrShare(blob, filename, {
    isMobile,
    title: filename,
    text: filename,
  });
}
