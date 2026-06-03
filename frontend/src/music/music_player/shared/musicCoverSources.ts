import { API_BASE } from "../../../js/apiBase";

export type MusicCoverSource =
  | string
  | {
      cover_url?: string | null;
      image?: string | null;
    }
  | null
  | undefined;

const REMOTE_COVER_ROOT = "https://utbabuddha.com/api/music/album_cover";
const LOCAL_COVER_ROOT = `${API_BASE}/api/music/album_cover`;

export const DEFAULT_REMOTE_COVER_URL = `${REMOTE_COVER_ROOT}/defult.jpeg`;
export const DEFAULT_LOCAL_COVER_URL = `${LOCAL_COVER_ROOT}/defult.jpeg`;
export const DEFAULT_COVER_CANDIDATES = [DEFAULT_LOCAL_COVER_URL, DEFAULT_REMOTE_COVER_URL];

function isRemotePreferredCoverUrl(value?: string | null) {
  return Boolean(value && /^https?:\/\/utbabuddha\.com(?:\/|$)/i.test(String(value).trim()));
}

function extractCoverFilename(value?: string | null): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return null;
  }

  const withoutHash = trimmed.split("#")[0] || "";
  const withoutQuery = withoutHash.split("?")[0] || "";
  const parts = withoutQuery.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

function buildRemoteCoverUrl(filename: string) {
  return `${REMOTE_COVER_ROOT}/${filename}`;
}

function buildLocalCoverUrl(filename: string) {
  return `${LOCAL_COVER_ROOT}/${filename}`;
}

function normalizeDirectCoverUrl(value?: string | null): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return null;
  }

  if (/^(data:|blob:|content:|file:|capacitor:)/i.test(trimmed)) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("/")) {
    if (trimmed.startsWith("/static/album_image/")) {
      const filename = extractCoverFilename(trimmed);
      return filename ? buildLocalCoverUrl(filename) : null;
    }
    return `${API_BASE}${trimmed}`;
  }

  const filename = extractCoverFilename(trimmed);
  return filename ? buildLocalCoverUrl(filename) : null;
}

function pushCoverCandidate(candidates: string[], value?: string | null) {
  const normalized = normalizeDirectCoverUrl(value);
  if (normalized && !candidates.includes(normalized)) {
    candidates.push(normalized);
  }
}

export function resolveAlbumCoverCandidates(source?: MusicCoverSource): string[] {
  const rawPrimary = typeof source === "string" ? source : source?.image ?? null;
  const rawFallback = typeof source === "string" ? source : source?.cover_url ?? null;
  const filename = extractCoverFilename(rawPrimary) ?? extractCoverFilename(rawFallback);
  const candidates: string[] = [];

  if (filename) {
    pushCoverCandidate(candidates, buildLocalCoverUrl(filename));
  }

  if (isRemotePreferredCoverUrl(rawPrimary)) {
    pushCoverCandidate(candidates, rawPrimary);
  } else {
    pushCoverCandidate(candidates, rawPrimary);
  }

  if (typeof source === "string") {
    if (!isRemotePreferredCoverUrl(rawPrimary)) {
      pushCoverCandidate(candidates, rawPrimary);
    }
  } else {
    pushCoverCandidate(candidates, rawFallback);
  }

  if (filename) {
    pushCoverCandidate(candidates, buildRemoteCoverUrl(filename));
  }

  for (const fallback of DEFAULT_COVER_CANDIDATES) {
    pushCoverCandidate(candidates, fallback);
  }

  return candidates.length ? candidates : [...DEFAULT_COVER_CANDIDATES];
}
