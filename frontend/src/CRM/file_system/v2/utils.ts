export { errorMessage, formatBytes, joinPath, triggerDownload } from "../react/utils";

import type { DirTreeNode, SelectableItem, SortState } from "./types";

export const LOAD_MORE_STEP = 60;

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "heic", "heif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "wma"]);
const TEXT_EXTENSIONS = new Set(["txt", "md", "json", "csv", "log", "xml", "yml", "yaml", "ini", "py", "js", "ts", "html", "css"]);

export function fileExtension(name: string) {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index + 1).toLowerCase();
}

export type PreviewKind = "image" | "heic" | "video" | "audio" | "pdf" | "text" | null;

export function previewKind(name: string): PreviewKind {
  const ext = fileExtension(name);
  if (ext === "heic" || ext === "heif") return "heic";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return null;
}

export function isPreviewable(name: string) {
  return previewKind(name) !== null;
}

export function fileIcon(item: { type: "file" | "dir"; name: string }) {
  if (item.type === "dir") return "fa-solid fa-folder";
  const ext = fileExtension(item.name);
  if (IMAGE_EXTENSIONS.has(ext)) return "fa-solid fa-file-image";
  if (VIDEO_EXTENSIONS.has(ext)) return "fa-solid fa-file-video";
  if (AUDIO_EXTENSIONS.has(ext)) return "fa-solid fa-file-audio";
  if (ext === "pdf") return "fa-solid fa-file-pdf";
  if (["doc", "docx"].includes(ext)) return "fa-solid fa-file-word";
  if (["xls", "xlsx", "csv"].includes(ext)) return "fa-solid fa-file-excel";
  if (["ppt", "pptx"].includes(ext)) return "fa-solid fa-file-powerpoint";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "fa-solid fa-file-zipper";
  if (TEXT_EXTENSIONS.has(ext)) return "fa-solid fa-file-lines";
  return "fa-solid fa-file";
}

export function sortItems(items: SelectableItem[], sort: SortState): SelectableItem[] {
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    // 目录恒排文件前
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    let result = 0;
    if (sort.key === "name") {
      result = a.name.localeCompare(b.name, "zh-Hans-CN");
    } else if (sort.key === "size") {
      result = (sizeOf(a) ?? 0) - (sizeOf(b) ?? 0);
    } else if (sort.key === "updated_at") {
      result = (updatedOf(a) ?? "").localeCompare(updatedOf(b) ?? "");
    } else if (sort.key === "owner") {
      result = (ownerOf(a) ?? "").localeCompare(ownerOf(b) ?? "", "zh-Hans-CN");
    }
    if (result === 0) {
      result = a.name.localeCompare(b.name, "zh-Hans-CN");
    }
    return result * factor;
  });
}

function sizeOf(item: SelectableItem) {
  return "size" in item ? item.size ?? null : null;
}

function updatedOf(item: SelectableItem) {
  return "updated_at" in item ? item.updated_at ?? null : null;
}

function ownerOf(item: SelectableItem) {
  return "owner" in item ? item.owner ?? null : null;
}

export function buildDirTree(paths: string[]): DirTreeNode[] {
  const roots: DirTreeNode[] = [];
  const byPath = new Map<string, DirTreeNode>();
  const sorted = [...paths].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  for (const path of sorted) {
    const normalized = path.replace(/\/+$/, "");
    if (!normalized || normalized === "/") continue;
    const segments = normalized.split("/").filter(Boolean);
    let parentPath = "";
    for (const segment of segments) {
      const nodePath = `${parentPath}/${segment}`;
      if (!byPath.has(nodePath)) {
        const node: DirTreeNode = { name: segment, path: nodePath, children: [] };
        byPath.set(nodePath, node);
        if (parentPath === "") {
          roots.push(node);
        } else {
          byPath.get(parentPath)?.children.push(node);
        }
      }
      parentPath = nodePath;
    }
  }
  return roots;
}

export function isDescendantPath(parent: string, candidate: string) {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parentPathOf(path: string) {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index <= 0 ? "/" : trimmed.slice(0, index);
}
