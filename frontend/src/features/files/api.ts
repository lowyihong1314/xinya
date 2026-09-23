/**
 * 文件系统。后端 backend/api/filesystem/router.py。
 */
import { http } from "@/shared/api/client";
import { API_ROOT } from "@/shared/config/env";

import type { DirectoryListing } from "./types";

export const fileKeys = {
  all: ["files"] as const,
  listing: (path: string) => [...fileKeys.all, "listing", path] as const,
};

/**
 * 列目录。
 * ★ 后端判的是 `"path" not in data` 而不是真值 —— 显式传 `{"path": ""}` 会通过，
 *   由 normalize_path 变成 "/"（根目录）。浏览根目录就靠这个行为，**别传 undefined**。
 */
export const listDirectory = (path: string) =>
  http.post<DirectoryListing>("/files/query", { path });

/** 文件内容直链（预览/下载）。用 API_ROOT，理由同 music 的音频直链。 */
export const fileContentUrl = (fileId: number) => `${API_ROOT}/files/items/${fileId}/content`;
