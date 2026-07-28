import type { DragEvent } from "react";

const MIME = "application/x-fs-paths";

export function writeDraggedPaths(event: DragEvent, paths: string[]) {
  event.dataTransfer.setData(MIME, JSON.stringify(paths));
  event.dataTransfer.setData("text/plain", paths[0] || "");
  event.dataTransfer.effectAllowed = "move";
}

export function readDraggedPaths(event: DragEvent): string[] {
  const json = event.dataTransfer.getData(MIME);
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) return parsed.filter((entry): entry is string => typeof entry === "string");
    } catch {
      // 落到 text/plain 兜底
    }
  }
  const plain = event.dataTransfer.getData("text/plain");
  return plain ? [plain] : [];
}

export function isExternalFileDrag(event: DragEvent) {
  return Array.from(event.dataTransfer.types).includes("Files");
}
