import {
  DEFAULT_LOCAL_COVER_URL,
  resolveAlbumCoverCandidates as resolveBaseAlbumCoverCandidates,
} from "../shared/musicCoverSources";
import type { AlbumRecord, MusicRecord } from "./types";

export function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function formatMusicHeat(minutes?: number | null) {
  const safeMinutes = Math.max(0, Math.round(Number(minutes || 0)));
  if (!safeMinutes) return "0 分钟";
  if (safeMinutes < 60) return `${safeMinutes} 分钟`;
  const hours = Math.floor(safeMinutes / 60);
  const remain = safeMinutes % 60;
  return remain ? `${hours} 小时 ${remain} 分钟` : `${hours} 小时`;
}

export function resolveAlbumCoverUrl(source?: string | AlbumRecord | null): string {
  return resolveBaseAlbumCoverCandidates(source)[0] || DEFAULT_LOCAL_COVER_URL;
}

export function resolveAlbumCoverCandidatesForApk(source?: string | AlbumRecord | null): string[] {
  return resolveBaseAlbumCoverCandidates(source);
}

export function resolveMusicCoverUrl(music?: MusicRecord | null): string {
  return resolveMusicCoverCandidates(music)[0] || DEFAULT_LOCAL_COVER_URL;
}

export function resolveMusicCoverCandidates(music?: MusicRecord | null): string[] {
  if (!music) return resolveBaseAlbumCoverCandidates(null);
  if (music.album) return resolveBaseAlbumCoverCandidates(music.album);
  return resolveBaseAlbumCoverCandidates(music.cover_url || null);
}

export function resolveTrackAlbumName(music?: MusicRecord | null): string {
  return music?.album?.name?.trim() || "全部歌曲";
}

export function buildMusicCoverCacheKey(scope: string, id: number | string): string {
  return `music-cover:apk-native:v3:${scope}:${id}`;
}
