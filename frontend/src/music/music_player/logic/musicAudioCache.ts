import { apiFetch } from "../../../js/apiFetch";
import { API_BASE } from "../../../js/apiBase";

export const PINNED_ALL_SONGS_AUDIO_CACHE_SCOPE = "all-songs-top-10";
export const QUEUE_NEXT_AUDIO_CACHE_SCOPE = "queue-next";

export type MusicAudioCacheTrackLike = {
  id: number;
  file_name?: string;
  file_size?: number;
  duration?: number | null;
  created_at?: string;
  accompaniment_file_name?: string | null;
  accompaniment_file_size?: number | null;
};

export type MusicAudioVariant = "vocal" | "accompaniment";

type WebAudioCacheEntry = {
  sourceUrl: string;
  playableUrl: string;
};

const MUSIC_AUDIO_CACHE_VERSION = "v1";
const webAudioCache = new Map<string, WebAudioCacheEntry>();
const pendingWebAudioCache = new Map<string, Promise<string>>();

export function buildMusicDownloadUrl(musicId: number, variant: MusicAudioVariant = "vocal") {
  if (variant === "accompaniment") {
    return `${API_BASE}/api/music/accompaniment/${musicId}`;
  }
  return `${API_BASE}/api/music/download/${musicId}`;
}

export function buildMusicAudioRevision(track: MusicAudioCacheTrackLike, variant: MusicAudioVariant = "vocal") {
  if (variant === "accompaniment") {
    return [
      track.id,
      "acc",
      track.accompaniment_file_name || "",
      String(track.accompaniment_file_size ?? ""),
    ].join(":");
  }
  return [
    track.id,
    track.file_name || "",
    String(track.file_size ?? ""),
    String(track.duration ?? ""),
    track.created_at || "",
  ].join(":");
}

export function buildMusicAudioCacheKey(
  scope: string,
  track: MusicAudioCacheTrackLike,
  variant: MusicAudioVariant = "vocal",
) {
  // Track cache is shared across stages so top-10 prewarm and queue-next
  // prewarm can reuse the same local file / blob instead of downloading twice.
  void scope;
  return `music-audio:${MUSIC_AUDIO_CACHE_VERSION}:${buildMusicAudioRevision(track, variant)}`;
}

export function getCachedMusicAudioUrl(
  track: MusicAudioCacheTrackLike,
  options: { scope?: string; variant?: MusicAudioVariant } = {},
) {
  const cacheKey = buildMusicAudioCacheKey(
    options.scope ?? PINNED_ALL_SONGS_AUDIO_CACHE_SCOPE,
    track,
    options.variant ?? "vocal",
  );
  return webAudioCache.get(cacheKey)?.playableUrl ?? null;
}

export async function warmMusicAudioTrack(
  track: MusicAudioCacheTrackLike,
  options: { scope?: string; variant?: MusicAudioVariant } = {},
) {
  const variant = options.variant ?? "vocal";
  const sourceUrl = buildMusicDownloadUrl(track.id, variant);
  const cacheKey = buildMusicAudioCacheKey(
    options.scope ?? PINNED_ALL_SONGS_AUDIO_CACHE_SCOPE,
    track,
    variant,
  );
  const cached = webAudioCache.get(cacheKey);
  if (cached && cached.sourceUrl === sourceUrl) {
    return cached.playableUrl;
  }

  const pending = pendingWebAudioCache.get(cacheKey);
  if (pending) {
    return pending;
  }

  const task = apiFetch(sourceUrl, {
    credentials: "include",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Audio prewarm failed with HTTP ${response.status}`);
      }
      const blob = await response.blob();
      if (!blob.size) {
        throw new Error("Audio prewarm returned an empty file");
      }

      const objectUrl = URL.createObjectURL(blob);
      const previous = webAudioCache.get(cacheKey);
      if (previous && previous.playableUrl !== objectUrl) {
        URL.revokeObjectURL(previous.playableUrl);
      }
      webAudioCache.set(cacheKey, {
        sourceUrl,
        playableUrl: objectUrl,
      });
      return objectUrl;
    })
    .finally(() => {
      pendingWebAudioCache.delete(cacheKey);
    });

  pendingWebAudioCache.set(cacheKey, task);
  return task;
}

export async function warmPinnedMusicAudioTracks(
  tracks: MusicAudioCacheTrackLike[],
  options: { scope?: string } = {},
) {
  const settled = await Promise.allSettled(
    tracks.map(async (track) => ({
      id: track.id,
      playableUrl: await warmMusicAudioTrack(track, options),
    })),
  );

  const warmed: Array<{ id: number; playableUrl: string }> = [];
  settled.forEach((result) => {
    if (result.status === "fulfilled") {
      warmed.push(result.value);
      return;
    }
    console.warn("Pinned web audio prewarm failed", result.reason);
  });
  return warmed;
}
