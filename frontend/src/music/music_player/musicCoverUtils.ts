import { API_BASE } from "../../js/apiBase";

/**
 * Default cover image used when an album or track has no cover.
 * Points to the server-side static fallback image.
 */
export const DEFAULT_COVER_URL = `${API_BASE}/static/album_image/defult.jpeg`;

/**
 * Resolves an album or track cover URL, always returning a valid image URL.
 * - Empty / null  → returns DEFAULT_COVER_URL
 * - Absolute URL  → returned as-is
 * - Relative path → prepends API_BASE (required for APK where WebView is on https://localhost/)
 */
export function resolveAlbumCoverUrl(path?: string | null): string {
  if (!path) return DEFAULT_COVER_URL;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}
