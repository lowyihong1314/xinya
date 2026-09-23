/**
 * 音乐域的数据形状。后端 backend/api/music/（音频库 + 歌本 + 唱游房间）。
 * /music/list 与 /music/detail/{id} 用 api-shape.mjs 实测过。
 */

export interface Album {
  id: number;
  name?: string | null;
  cover_url?: string | null;
  [key: string]: unknown;
}

export interface Music {
  id: number;
  title: string;
  album_id: number | null;
  artist_id: number | null;
  file_name: string;
  file_type: string;
  file_size: number;
  /** 秒。后端可能给 null（没探测出来），播放器要能容忍。 */
  duration: number | null;
  cover_url: string | null;
  /** 累计播放分钟数。播放时每满一分钟调一次 /music/add_one_minute/{id}。 */
  play_minutes: number;
  created_at: string;
  album?: Album | null;

  // ── 伴奏（1 对 1，DB 唯一约束强制）────────────────────────────
  /** 我的伴奏是谁。有值 → 播放器显示「切伴奏」。 */
  accompaniment_id: number | null;
  /** 我是谁的伴奏。有值 → 我本身是一条伴奏。 */
  accompaniment_of_id: number | null;
  is_accompaniment: boolean;

  [key: string]: unknown;
}

export interface MusicListResponse {
  musics: Music[];
  page: number;
  total_pages: number;
  total: number;
}

export interface Playlist {
  id: number;
  name: string;
  user_id: number | null;
  cover_url: string | null;
  description: string | null;
  created_at: string;
  /** 歌单是**有序**的（后端 playlist_music.position）。 */
  music_ids: number[];
  [key: string]: unknown;
}

export interface QueueState {
  id: number;
  user_id: number;
  /** 有序的曲目 id。同一首可以出现多次 —— 有人就是想连着听两遍。 */
  queue_ids: number[];
  current_music_id: number | null;
  [key: string]: unknown;
}

/** 队列 + 每首歌的完整信息，一次拿全（避免按 id 发 N 次请求）。 */
export interface QueueDetailResponse {
  queue: QueueState | null;
  items: Music[];
}
