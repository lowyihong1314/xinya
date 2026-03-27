import { API_BASE } from "../../js/apiBase";
import type { AlbumRecord, MusicRecord } from "./types";

/**
 * Default cover image shown when no album/track cover is available.
 */
export const DEFAULT_COVER_URL = `${API_BASE}/static/album_image/defult.jpeg`;

/**
 * Builds the URL for an album cover image.
 *
 * cover_url in the database may be stored in different formats depending on
 * when it was uploaded:
 *   - Full relative path: "/static/album_image/3.jpg"
 *   - Filename only:      "3.jpg"
 *   - Absolute URL:       "https://..."
 *
 * This function always extracts just the filename and constructs a canonical
 * URL from the known static path, so it works regardless of the stored format.
 */
export function resolveAlbumCoverUrl(coverUrl?: string | null): string {
  if (!coverUrl) return DEFAULT_COVER_URL;
  // Already an absolute URL — use as-is.
  if (/^https?:\/\//i.test(coverUrl)) return coverUrl;
  // Extract filename from whatever path format is stored, then build canonical URL.
  const filename = coverUrl.split("/").pop();
  if (!filename) return DEFAULT_COVER_URL;
  return `${API_BASE}/static/album_image/${filename}`;
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
  return resolveAlbumCoverUrl(findTrackAlbum(musicId, musics, albums)?.cover_url);
}

export function resolveTrackAlbumName(musicId: number, musics: MusicRecord[], albums: AlbumRecord[]): string {
  return findTrackAlbum(musicId, musics, albums)?.name ?? "";
}
