import type { CSSProperties } from "react";

import { buildMusicCoverCacheKey } from "../../logic/musicCoverUtils";
import { formatMusicHeat } from "../../logic/musicHeatUtils";
import type { AlbumRecord } from "../../logic/types";
import { MusicCoverImage } from "../shared/MusicCoverImage";

export function MobileAlbumCollection({
  showAllTracksEntry,
  hasSearch,
  filteredLibraryMusicCount,
  albums,
  pagedAlbums,
  totalAlbumHeat,
  albumTrackCount,
  onOpenAlbumTracks,
}: {
  showAllTracksEntry: boolean;
  hasSearch: boolean;
  filteredLibraryMusicCount: number;
  albums: AlbumRecord[];
  pagedAlbums: AlbumRecord[];
  totalAlbumHeat: number;
  albumTrackCount: (albumId: number) => number;
  onOpenAlbumTracks: (albumId: number | null) => void | Promise<void>;
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
        <button
          key={album.id}
          type="button"
          style={albumListButtonStyle}
          onClick={() => void onOpenAlbumTracks(album.id)}
        >
          <div style={albumCardStyle}>
            <div style={albumOpenButtonStyle}>
              <MusicCoverImage
                source={album}
                cacheKey={buildMusicCoverCacheKey("workspace-album", album.id)}
                alt={album.name}
                style={albumArtStyle}
              />
            </div>
            <div style={albumCardBodyStyle}>
              <div>
                <div style={albumNameStyle}>{album.name}</div>
                <div style={albumMetaStyle}>
                  {albumTrackCount(album.id)} 首歌曲
                  {" · "}
                  {formatMusicHeat(album.album_total_minutes)}
                </div>
              </div>
            </div>
          </div>
        </button>
      ))}
    </>
  );
}

const albumListButtonStyle: CSSProperties = {
  width: "100%",
  padding: 0,
  border: "none",
  background: "transparent",
  textAlign: "left",
  cursor: "pointer",
};

const albumCardStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "104px minmax(0, 1fr)",
  gap: "12px",
  alignItems: "stretch",
  minHeight: "108px",
  padding: "10px",
  borderRadius: "16px",
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
  width: "100%",
  height: "100%",
};

const albumArtStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: "88px",
  borderRadius: "14px",
  objectFit: "cover",
  display: "block",
};

const albumArtPlaceholderStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: "88px",
  borderRadius: "14px",
  display: "grid",
  placeItems: "center",
  background: "linear-gradient(160deg, rgba(15,118,110,0.16), rgba(18,52,59,0.92))",
  color: "rgba(255,255,255,0.88)",
  fontWeight: 800,
  letterSpacing: "0.08em",
};

const albumCardBodyStyle: CSSProperties = {
  display: "grid",
  gridTemplateRows: "minmax(0, 1fr) auto",
  gap: "10px",
  minWidth: 0,
  alignContent: "space-between",
  padding: "2px 0",
};

const albumSummaryCopyStyle: CSSProperties = {
  display: "grid",
  alignContent: "center",
  gap: "6px",
  minWidth: 0,
  padding: "2px 0",
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
