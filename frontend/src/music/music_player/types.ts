export type AlbumRecord = {
  id: number;
  name: string;
  cover_url?: string | null;
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

export type PlaylistRecord = {
  id: number;
  name: string;
  description?: string | null;
  user_id?: number | null;
  created_at?: string;
  updated_at?: string;
  musics?: MusicRecord[];
};
