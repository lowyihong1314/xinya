/**
 * 歌本。后端 backend/api/songbook/router.py（挂载前缀 /songbook）。
 *
 * ⚠️ 前端页面地址也是 /songbook —— **不冲突**，因为后端没有 /songbook 这条路由
 *    （只有 /songbook/list、/songbook/entry/...）。见 src/app/routes.ts 的说明。
 *    但**不要**把页面地址起成 /songbook/list，那就真撞了。
 */
import { http } from "@/shared/api/client";

import type { SongDetailResponse, SongEntry, SongListResponse } from "./types";

export const songbookKeys = {
  all: ["songbook"] as const,
  list: (params: { q?: string; variant?: string; includeUnpublished?: boolean }) =>
    [...songbookKeys.all, "list", params] as const,
  entry: (id: number) => [...songbookKeys.all, "entry", id] as const,
};

export interface SongListParams {
  q?: string;
  variant?: string;
  /** 看未发布的歌需要 music_edit 权限；没权限时后端回 403 + 中文文案。 */
  includeUnpublished?: boolean;
}

export const fetchSongs = (params: SongListParams = {}) =>
  http.get<SongListResponse>("/music/songbook/list", {
    query: {
      q: params.q || undefined,
      variant: params.variant || undefined,
      // 后端只认 "1"/"true"/"yes"，传 false 会被当成真值（非空字符串），所以不传。
      include_unpublished: params.includeUnpublished ? "1" : undefined,
    },
  });

/** ⚠️ 详情接口返回的是 {"entry": {...}}，不是裸对象。这里剥掉外层，
 *  让调用方拿到的形状和列表里的一致 —— 两种形状会让页面代码到处分支。 */
export const fetchSong = async (id: number): Promise<SongEntry> =>
  (await http.get<SongDetailResponse>(`/music/songbook/entry/${id}`)).entry;

/** 保存"我的版本"（个人覆盖，不影响别人看到的内容）。 */
export const saveMyEdit = (id: number, content: string) =>
  http.post(`/music/songbook/entry/${id}/my_edit`, { content });

/** 删掉我的版本，回到原版。 */
export const deleteMyEdit = (id: number) => http.delete(`/music/songbook/entry/${id}/my_edit`);
