import type { CSSProperties } from "react";

import { buildMusicCoverCacheKey } from "../../logic/musicCoverUtils";
import { formatMusicHeat } from "../../logic/musicHeatUtils";
import type { AlbumRecord } from "../../logic/types";
import { MusicCoverImage } from "../shared/MusicCoverImage";

export function DesktopAlbumCollection({
  showAllTracksEntry,
  hasSearch,
  filteredLibraryMusicCount,
  albums,
  pagedAlbums,
  totalAlbumHeat,
  canManage,
  albumTrackCount,
  onOpenAlbumTracks,
  onOpenAlbumEditor,
}: {
  showAllTracksEntry: boolean;
  hasSearch: boolean;
  filteredLibraryMusicCount: number;
  albums: AlbumRecord[];
  pagedAlbums: AlbumRecord[];
  totalAlbumHeat: number;
  canManage: boolean;
  albumTrackCount: (albumId: number) => number;
  onOpenAlbumTracks: (albumId: number | null) => void | Promise<void>;
  onOpenAlbumEditor: (albumId: number) => void | Promise<void>;
}) {
  return (
    <>
      {showAllTracksEntry ? (
        <button type="button" style={albumSummaryCardStyle} onClick={() => void onOpenAlbumTracks(null)}>
          <div style={albumArtPlaceholderStyle}>全部</div>
          <div style={albumSummaryCopyStyle}>
            <div style={albumNameStyle}>全部歌曲</div>
            <div style={albumMetaStyle}>
              {hasSearch
                ? `${filteredLibraryMusicCount} 首匹配歌曲`
                : `${albums.reduce((sum, album) => sum + albumTrackCount(album.id), 0)} 首 · ${formatMusicHeat(totalAlbumHeat)}`}
            </div>
          </div>
        </button>
      ) : null}

      {pagedAlbums.map((album) => (
        <article key={album.id} style={albumCardStyle}>
          <button type="button" style={albumOpenButtonStyle} onClick={() => void onOpenAlbumTracks(album.id)}>
            <MusicCoverImage
              source={album}
              cacheKey={buildMusicCoverCacheKey("workspace-album", album.id)}
              alt={album.name}
              style={albumArtStyle}
            />
          </button>
          <div style={albumCardBodyStyle}>
            <div>
              <div style={albumNameStyle}>{album.name}</div>
              <div style={albumMetaStyle}>
                {albumTrackCount(album.id)} 首歌曲
                {" · "}
                {formatMusicHeat(album.album_total_minutes)}
              </div>
            </div>
            <div style={albumCardActionsStyle}>
              <button type="button" style={ghostButtonStyle} onClick={() => void onOpenAlbumTracks(album.id)}>
                进入歌曲
              </button>
              {canManage ? (
                <button type="button" style={secondaryButtonStyle} onClick={() => void onOpenAlbumEditor(album.id)}>
                  管理专辑
                </button>
              ) : null}
            </div>
          </div>
        </article>
      ))}
    </>
  );
}

const albumCardStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  padding: "14px",
  borderRadius: "20px",
  border: "1px solid rgba(216,223,235,0.9)",
  background: "rgba(255,255,255,0.98)",
};

const albumSummaryCardStyle: CSSProperties = {
  ...albumCardStyle,
  width: "100%",
  textAlign: "left",
  cursor: "pointer",
};

const albumOpenButtonStyle: CSSProperties = {
  padding: 0,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  width: "100%",
};

const albumArtStyle: CSSProperties = {
  width: "100%",
  aspectRatio: "1 / 1",
  borderRadius: "18px",
  objectFit: "cover",
  display: "block",
};

const albumArtPlaceholderStyle: CSSProperties = {
  width: "100%",
  aspectRatio: "1 / 1",
  borderRadius: "18px",
  display: "grid",
  placeItems: "center",
  background: "linear-gradient(160deg, rgba(15,118,110,0.16), rgba(18,52,59,0.92))",
  color: "rgba(255,255,255,0.88)",
  fontWeight: 800,
  letterSpacing: "0.08em",
};

const albumCardBodyStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

const albumSummaryCopyStyle: CSSProperties = {
  display: "grid",
  alignContent: "center",
  gap: "6px",
  minWidth: 0,
};

const albumCardActionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
};

const albumNameStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const albumMetaStyle: CSSProperties = {
  marginTop: "4px",
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

const secondaryButtonStyle: CSSProperties = {
  minHeight: "46px",
  padding: "0 18px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
};

const ghostButtonStyle: CSSProperties = {
  minHeight: "42px",
  padding: "0 14px",
  borderRadius: "12px",
  border: "1px solid rgba(15, 118, 110, 0.16)",
  background: "rgba(15,118,110,0.08)",
  color: "var(--x-color-accent-strong)",
  fontWeight: 700,
  cursor: "pointer",
};
