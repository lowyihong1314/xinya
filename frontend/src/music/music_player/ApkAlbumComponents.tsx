import type { CSSProperties } from "react";

import { CachedImage } from "../../components/CachedMedia";
import { buildMusicCoverCacheKey, resolveAlbumCoverUrl } from "./musicCoverUtils";
import { formatMusicHeat } from "./musicHeatUtils";
import type { AlbumRecord, MusicRecord } from "./types";

// ─── Shared utility ─────────────────────────────────────────────────────────

export function formatTime(s: number): string {
  if (!s || !isFinite(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

// ─── AlbumHero ───────────────────────────────────────────────────────────────

export function AlbumHero({ album, trackCount }: { album: AlbumRecord; trackCount: number }) {
  return (
    <div style={albumHeroStyle}>
      <div style={albumHeroCoverStyle}>
        <CachedImage
          src={resolveAlbumCoverUrl(album.cover_url)}
          cacheKey={buildMusicCoverCacheKey("apk-album-hero", album.id)}
          alt={album.name}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
      <div style={albumHeroNameStyle}>{album.name}</div>
      <div style={albumHeroCountStyle}>
        {trackCount} 首歌曲
        {" · "}
        {formatMusicHeat(album.album_total_minutes)}
      </div>
    </div>
  );
}

const albumHeroStyle: CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center",
  padding: "20px 24px 16px", gap: 8,
};

const albumHeroCoverStyle: CSSProperties = {
  width: "min(160px, 48vw)", height: "min(160px, 48vw)",
  borderRadius: 16, overflow: "hidden",
  background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
  display: "flex", alignItems: "center", justifyContent: "center",
  boxShadow: "0 12px 32px rgba(0,0,0,0.2)", flexShrink: 0,
};

const albumHeroNameStyle: CSSProperties = {
  fontSize: 17, fontWeight: 700, color: "var(--x-color-ink)", textAlign: "center",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%",
};

const albumHeroCountStyle: CSSProperties = {
  fontSize: 13, color: "var(--x-color-ink-muted)",
};

// ─── AlbumCard ───────────────────────────────────────────────────────────────

export function AlbumCard({
  album,
  trackCount,
  onSelect,
}: {
  album: AlbumRecord;
  trackCount: number;
  onSelect: () => void;
}) {
  return (
    <button style={albumCardStyle} onClick={onSelect}>
      <div style={albumCoverStyle}>
        <CachedImage
          src={resolveAlbumCoverUrl(album.cover_url)}
          cacheKey={buildMusicCoverCacheKey("apk-album-card", album.id)}
          alt={album.name}
          style={albumCoverImgStyle}
        />
      </div>
      <div style={albumNameStyle}>{album.name}</div>
      <div style={albumCountStyle}>
        {trackCount} 首
        {" · "}
        {formatMusicHeat(album.album_total_minutes)}
      </div>
    </button>
  );
}

const albumCardStyle: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 6,
  border: "none", background: "transparent",
  padding: 0, cursor: "pointer", textAlign: "left", minWidth: 0,
};

const albumCoverStyle: CSSProperties = {
  width: "100%", aspectRatio: "1", borderRadius: 14,
  background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
  display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
};

const albumCoverImgStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

const albumNameStyle: CSSProperties = {
  fontSize: 13, fontWeight: 600, color: "var(--x-color-ink)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const albumCountStyle: CSSProperties = { fontSize: 12, color: "var(--x-color-ink-muted)" };

// ─── AlbumListRow (search results) ───────────────────────────────────────────

export function AlbumListRow({
  album,
  trackCount,
  onSelect,
}: {
  album: AlbumRecord;
  trackCount: number;
  onSelect: () => void;
}) {
  return (
    <button style={albumListRowStyle} onClick={onSelect}>
      <div style={albumListCoverStyle}>
        <CachedImage
          src={resolveAlbumCoverUrl(album.cover_url)}
          cacheKey={buildMusicCoverCacheKey("apk-album-row", album.id)}
          alt={album.name}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
      <div style={albumListInfoStyle}>
        <span style={albumListNameStyle}>{album.name}</span>
        <span style={albumListCountStyle}>
          {trackCount} 首
          {" · "}
          {formatMusicHeat(album.album_total_minutes)}
        </span>
      </div>
      <i className="fas fa-chevron-right" style={albumListChevronStyle} />
    </button>
  );
}

const albumListRowStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 12,
  padding: "8px 14px", border: "none", background: "transparent",
  cursor: "pointer", width: "100%", textAlign: "left",
};

const albumListCoverStyle: CSSProperties = {
  width: 50, height: 50, flexShrink: 0, borderRadius: 10, overflow: "hidden",
  background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const albumListInfoStyle: CSSProperties = {
  flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0,
};

const albumListNameStyle: CSSProperties = {
  fontSize: 14, fontWeight: 600, color: "var(--x-color-ink)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const albumListCountStyle: CSSProperties = { fontSize: 12, color: "var(--x-color-ink-muted)" };

const albumListChevronStyle: CSSProperties = {
  fontSize: 12, color: "var(--x-color-ink-muted)", flexShrink: 0,
};

// ─── TrackRow ─────────────────────────────────────────────────────────────────

export function TrackRow({
  track,
  index,
  isActive,
  isPlaying,
  inQueue,
  showAlbum,
  albumName,
  onSelect,
  onAddToQueue,
}: {
  track: MusicRecord;
  index: number;
  isActive: boolean;
  isPlaying: boolean;
  inQueue: boolean;
  showAlbum?: boolean;
  albumName?: string;
  onSelect: () => void;
  onAddToQueue: () => void;
}) {
  return (
    <div style={trackRowStyle(isActive)}>
      <button style={trackMainStyle} onClick={onSelect}>
        <div style={trackIndexStyle(isActive)}>
          {isActive && isPlaying
            ? <i className="fas fa-volume-high" style={{ fontSize: 11 }} />
            : <span>{index}</span>
          }
        </div>
        <div style={trackInfoStyle}>
          <span style={trackTitleStyle(isActive)}>{track.title}</span>
          <span style={trackMetaStyle}>
            {showAlbum && (albumName || track.album?.name) ? `${albumName || track.album?.name}  ·  ` : ""}
            {formatMusicHeat(track.play_minutes)}
            {track.duration != null ? `  ·  ${formatTime(track.duration)}` : ""}
          </span>
        </div>
      </button>
      <button
        style={addQueueBtnStyle(inQueue)}
        onClick={onAddToQueue}
        title={inQueue ? "已在队列" : "添加到队列"}
      >
        <i className={inQueue ? "fas fa-check" : "fas fa-plus"} />
      </button>
    </div>
  );
}

function trackRowStyle(active: boolean): CSSProperties {
  return {
    display: "flex", alignItems: "center",
    background: active ? "rgba(15,118,110,0.07)" : "transparent",
    borderBottom: "1px solid rgba(0,0,0,0.05)",
  };
}

const trackMainStyle: CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", gap: 10,
  padding: "10px 0 10px 14px",
  border: "none", background: "transparent", cursor: "pointer", textAlign: "left", minWidth: 0,
};

function trackIndexStyle(active: boolean): CSSProperties {
  return {
    width: 24, flexShrink: 0, textAlign: "center", fontSize: 12,
    color: active ? "var(--x-color-accent-strong, #0f766e)" : "var(--x-color-ink-muted)",
  };
}

const trackInfoStyle: CSSProperties = {
  flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0,
};

function trackTitleStyle(active: boolean): CSSProperties {
  return {
    fontSize: 14, fontWeight: active ? 600 : 400,
    color: active ? "var(--x-color-accent-strong, #0f766e)" : "var(--x-color-ink)",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  };
}

const trackMetaStyle: CSSProperties = {
  fontSize: 11, color: "var(--x-color-ink-muted)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

function addQueueBtnStyle(inQueue: boolean): CSSProperties {
  return {
    width: 36, height: 36, flexShrink: 0, marginRight: 8,
    display: "flex", alignItems: "center", justifyContent: "center",
    border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13,
    background: inQueue ? "rgba(15,118,110,0.12)" : "transparent",
    color: inQueue ? "var(--x-color-accent-strong, #0f766e)" : "var(--x-color-ink-muted)",
  };
}
