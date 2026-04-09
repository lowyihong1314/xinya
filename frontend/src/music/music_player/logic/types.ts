export type AlbumRecord = {
  id: number;
  name: string;
  cover_url?: string | null;
  image?: string | null;
  album_total_minutes?: number | null;
  description?: string | null;
  created_at?: string;
  music_list?: MusicRecord[];
};

export type MusicRecord = {
  id: number;
  title: string;
  album_id?: number | null;
  artist_id?: number | null;
  file_name?: string;
  file_type?: string;
  file_size?: number;
  duration?: number | null;
  cover_url?: string | null;
  play_minutes?: number | null;
  created_at?: string;
  album?: AlbumRecord | null;
};

export type MinuteLogRecord = {
  id: number;
  created_at?: string | null;
  music_user_play_minute_id?: number | null;
  music_id?: number | null;
  music_title?: string | null;
  user_id?: number | null;
  username?: string | null;
  display_name?: string | null;
};

export type MinuteLogsResponse = {
  items?: MinuteLogRecord[];
  page?: number;
  per_page?: number;
  total?: number;
  total_pages?: number;
  timezone?: string;
};

export type LastPlayedMusicRecord = {
  music_user_play_minute_id?: number | null;
  music_id?: number | null;
  music_title?: string | null;
  user_id?: number | null;
  username?: string | null;
  display_name?: string | null;
  play_minutes?: number | null;
  played_at?: string | null;
};

export type LastPlayedMusicResponse = {
  last_played?: LastPlayedMusicRecord | null;
  timezone?: string;
};

export type PlaylistRecord = {
  id: number;
  name: string;
  description?: string | null;
  user_id?: number | null;
  created_at?: string;
  updated_at?: string;
  musics?: MusicRecord[];
};
