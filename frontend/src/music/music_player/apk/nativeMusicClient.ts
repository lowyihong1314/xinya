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
import type { MusicProgress, MusicRecord, MusicSnapshot, RepeatMode } from "./types";

/** Payload of the native "snapshotChanged" event. */
export type NativeMusicSnapshotChangedEvent = {
  reason?: string;
  version?: number;
};

export type NativeMusicProgressPayload = {
  positionMs?: number;
  durationMs?: number;
  bufferedPositionMs?: number;
  isPlaying?: boolean;
  isBuffering?: boolean;
  currentTrackId?: number;
  currentMusicId?: number | null;
  hasPlaybackSession?: boolean;
  shuffleEnabled?: boolean;
  repeatMode?: RepeatMode;
  accompanimentMode?: boolean;
  pausedByRemoteDevice?: boolean;
  stateVersion?: number;
};

type NativeMusicSnapshotPayloadExt = MusicSnapshotPayload & {
  stateVersion?: number;
  bufferedMs?: number;
  isBuffering?: boolean;
};

/**
 * Bridge methods/events added on top of the shared `NativeMusicPlugin` interface.
 * The Capacitor proxy forwards any method name, so these resolve at runtime on the
 * APK; the optional typing keeps older shared interface definitions compatible.
 */
type NativeMusicPluginExt = typeof NativeMusicPluginBridge & {
  getProgress?: () => Promise<NativeMusicProgressPayload>;
  addListener(
    event: NativeMusicListenerEvent | "snapshotChanged",
    listener: (payload?: NativeMusicSnapshotChangedEvent) => void,
  ): Promise<{ remove: () => Promise<void> | void }>;
};

const nativePlugin = NativeMusicPluginBridge as NativeMusicPluginExt;
const nativeMediaCache = NativeMediaCachePluginBridge;

export function normalizeMusicProgress(payload?: NativeMusicProgressPayload | null): MusicProgress {
  const rawCurrentMusicId =
    payload?.currentMusicId ??
    (typeof payload?.currentTrackId === "number" && payload.currentTrackId > 0
      ? payload.currentTrackId
      : null);
  return {
    positionMs: Number(payload?.positionMs || 0),
    durationMs: Number(payload?.durationMs || 0),
    bufferedPositionMs: Number(payload?.bufferedPositionMs || 0),
    isPlaying: Boolean(payload?.isPlaying),
    isBuffering: Boolean(payload?.isBuffering),
    currentMusicId: rawCurrentMusicId == null ? null : Number(rawCurrentMusicId),
    hasPlaybackSession: Boolean(payload?.hasPlaybackSession),
    shuffleEnabled: Boolean(payload?.shuffleEnabled),
    repeatMode: payload?.repeatMode || "off",
    accompanimentMode: Boolean(payload?.accompanimentMode),
    pausedByRemoteDevice: Boolean(payload?.pausedByRemoteDevice),
    stateVersion: Number(payload?.stateVersion || 0),
  };
}

export function progressFromSnapshot(snapshot: MusicSnapshot): MusicProgress {
  return {
    positionMs: snapshot.progressMs,
    durationMs: snapshot.durationMs,
    bufferedPositionMs: snapshot.bufferedMs,
    isPlaying: snapshot.isPlaying,
    isBuffering: snapshot.isBuffering,
    currentMusicId: snapshot.currentMusicId,
    hasPlaybackSession: snapshot.hasPlaybackSession,
    shuffleEnabled: snapshot.shuffleEnabled,
    repeatMode: snapshot.repeatMode,
    accompanimentMode: snapshot.accompanimentMode,
    pausedByRemoteDevice: snapshot.pausedByRemoteDevice,
    stateVersion: snapshot.stateVersion,
  };
}

export function normalizeMusicSnapshot(payload?: NativeMusicSnapshotPayloadExt | null): MusicSnapshot {
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
    accompanimentMode: Boolean(payload?.accompanimentMode),
    deviceId: payload?.deviceId ? String(payload.deviceId) : null,
    deviceName: payload?.deviceName ? String(payload.deviceName) : "Android 手机",
    pausedByRemoteDevice: Boolean(payload?.pausedByRemoteDevice),
    progressMs: Number(payload?.progressMs || 0),
    durationMs: Number(payload?.durationMs || 0),
    listeningTimezone: payload?.listeningTimezone || "Asia/Kuala_Lumpur",
    listeningSessions: payload?.listeningSessions || [],
    listeningTotalMinutes: Number(payload?.listeningTotalMinutes || 0),
    listeningUniqueListeners: Number(payload?.listeningUniqueListeners || 0),
    stateVersion: Number(payload?.stateVersion || 0),
    bufferedMs: Number(payload?.bufferedMs || 0),
    isBuffering: Boolean(payload?.isBuffering),
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
  /**
   * Cheap scalar-only progress poll. Falls back to the full snapshot on runtimes
   * whose native plugin predates `getProgress`.
   */
  getProgress(): Promise<MusicProgress> {
    if (typeof nativePlugin.getProgress === "function") {
      return nativePlugin.getProgress().then(normalizeMusicProgress);
    }
    return nativePlugin.getSnapshot().then((payload) => progressFromSnapshot(normalizeMusicSnapshot(payload)));
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
  takeOverPlayback() {
    if (typeof nativePlugin.takeOverPlayback !== "function") {
      return Promise.reject(new Error("当前 APP 版本不支持切设备，请更新"));
    }
    return nativePlugin.takeOverPlayback().then(normalizeMusicSnapshot);
  },
  pause() {
    if (typeof nativePlugin.pause !== "function") {
      return nativePlugin.togglePlayback().then(normalizeMusicSnapshot);
    }
    return nativePlugin.pause().then(normalizeMusicSnapshot);
  },
  resume() {
    if (typeof nativePlugin.resume !== "function") {
      return nativePlugin.togglePlayback().then(normalizeMusicSnapshot);
    }
    return nativePlugin.resume().then(normalizeMusicSnapshot);
  },
  toggleAccompanimentMode() {
    if (typeof nativePlugin.toggleAccompanimentMode !== "function") {
      return Promise.reject(new Error("当前 APP 版本不支持伴奏模式，请更新"));
    }
    return nativePlugin.toggleAccompanimentMode().then(normalizeMusicSnapshot);
  },
  seekTo(positionMs: number) {
    return nativePlugin.seekTo({ positionMs }).then(normalizeMusicSnapshot);
  },
  addListener(event: NativeMusicListenerEvent, listener: () => void) {
    return nativePlugin.addListener(event, listener);
  },
  /** Fired by the native side whenever library / queue / current track / modes change. */
  addSnapshotChangedListener(listener: (payload?: NativeMusicSnapshotChangedEvent) => void) {
    return nativePlugin.addListener("snapshotChanged", listener);
  },
};
