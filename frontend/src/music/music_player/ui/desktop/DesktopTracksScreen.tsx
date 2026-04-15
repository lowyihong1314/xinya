import type { CSSProperties, RefObject } from "react";

import { formatMusicHeat } from "../../logic/musicHeatUtils";
import type { MusicRecord } from "../../logic/types";
import { musicAudioUploadAccept } from "../shared/audioUpload";

export function DesktopTracksScreen({
  albumName,
  albumDescription,
  currentMusicId,
  filteredMusics,
  pagedFilteredMusics,
  search,
  trackPage,
  totalTrackPages,
  canManage,
  fileInputRef,
  onOpenAlbums,
  onBackToAlbums,
  onChangeSearch,
  onTrackPageChange,
  onSelectTrack,
  onOpenAlbumEditor,
  onOpenTrackEditor,
  onUploadMusic,
  uploadingMusic,
  hasSelectedAlbum,
  onQueueTrack,
}: {
  albumName: string;
  albumDescription: string;
  currentMusicId: number | null;
  filteredMusics: MusicRecord[];
  pagedFilteredMusics: MusicRecord[];
  search: string;
  trackPage: number;
  totalTrackPages: number;
  canManage: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onOpenAlbums: () => void;
  onBackToAlbums: () => void;
  onChangeSearch: (value: string) => void;
  onTrackPageChange: (page: number) => void;
  onSelectTrack: (musicId: number) => void;
  onOpenAlbumEditor: () => Promise<void>;
  onOpenTrackEditor: (musicId: number) => Promise<void>;
  onUploadMusic: (files: FileList | null) => Promise<void>;
  uploadingMusic: boolean;
  hasSelectedAlbum: boolean;
  onQueueTrack: (musicId: number) => void;
}) {
  return (
    <div style={screenStackStyle}>
      <section style={sectionCardStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <div style={sectionTitleStyle}>{albumName}</div>
            <p style={sectionCopyStyle}>{albumDescription || "点击歌曲会直接插队播放，`+列队` 会追加到播放队列末尾。"}</p>
          </div>
          <div style={toolbarStyle}>
            <button type="button" style={ghostButtonStyle} onClick={onOpenAlbums}>
              回到全部专辑
            </button>
            <button type="button" style={secondaryButtonStyle} onClick={onBackToAlbums}>
              返回
            </button>
            {canManage && hasSelectedAlbum ? (
              <button type="button" style={secondaryButtonStyle} onClick={() => void onOpenAlbumEditor()}>
                管理专辑
              </button>
            ) : null}
          </div>
        </div>

        {totalTrackPages > 1 ? (
          <div style={paginationStyle}>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={trackPage <= 1}
              onClick={() => onTrackPageChange(trackPage - 1)}
            >
              上一页
            </button>
            <span style={paginationCopyStyle}>
              第 {trackPage} / {totalTrackPages} 页
            </span>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={trackPage >= totalTrackPages}
              onClick={() => onTrackPageChange(trackPage + 1)}
            >
              下一页
            </button>
          </div>
        ) : null}

        <div style={searchRowStyle(canManage && hasSelectedAlbum)}>
          <input
            value={search}
            onInput={(event) => onChangeSearch((event.target as HTMLInputElement).value)}
            placeholder="搜索歌曲 / 专辑"
            style={inputStyle}
          />
          {canManage && hasSelectedAlbum ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={musicAudioUploadAccept}
                multiple
                hidden
                onChange={(event) => void onUploadMusic(event.target.files)}
              />
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingMusic}
              >
                {uploadingMusic ? "上传中…" : "添加歌曲"}
              </button>
            </>
          ) : null}
        </div>

        {filteredMusics.length ? (
          <div style={trackListStyle}>
            {pagedFilteredMusics.map((music, index) => (
              <article key={music.id} style={trackRowStyle(music.id === currentMusicId)}>
                <button type="button" style={trackPlayButtonStyle} onClick={() => onSelectTrack(music.id)}>
                  <span style={trackIndexStyle}>{String((trackPage - 1) * 20 + index + 1).padStart(2, "0")}</span>
                  <span style={trackMainStyle}>
                    <span style={trackNameStyle}>{music.title}</span>
                    <span style={trackMetaStyle}>
                      {music.album?.name || albumName}
                      {" · "}
                      {formatMusicHeat(music.play_minutes)}
                    </span>
                  </span>
                </button>
                <div style={trackActionRowStyle}>
                  <button type="button" style={secondaryButtonStyle} onClick={() => onQueueTrack(music.id)}>
                    +列队
                  </button>
                  {canManage ? (
                    <button type="button" style={ghostButtonStyle} onClick={() => void onOpenTrackEditor(music.id)}>
                      编辑
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div style={emptyStateStyle}>当前列表没有匹配的歌曲。</div>
        )}
      </section>
    </div>
  );
}

const screenStackStyle: CSSProperties = {
  display: "grid",
  gap: "20px",
};

const sectionCardStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
  padding: "20px",
  borderRadius: "24px",
  background: "linear-gradient(180deg, rgba(246,248,252,0.88), rgba(255,255,255,0.98))",
  border: "1px solid rgba(216,223,235,0.9)",
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  gap: "12px",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "22px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const sectionCopyStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

const paginationStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
};

const paginationCopyStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

const searchRowStyle = (showUpload: boolean): CSSProperties => ({
  display: "grid",
  gap: "12px",
  gridTemplateColumns: showUpload ? "minmax(0, 1fr) auto" : "1fr",
  alignItems: "center",
});

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "46px",
  padding: "0 14px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  font: "inherit",
  boxSizing: "border-box",
};

const primaryButtonStyle: CSSProperties = {
  minHeight: "46px",
  padding: "0 18px",
  borderRadius: "14px",
  border: "none",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-nav-start))",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
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

const trackListStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

function trackRowStyle(active: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "12px",
    alignItems: "center",
    padding: "12px",
    borderRadius: "18px",
    border: `1px solid ${active ? "var(--x-color-accent-border)" : "rgba(216,223,235,0.9)"}`,
    background: active ? "var(--x-color-accent-soft)" : "rgba(255,255,255,0.98)",
  };
}

const trackPlayButtonStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  gap: "12px",
  alignItems: "center",
  padding: 0,
  border: "none",
  background: "transparent",
  textAlign: "left",
  cursor: "pointer",
};

const trackIndexStyle: CSSProperties = {
  width: "44px",
  height: "44px",
  borderRadius: "14px",
  display: "grid",
  placeItems: "center",
  background: "rgba(15,118,110,0.1)",
  color: "var(--x-color-accent-strong)",
  fontWeight: 800,
  fontFamily: "var(--x-font-mono)",
};

const trackMainStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  minWidth: 0,
};

const trackNameStyle: CSSProperties = {
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const trackMetaStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

const trackActionRowStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  alignItems: "center",
  flexWrap: "wrap",
};

const emptyStateStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "18px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  textAlign: "center",
};
