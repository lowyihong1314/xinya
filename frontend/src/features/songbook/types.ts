/** 后端 /songbook/* 的数据形状。见 backend/api/songbook/router.py。 */

export interface SongEntry {
  id: number;
  song_number: number | null;
  title: string;
  title_normalized: string;
  /** 同一首歌的不同版本（C 调、G 调…）。 */
  variant: string | null;
  heading_text: string | null;
  original_key: string | null;
  selected_key: string | null;
  bpm: number | null;
  time_signature: string | null;
  source_doc: string | null;
  published: boolean;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
  /** 当前生效的版本内容（正文）。列表接口里可能为空，详情接口才有。 */
  active_version: string | null;
  active_version_label: string | null;
  active_editor_user_id: number | null;
  active_editor_name: string | null;
  /** 我自己是否改过这首歌（个人版覆盖）。 */
  has_user_override: boolean;
  user_override_updated_at: string | null;
  [key: string]: unknown;
}

export interface SongListResponse {
  entries: SongEntry[];
}

/** 详情接口把内容包在 entry 里，不是裸对象 —— 别按列表的形状猜。 */
export interface SongDetailResponse {
  entry: SongEntry;
}
