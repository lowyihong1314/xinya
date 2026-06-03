import { API_BASE } from "../../../js/apiBase";
import { NativeMediaCachePluginBridge } from "../../../mobile/native/mediaCachePlugin";
import {
  NativeMusicPluginBridge,
  type MusicSnapshotPayload,
  type NativeMusicListenerEvent,
} from "../../../mobile/native/musicPlugin";
import {
  buildMusicAudioCacheKey,
  buildMusicDownloadUrl,
  PINNED_ALL_SONGS_AUDIO_CACHE_SCOPE,
} from "../logic/musicAudioCache";
import type { MusicRecord, MusicSnapshot } from "./types";

const nativePlugin = NativeMusicPluginBridge;
const nativeMediaCache = NativeMediaCachePluginBridge;

export function normalizeMusicSnapshot(payload?: MusicSnapshotPayload | null): MusicSnapshot {
  return {
    albums: payload?.albums || [],
    musics: payload?.musics || [],
    queue: payload?.queue || [],
    currentMusic: payload?.currentMusic || null,
    currentMusicId: payload?.currentMusicId ?? payload?.currentMusic?.id ?? null,
    isPlaying: Boolean(payload?.isPlaying),
    hasPlaybackSession: Boolean(payload?.hasPlaybackSession),
    shuffleEnabled: Boolean(payload?.shuffleEnabled),
    repeatMode: payload?.repeatMode || "off",
    progressMs: Number(payload?.progressMs || 0),
    durationMs: Number(payload?.durationMs || 0),
    listeningTimezone: payload?.listeningTimezone || "Asia/Kuala_Lumpur",
    listeningSessions: payload?.listeningSessions || [],
    listeningTotalMinutes: Number(payload?.listeningTotalMinutes || 0),
    listeningUniqueListeners: Number(payload?.listeningUniqueListeners || 0),
  };
}

export const NativeApkMusic = {
  bootstrap(includeListening = false) {
    return nativePlugin
      .bootstrap({ baseUrl: API_BASE, includeListening })
      .then(normalizeMusicSnapshot);
  },
  refreshLibrary(includeListening = false) {
    return nativePlugin
      .refreshLibrary({ includeListening })
      .then(normalizeMusicSnapshot);
  },
  getSnapshot() {
    return nativePlugin.getSnapshot().then(normalizeMusicSnapshot);
  },
  async syncCachedTrackSources(tracks: MusicRecord[], options?: { scope?: string }) {
    const settled = await Promise.allSettled(
      tracks.map(async (track) => {
        const sourceUrl = buildMusicDownloadUrl(track.id);
        const result = await nativeMediaCache.cacheMedia({
          url: sourceUrl,
          cacheKey: buildMusicAudioCacheKey(
            options.scope ?? PINNED_ALL_SONGS_AUDIO_CACHE_SCOPE,
            track,
          ),
        });
        return {
          id: track.id,
          url: result.fileUri ? String(result.fileUri) : sourceUrl,
        };
      }),
    );

    const items: Array<{ id: number; url: string }> = [];
    settled.forEach((result) => {
      if (result.status === "fulfilled") {
        items.push(result.value);
        return;
      }
      console.warn("Pinned APK audio prewarm failed", result.reason);
    });

    await nativePlugin.setCachedTrackSources({ items });
  },
  playMusic(musicId: number, queueIds: number[]) {
    return nativePlugin.playMusic({ musicId, queueIds }).then(normalizeMusicSnapshot);
  },
  togglePlayback() {
    return nativePlugin.togglePlayback().then(normalizeMusicSnapshot);
  },
  appendToQueue(musicId: number) {
    return nativePlugin.appendToQueue({ musicId }).then(normalizeMusicSnapshot);
  },
  removeFromQueue(musicId: number) {
    return nativePlugin.removeFromQueue({ musicId }).then(normalizeMusicSnapshot);
  },
  clearQueue() {
    return nativePlugin.clearQueue().then(normalizeMusicSnapshot);
  },
  playFromQueue(musicId: number) {
    return nativePlugin.playFromQueue({ musicId }).then(normalizeMusicSnapshot);
  },
  playRelative(step: -1 | 1) {
    return nativePlugin.playRelative({ step }).then(normalizeMusicSnapshot);
  },
  toggleShuffle() {
    return nativePlugin.toggleShuffle().then(normalizeMusicSnapshot);
  },
  cycleRepeat() {
    return nativePlugin.cycleRepeat().then(normalizeMusicSnapshot);
  },
  seekTo(positionMs: number) {
    return nativePlugin.seekTo({ positionMs }).then(normalizeMusicSnapshot);
  },
  addListener(event: NativeMusicListenerEvent, listener: () => void) {
    return nativePlugin.addListener(event, listener);
  },
};
