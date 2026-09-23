/**
 * 音乐库。后端 backend/api/music/router.py（挂载前缀 /music）。
 */
import { http } from "@/shared/api/client";
import { API_ROOT } from "@/shared/config/env";

import type { Album, MusicListResponse } from "./types";

export const musicKeys = {
  all: ["music"] as const,
  list: (page: number, search: string) => [...musicKeys.all, "list", page, search] as const,
  albums: () => [...musicKeys.all, "albums"] as const,
};

export const fetchMusics = (page = 1, search = "") =>
  http.get<MusicListResponse>("/music/list", {
    query: { page, search: search || undefined },
  });

export const fetchAlbums = () => http.get<Album[]>("/music/albums");

/**
 * 音频直链。
 *
 * ★ 不用 http 客户端把文件读进内存再造 blob URL：一首歌几 MB、一个歌单几十首，
 *   内存会被打爆，而且丢掉了 **Range 请求**（拖进度条要靠它）。
 *   直接把地址交给 <audio src>，让浏览器自己做分段请求和缓存。
 * ★ 必须用 API_ROOT（origin + BASE_PATH）：APK 里裸路径会去找
 *   capacitor://localhost/music/...，永远 404。
 */
export const musicStreamUrl = (id: number) => `${API_ROOT}/music/download/${id}`;

/** 播放满一分钟上报一次。后端据此累计 play_minutes。 */
export const reportOneMinute = (id: number) => http.post(`/music/add_one_minute/${id}`);
