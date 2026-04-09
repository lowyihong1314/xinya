import type { CSSProperties, RefObject } from "react";

import { buildMusicCoverCacheKey } from "../../logic/musicCoverUtils";
import type { AlbumRecord, MusicRecord } from "../../logic/types";
import type { AlbumDraft, EditorMode, TrackDraft } from "../../logic/workspaceTypes";
import { MusicCoverImage } from "../shared/MusicCoverImage";

export function DesktopEditorScreen({
  editorMode,
  selectedAlbumDetail,
  editingMusicDetail,
  albumDraft,
  trackDraft,
  albums,
  canManage,
  savingAlbum,
  savingTrack,
  replacingFile,
  coverInputRef,
  replaceInputRef,
  onBackFromEditor,
  onChangeAlbumDraft,
  onChangeTrackDraft,
  onSaveAlbum,
  onDeleteAlbum,
  onPickCover,
  onCoverSelected,
  onSaveTrack,
  onDeleteTrack,
  onPickReplaceFile,
  onReplaceSelected,
}: {
  editorMode: EditorMode;
  selectedAlbumDetail: AlbumRecord | null;
  editingMusicDetail: MusicRecord | null;
  albumDraft: AlbumDraft;
  trackDraft: TrackDraft;
  albums: AlbumRecord[];
  canManage: boolean;
  savingAlbum: boolean;
  savingTrack: boolean;
  replacingFile: boolean;
  coverInputRef: RefObject<HTMLInputElement | null>;
  replaceInputRef: RefObject<HTMLInputElement | null>;
  onBackFromEditor: () => void;
  onChangeAlbumDraft: (draft: AlbumDraft) => void;
  onChangeTrackDraft: (draft: TrackDraft) => void;
  onSaveAlbum: () => Promise<void>;
  onDeleteAlbum: () => Promise<void>;
  onPickCover: () => void;
  onCoverSelected: (file: File | null) => Promise<void>;
  onSaveTrack: () => Promise<void>;
  onDeleteTrack: () => Promise<void>;
  onPickReplaceFile: () => void;
  onReplaceSelected: (file: File | null) => Promise<void>;
}) {
  return (
    <div style={screenStackStyle}>
      <section style={sectionCardStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <div style={sectionTitleStyle}>{editorMode === "album" ? "专辑管理" : "歌曲编辑"}</div>
            <p style={sectionCopyStyle}>
              {editorMode === "album"
                ? "专辑信息、封面和删除操作都集中在这里。"
                : "单曲标题、所属专辑和音频替换都放在这个编辑界面。"}
            </p>
          </div>
          <button type="button" style={secondaryButtonStyle} onClick={onBackFromEditor}>
            返回
          </button>
        </div>

        {!canManage ? <div style={emptyStateStyle}>当前账号没有管理权限。</div> : null}

        {canManage && editorMode === "album" ? (
          <div style={editorGridStyle}>
            <div style={previewCardStyle}>
              <MusicCoverImage
                source={selectedAlbumDetail}
                cacheKey={selectedAlbumDetail ? buildMusicCoverCacheKey("workspace-selected-album", selectedAlbumDetail.id) : undefined}
                alt={selectedAlbumDetail?.name ?? ""}
                style={albumArtStyle}
              />
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => void onCoverSelected(event.target.files?.[0] || null)}
              />
              <button type="button" style={primaryButtonStyle} onClick={onPickCover}>
                更换封面
              </button>
            </div>

            <div style={formStackStyle}>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>专辑名称</span>
                <input
                  value={albumDraft.name}
                  onChange={(event) => onChangeAlbumDraft({ ...albumDraft, name: event.target.value })}
                  style={inputStyle}
                />
              </label>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>专辑描述</span>
                <textarea
                  value={albumDraft.description}
                  onChange={(event) => onChangeAlbumDraft({ ...albumDraft, description: event.target.value })}
                  style={textareaStyle}
                  rows={6}
                />
              </label>
              <div style={editorActionBarStyle}>
                <button type="button" style={primaryButtonStyle} onClick={() => void onSaveAlbum()} disabled={savingAlbum}>
                  {savingAlbum ? "保存中…" : "保存专辑"}
                </button>
                <button type="button" style={dangerButtonStyle} onClick={() => void onDeleteAlbum()} disabled={savingAlbum}>
                  删除专辑
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {canManage && editorMode === "track" ? (
          <div style={editorGridStyle}>
            <div style={previewCardStyle}>
              <MusicCoverImage
                source={editingMusicDetail?.album || editingMusicDetail?.cover_url}
                cacheKey={editingMusicDetail ? buildMusicCoverCacheKey("workspace-track", editingMusicDetail.id) : undefined}
                alt={editingMusicDetail?.title ?? ""}
                style={albumArtStyle}
              />
              <input
                ref={replaceInputRef}
                type="file"
                accept=".mp3,.wav,.wma"
                hidden
                onChange={(event) => void onReplaceSelected(event.target.files?.[0] || null)}
              />
              <button type="button" style={primaryButtonStyle} onClick={onPickReplaceFile} disabled={replacingFile}>
                {replacingFile ? "替换中…" : "更换音频"}
              </button>
            </div>

            <div style={formStackStyle}>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>歌曲标题</span>
                <input
                  value={trackDraft.title}
                  onChange={(event) => onChangeTrackDraft({ ...trackDraft, title: event.target.value })}
                  style={inputStyle}
                />
              </label>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>所属专辑</span>
                <select
                  value={trackDraft.album_id}
                  onChange={(event) => onChangeTrackDraft({ ...trackDraft, album_id: event.target.value })}
                  style={inputStyle}
                >
                  <option value="">未分类</option>
                  {albums.map((album) => (
                    <option key={album.id} value={String(album.id)}>
                      {album.name}
                    </option>
                  ))}
                </select>
              </label>
              <div style={editorHintStyle}>
                当前文件：{editingMusicDetail?.file_name || "未命名"} {editingMusicDetail?.file_type ? `· ${editingMusicDetail.file_type}` : ""}
              </div>
              <div style={editorActionBarStyle}>
                <button type="button" style={primaryButtonStyle} onClick={() => void onSaveTrack()} disabled={savingTrack}>
                  {savingTrack ? "保存中…" : "保存歌曲"}
                </button>
                <button type="button" style={dangerButtonStyle} onClick={() => void onDeleteTrack()} disabled={savingTrack}>
                  删除歌曲
                </button>
              </div>
            </div>
          </div>
        ) : null}
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

const editorGridStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
  gridTemplateColumns: "280px minmax(0, 1fr)",
};

const previewCardStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  alignContent: "start",
};

const albumArtStyle: CSSProperties = {
  width: "100%",
  aspectRatio: "1 / 1",
  borderRadius: "18px",
  objectFit: "cover",
  display: "block",
};

const formStackStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
};

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
};

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

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "140px",
  padding: "14px",
  resize: "vertical",
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

const dangerButtonStyle: CSSProperties = {
  minHeight: "46px",
  padding: "0 18px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 700,
  cursor: "pointer",
};

const editorActionBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "12px",
};

const editorHintStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

const emptyStateStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "18px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  textAlign: "center",
};
