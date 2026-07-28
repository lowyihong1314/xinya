export * from "../react/api";

import { apiFetch } from "../../../js/apiFetch";
import type { BatchDeleteItem, BatchDeleteResult, SearchResult } from "./types";

async function parseJson(response: Response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || data.message || "请求失败");
  }
  return data;
}

export async function searchFiles(q: string, limit = 100): Promise<SearchResult> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  const response = await apiFetch(`/api/files/search?${params}`);
  return parseJson(response);
}

export async function batchDelete(items: BatchDeleteItem[]): Promise<BatchDeleteResult> {
  const response = await apiFetch("/api/files/items/batch_delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  return parseJson(response);
}

export async function purgeTrash(trashId: number) {
  const response = await apiFetch(`/api/files/trash/${trashId}`, { method: "DELETE" });
  return parseJson(response);
}

export async function purgeAllTrash(): Promise<{ success: boolean; purged: number }> {
  const response = await apiFetch("/api/files/trash", { method: "DELETE" });
  return parseJson(response);
}

export type DirectoryDetail = {
  name: string;
  path: string;
  created_at?: string | null;
  updated_at?: string | null;
  file_count: number;
  total_size: number;
  sub_dir_count: number;
  sub_dirs: string[];
};

export async function fetchDirectoryDetail(path: string): Promise<DirectoryDetail> {
  const response = await apiFetch(`/api/files/directories/detail?path=${encodeURIComponent(path)}`);
  return parseJson(response);
}

export async function fetchFileBlob(fileId: number): Promise<Blob> {
  const response = await apiFetch(`/api/files/items/${fileId}/content`);
  if (!response.ok) {
    let message = "文件加载失败";
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {
      // 保留默认消息
    }
    throw new Error(message);
  }
  return response.blob();
}
