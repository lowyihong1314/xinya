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
  has_accompaniment?: boolean;
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
  /** 伴奏模式（原生端持久化）。 */
  accompanimentMode: boolean;
  /** 一人一设备：本机设备 id / 名称（原生生成），以及是否已被其他设备接管而暂停。 */
  deviceId: string | null;
  deviceName: string;
  pausedByRemoteDevice: boolean;
  progressMs: number;
  durationMs: number;
  listeningTimezone: string;
  listeningSessions: ListeningSessionRecord[];
  listeningTotalMinutes: number;
  listeningUniqueListeners: number;
  /** Monotonic version of library/queue/current-track state (native side). */
  stateVersion: number;
  bufferedMs: number;
  isBuffering: boolean;
};

/**
 * Lightweight playback progress returned by the native `getProgress` bridge method.
 * Contains scalars only so it is cheap to poll at high frequency.
 */
export type MusicProgress = {
  positionMs: number;
  durationMs: number;
  bufferedPositionMs: number;
  isPlaying: boolean;
  isBuffering: boolean;
  currentMusicId: number | null;
  hasPlaybackSession: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  accompanimentMode: boolean;
  pausedByRemoteDevice: boolean;
  /** Same counter as `MusicSnapshot.stateVersion`; a change means a full snapshot is needed. */
  stateVersion: number;
};
