import {
  DEFAULT_LOCAL_COVER_URL,
  resolveAlbumCoverCandidates,
} from "../shared/musicCoverSources";
import type { AlbumRecord, MusicRecord } from "./types";

const MUSIC_COVER_CACHE_VERSION = "album-cover-api-v2";

/**
 * Default cover image shown when no album/track cover is available.
 */
export const DEFAULT_COVER_URL = DEFAULT_LOCAL_COVER_URL;

export function resolveAlbumCoverUrl(source?: string | { cover_url?: string | null; image?: string | null } | null): string {
  return resolveAlbumCoverCandidates(source)[0] || DEFAULT_COVER_URL;
}

function findTrackAlbum(musicId: number, musics: MusicRecord[], albums: AlbumRecord[]): AlbumRecord | null {
  const albumId = musics.find((music) => music.id === musicId)?.album_id;
  if (albumId == null) return null;
  return albums.find((album) => album.id === albumId) ?? null;
}

/**
 * Resolves a track's artwork by first locating the track in the global music
 * list, then finding its album in the global album list.
 */
export function resolveTrackCoverUrl(musicId: number, musics: MusicRecord[], albums: AlbumRecord[]): string {
  return resolveAlbumCoverUrl(findTrackAlbum(musicId, musics, albums));
}

export function resolveTrackCoverCandidates(musicId: number, musics: MusicRecord[], albums: AlbumRecord[]): string[] {
  return resolveAlbumCoverCandidates(findTrackAlbum(musicId, musics, albums));
}

export function resolveMusicCoverUrl(
  music?: MusicRecord | null,
  musics: MusicRecord[] = [],
  albums: AlbumRecord[] = [],
): string {
  return resolveMusicCoverCandidates(music, musics, albums)[0] || DEFAULT_COVER_URL;
}

export function resolveMusicCoverCandidates(
  music?: MusicRecord | null,
  musics: MusicRecord[] = [],
  albums: AlbumRecord[] = [],
): string[] {
  if (!music) return resolveAlbumCoverCandidates(null);
  if (music.album) {
    return resolveAlbumCoverCandidates(music.album);
  }
  if (music.album_id != null && (musics.length > 0 || albums.length > 0)) {
    return resolveTrackCoverCandidates(music.id, musics, albums);
  }
  if (music.cover_url) {
    return resolveAlbumCoverCandidates(music.cover_url);
  }
  return resolveAlbumCoverCandidates(null);
}

export function resolveTrackAlbumName(musicId: number, musics: MusicRecord[], albums: AlbumRecord[]): string {
  return findTrackAlbum(musicId, musics, albums)?.name ?? "";
}

export function buildMusicCoverCacheKey(scope: string, id: number | string): string {
  return `music-cover:${MUSIC_COVER_CACHE_VERSION}:${scope}:${id}`;
}
