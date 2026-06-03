import type { AlbumRecord, MusicRecord, RepeatMode } from "../../music/music_player/apk/types";
import type { ListeningSessionRecord } from "../../music/music_player/ui/shared/listeningActivityShared";
import { resolveNativePlugin } from "./capacitor";

export type NativeMusicListenerEvent = "trackChanged" | "trackEnded" | "playStateChanged";

export type NativeMusicListenerHandle = {
  remove: () => Promise<void> | void;
};

export type MusicSnapshotPayload = {
  albums?: AlbumRecord[];
  musics?: MusicRecord[];
  queue?: MusicRecord[];
  currentMusic?: MusicRecord | null;
  currentMusicId?: number | null;
  isPlaying?: boolean;
  hasPlaybackSession?: boolean;
  shuffleEnabled?: boolean;
  repeatMode?: RepeatMode;
  progressMs?: number;
  durationMs?: number;
  listeningTimezone?: string;
  listeningSessions?: ListeningSessionRecord[];
  listeningTotalMinutes?: number;
  listeningUniqueListeners?: number;
};

export interface NativeMusicPlugin {
  bootstrap(options: { baseUrl: string; includeListening?: boolean }): Promise<MusicSnapshotPayload>;
  refreshLibrary(options?: { includeListening?: boolean }): Promise<MusicSnapshotPayload>;
  getSnapshot(): Promise<MusicSnapshotPayload>;
  setCachedTrackSources(options: { items: Array<{ id: number; url: string }> }): Promise<void>;
  playMusic(options: { musicId: number; queueIds: number[] }): Promise<MusicSnapshotPayload>;
  togglePlayback(): Promise<MusicSnapshotPayload>;
  appendToQueue(options: { musicId: number }): Promise<MusicSnapshotPayload>;
  removeFromQueue(options: { musicId: number }): Promise<MusicSnapshotPayload>;
  clearQueue(): Promise<MusicSnapshotPayload>;
  playFromQueue(options: { musicId: number }): Promise<MusicSnapshotPayload>;
  playRelative(options: { step: -1 | 1 }): Promise<MusicSnapshotPayload>;
  toggleShuffle(): Promise<MusicSnapshotPayload>;
  cycleRepeat(): Promise<MusicSnapshotPayload>;
  seekTo(options: { positionMs: number }): Promise<MusicSnapshotPayload>;
  addListener(
    event: NativeMusicListenerEvent,
    listener: () => void,
  ): Promise<NativeMusicListenerHandle>;
}

function createUnavailablePlugin(): NativeMusicPlugin {
  const reject = async () => {
    throw new Error("NativeMusic plugin is unavailable in this runtime");
  };
  return {
    bootstrap: reject,
    refreshLibrary: reject,
    getSnapshot: reject,
    setCachedTrackSources: reject,
    playMusic: reject,
    togglePlayback: reject,
    appendToQueue: reject,
    removeFromQueue: reject,
    clearQueue: reject,
    playFromQueue: reject,
    playRelative: reject,
    toggleShuffle: reject,
    cycleRepeat: reject,
    seekTo: reject,
    addListener: async () => ({ remove: () => undefined }),
  };
}

function isNativeMusicPlugin(value: unknown): value is NativeMusicPlugin {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as NativeMusicPlugin).bootstrap === "function" &&
      typeof (value as NativeMusicPlugin).getSnapshot === "function" &&
      typeof (value as NativeMusicPlugin).setCachedTrackSources === "function" &&
      typeof (value as NativeMusicPlugin).togglePlayback === "function",
  );
}

export const NativeMusicPluginBridge = resolveNativePlugin<NativeMusicPlugin>(
  "NativeMusic",
  isNativeMusicPlugin,
  createUnavailablePlugin,
);
