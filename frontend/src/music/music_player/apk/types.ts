import type { ListeningSessionRecord } from "../ui/shared/listeningActivityShared";

export type RepeatMode = "off" | "all" | "one";

export type AlbumRecord = {
  id: number;
  name: string;
  cover_url?: string | null;
  image?: string | null;
  album_total_minutes?: number | null;
  description?: string | null;
  created_at?: string;
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

export type MusicSnapshot = {
  albums: AlbumRecord[];
  musics: MusicRecord[];
  queue: MusicRecord[];
  currentMusic: MusicRecord | null;
  currentMusicId: number | null;
  isPlaying: boolean;
  hasPlaybackSession: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  progressMs: number;
  durationMs: number;
  listeningTimezone: string;
  listeningSessions: ListeningSessionRecord[];
  listeningTotalMinutes: number;
  listeningUniqueListeners: number;
};
