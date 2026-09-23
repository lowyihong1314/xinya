/**
 * 音乐域。后端 backend/api/music/（挂载前缀 /music）。
 *
 * v3 起歌本与唱游房间也在这个域下：
 *   /music/*              音频库
 *   /music/songbook/*     歌本   （见 songbook/api.ts）
 *   /music/rooms/*        唱游房间（见 rooms/api.ts）
 */
import { http } from "@/shared/api/client";
import { API_ROOT } from "@/shared/config/env";

import type { Album, MusicListResponse, Playlist, QueueDetailResponse } from "./types";

export const musicKeys = {
  all: ["music"] as const,
  list: (page: number, search: string, withAcc: boolean) =>
    [...musicKeys.all, "list", page, search, withAcc] as const,
  albums: () => [...musicKeys.all, "albums"] as const,
  playlists: () => [...musicKeys.all, "playlists"] as const,
  playlist: (id: number) => [...musicKeys.all, "playlist", id] as const,
  queue: () => [...musicKeys.all, "queue"] as const,
};

/**
 * 曲目列表。
 * ★ 默认**不含伴奏** —— 伴奏不是独立作品，混进「全部歌曲」会凭空多出一批
 *   重复歌名，加入歌单/队列时也容易误选。伴奏管理界面才传 includeAccompaniments。
 */
export const fetchMusics = (page = 1, search = "", includeAccompaniments = false) =>
  http.get<MusicListResponse>("/music/list", {
    query: {
      page,
      search: search || undefined,
      // 后端只认字面量 "1"/"true"/"yes"，传 false 会被当成非空字符串 → 真值
      include_accompaniments: includeAccompaniments ? "1" : undefined,
    },
  });

export const fetchAlbums = () => http.get<Album[]>("/music/albums");

/**
 * 音频直链。
 * ★ 不用 http 客户端读进内存再造 blob URL：一个歌单几十 MB，而且丢掉 Range
 *   请求（拖进度条要靠它）。直接交给 <audio src>，让浏览器自己分段请求。
 * ★ 必须用 API_ROOT（origin + BASE_PATH）：APK 里裸路径会去找
 *   capacitor://localhost/music/…，永远 404。
 */
export const musicStreamUrl = (id: number) => `${API_ROOT}/music/download/${id}`;

/** 播放满一分钟上报一次。后端据此累计 play_minutes。 */
export const reportOneMinute = (id: number) => http.post(`/music/add_one_minute/${id}`);

// ─────────────────────────── 歌单（我的列表）───────────────────────────

export const fetchPlaylists = () => http.get<Playlist[]>("/music/playlists");
export const fetchPlaylist = (id: number) => http.get<Playlist>(`/music/playlist/${id}`);

export const createPlaylist = (name: string, musicIds: number[] = []) =>
  http.post<Playlist>("/music/playlist", { name, music_ids: musicIds });

export const savePlaylist = (id: number, payload: { name?: string; music_ids?: number[] }) =>
  http.post(`/music/playlist/${id}`, payload);

export const deletePlaylist = (id: number) => http.delete(`/music/playlist/${id}`);

// ─────────────────────────── 播放队列 ───────────────────────────

export const fetchQueue = () => http.get<QueueDetailResponse>("/music/queue/detail");

/** position="next" 插到当前播放的下一首，默认追加到队尾。 */
export const addToQueue = (musicIds: number | number[], position: "end" | "next" = "end") =>
  http.post("/music/queue/add", {
    music_ids: Array.isArray(musicIds) ? musicIds : [musicIds],
    position,
  });

/** ★ 按**下标**移除，不是按 music_id —— 同一首可以在队列里出现多次。 */
export const removeFromQueue = (index: number) => http.post("/music/queue/remove", { index });

export const clearQueue = () => http.post("/music/queue/clear");

/** 拖动排序后整份重排。后端只接受同一批 id，否则 409（队列在别处被改过）。 */
export const reorderQueue = (queueIds: number[]) =>
  http.post("/music/queue/reorder", { queue_ids: queueIds });

// ─────────────────────────── 伴奏（1 对 1）───────────────────────────

/** 指定某首曲目为 musicId 的伴奏。需要 music_edit 权限。 */
export const setAccompaniment = (musicId: number, accompanimentId: number) =>
  http.post(`/music/tracks/${musicId}/accompaniment`, { accompaniment_id: accompanimentId });

export const clearAccompaniment = (musicId: number) =>
  http.delete(`/music/tracks/${musicId}/accompaniment`);
