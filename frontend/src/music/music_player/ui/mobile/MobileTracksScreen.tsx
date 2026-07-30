import type { CSSProperties } from "react";

import { formatMusicHeat } from "../../logic/musicHeatUtils";
import type { MusicRecord } from "../../logic/types";
import type { MusicUploadDraft } from "../../logic/workspaceTypes";
import { MusicSearchInput } from "../shared/MusicSearchInput";
import { showMusicUploadDialog } from "../shared/MusicUploadDialog";

export function MobileTracksScreen({
  albumName,
  albumDescription,
  currentMusicId,
  filteredMusics,
  pagedFilteredMusics,
  search,
  trackPage,
  totalTrackPages,
  canManage,
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
  onOpenAlbums: () => void;
  onBackToAlbums: () => void;
  onChangeSearch: (value: string) => void;
  onTrackPageChange: (page: number) => void;
  onSelectTrack: (musicId: number) => void;
  onOpenAlbumEditor: () => Promise<void>;
  onOpenTrackEditor: (musicId: number) => Promise<void>;
  onUploadMusic: (upload: MusicUploadDraft | null) => Promise<void>;
  uploadingMusic: boolean;
  hasSelectedAlbum: boolean;
  onQueueTrack: (musicId: number) => void;
}) {
  async function handleAddMusicClick() {
    if (uploadingMusic) return;
    const upload = await showMusicUploadDialog();
    if (!upload) return;
    await onUploadMusic(upload);
  }

  return (
    <div style={screenStackStyle}>
      <section style={sectionCardStyle}>
        <div style={headerStackStyle}>
          <div>
            <div style={sectionTitleStyle}>{albumName}</div>
            <p style={sectionCopyStyle}>{albumDescription || "点歌直接播放，`+列队` 追加到当前播放序列。"}</p>
          </div>
          <div style={toolbarStyle}>
            <button type="button" style={ghostButtonStyle} onClick={onOpenAlbums}>
              全部专辑
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

        <div style={searchStackStyle}>
          <MusicSearchInput value={search} onChange={onChangeSearch} />
          {canManage && hasSelectedAlbum ? (
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={() => void handleAddMusicClick()}
              disabled={uploadingMusic}
            >
              {uploadingMusic ? "上传中…" : "添加歌曲"}
            </button>
          ) : null}
        </div>

        {filteredMusics.length ? (
          <div style={trackListStyle}>
            {pagedFilteredMusics.map((music, index) => {
              const active = music.id === currentMusicId;
              return (
                <article key={music.id} style={trackCardStyle(active)}>
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
              );
            })}
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
  gap: "14px",
};

const sectionCardStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
};

const headerStackStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
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
  whiteSpace: "pre-wrap",
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
  gap: "10px",
  flexWrap: "wrap",
};

const paginationCopyStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

const searchStackStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
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
  minHeight: "42px",
  padding: "0 16px",
  borderRadius: "12px",
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
  gap: "10px",
};

function trackCardStyle(active: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "10px",
    padding: "12px",
    borderRadius: "16px",
    border: `1px solid ${active ? "var(--x-color-accent-border)" : "var(--x-color-line)"}`,
    background: active ? "var(--x-color-accent-soft)" : "var(--x-color-panel)",
  };
}

const trackPlayButtonStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "42px minmax(0, 1fr)",
  gap: "12px",
  alignItems: "center",
  padding: 0,
  border: "none",
  background: "transparent",
  textAlign: "left",
  cursor: "pointer",
};

const trackIndexStyle: CSSProperties = {
  width: "42px",
  height: "42px",
  borderRadius: "14px",
  display: "grid",
  placeItems: "center",
  background: "var(--x-color-accent-tint)",
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
  flexWrap: "wrap",
};

const emptyStateStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "18px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  textAlign: "center",
};
