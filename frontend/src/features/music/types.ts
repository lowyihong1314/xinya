/** 后端 /music/* 的数据形状。用 api-shape.mjs 实测过 /music/list 与 /music/albums。 */

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
  [key: string]: unknown;
}

export interface MusicListResponse {
  musics: Music[];
  page: number;
  total_pages: number;
  total: number;
}
