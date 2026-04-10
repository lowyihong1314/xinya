import type { CSSProperties, RefObject } from "react";

import { showPromptDialog } from "../../../../js/dialogs";
import type { AlbumRecord, MusicRecord } from "../../logic/types";
import type { AlbumDraft, EditorMode, Toast, TrackDraft, WorkspaceScreen } from "../../logic/workspaceTypes";
import { DesktopAlbumCollection } from "../desktop/DesktopAlbumCollection";
import { DesktopEditorScreen } from "../desktop/DesktopEditorScreen";
import { DesktopTracksScreen } from "../desktop/DesktopTracksScreen";
import { MobileAlbumCollection } from "../mobile/MobileAlbumCollection";
import { MobileEditorScreen } from "../mobile/MobileEditorScreen";
import { MobileTracksScreen } from "../mobile/MobileTracksScreen";

type MusicWorkspacePanelProps = {
  isMobile: boolean;
  screen: WorkspaceScreen;
  editorMode: EditorMode;
  loading: boolean;
  refreshing: boolean;
  albums: AlbumRecord[];
  filteredAlbums: AlbumRecord[];
  filteredLibraryMusicCount: number;
  pagedAlbums: AlbumRecord[];
  albumPage: number;
  totalAlbumPages: number;
  pagedFilteredMusics: MusicRecord[];
  trackPage: number;
  totalTrackPages: number;
  selectedAlbumId: number | null;
  selectedAlbumDetail: AlbumRecord | null;
  musics: MusicRecord[];
  filteredMusics: MusicRecord[];
  currentMusicId: number | null;
  editingMusicDetail: MusicRecord | null;
  search: string;
  newAlbumName: string;
  albumDraft: AlbumDraft;
  trackDraft: TrackDraft;
  toast: Toast;
  canViewListening: boolean;
  listeningSummary: {
    totalMinutes: number;
    uniqueListeners: number;
  };
  savingAlbum: boolean;
  savingTrack: boolean;
  uploadingMusic: boolean;
  replacingFile: boolean;
  canManage: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  coverInputRef: RefObject<HTMLInputElement | null>;
  replaceInputRef: RefObject<HTMLInputElement | null>;
  onChangeSearch: (value: string) => void;
  onChangeNewAlbumName: (value: string) => void;
  onChangeAlbumDraft: (draft: AlbumDraft) => void;
  onChangeTrackDraft: (draft: TrackDraft) => void;
  onCreateAlbum: (nameOverride?: string) => Promise<void>;
  onOpenAlbums: () => void;
  onOpenAlbumTracks: (albumId: number | null) => Promise<void>;
  onOpenAlbumEditor: (albumId: number) => Promise<void>;
  onOpenTrackEditor: (musicId: number) => Promise<void>;
  onBackFromEditor: () => void;
  onBackToAlbums: () => void;
  onDeleteAlbum: () => Promise<void>;
  onSaveAlbum: () => Promise<void>;
  onPickCover: () => void;
  onCoverSelected: (file: File | null) => Promise<void>;
  onUploadMusic: (files: FileList | null) => Promise<void>;
  onSelectTrack: (musicId: number) => void;
  onQueueTrack: (musicId: number) => void;
  onSaveTrack: () => Promise<void>;
  onDeleteTrack: () => Promise<void>;
  onPickReplaceFile: () => void;
  onReplaceSelected: (file: File | null) => Promise<void>;
  onAlbumPageChange: (page: number) => void;
  onTrackPageChange: (page: number) => void;
  albumTrackCount: (albumId: number) => number;
};

export function MusicWorkspacePanel(props: MusicWorkspacePanelProps) {
  const {
    isMobile,
    screen,
    editorMode,
    loading,
    refreshing,
    albums,
    filteredAlbums,
    filteredLibraryMusicCount,
    pagedAlbums,
    albumPage,
    totalAlbumPages,
    pagedFilteredMusics,
    trackPage,
    totalTrackPages,
    selectedAlbumId,
    selectedAlbumDetail,
    musics,
    filteredMusics,
    currentMusicId,
    editingMusicDetail,
    search,
    newAlbumName,
    albumDraft,
    trackDraft,
    toast,
    canViewListening,
    listeningSummary,
    savingAlbum,
    savingTrack,
    uploadingMusic,
    replacingFile,
    canManage,
    fileInputRef,
    coverInputRef,
    replaceInputRef,
    onChangeSearch,
    onChangeNewAlbumName,
    onChangeAlbumDraft,
    onChangeTrackDraft,
    onCreateAlbum,
    onOpenAlbums,
    onOpenAlbumTracks,
    onOpenAlbumEditor,
    onOpenTrackEditor,
    onBackFromEditor,
    onBackToAlbums,
    onDeleteAlbum,
    onSaveAlbum,
    onPickCover,
    onCoverSelected,
    onUploadMusic,
    onSelectTrack,
    onQueueTrack,
    onSaveTrack,
    onDeleteTrack,
    onPickReplaceFile,
    onReplaceSelected,
    onAlbumPageChange,
    onTrackPageChange,
    albumTrackCount,
  } = props;

  return (
    <section style={workspaceStyle(isMobile)}>
      <header style={workspaceHeaderStyle(isMobile)}>
        <div style={headerCopyStyle}>
          {!isMobile ? <div style={eyebrowStyle}>Music Workspace</div> : null}
          <h1 style={titleStyle(isMobile)}>佛曲资料库</h1>
          {!isMobile ? <p style={subtitleStyle}>音乐库、歌曲编辑和专辑管理都集中在这里。</p> : null}
        </div>
        {!isMobile ? (
          <div style={headerMetaStyle}>
            {refreshing ? <span style={chipStyle("info")}>同步中</span> : null}
            <span style={chipStyle("neutral")}>{albums.length} 张专辑</span>
            <span style={chipStyle("neutral")}>{musics.length} 首当前歌曲</span>
            {canViewListening ? (
              <>
                <span style={chipStyle("neutral")}>{listeningSummary.uniqueListeners} 位听众</span>
                <span style={chipStyle("neutral")}>{listeningSummary.totalMinutes} 分钟收听</span>
              </>
            ) : null}
          </div>
        ) : null}
      </header>

      {toast ? <div style={toastStyle(toast.type)}>{toast.text}</div> : null}

      {screen === "albums" ? (
        <AlbumsScreen
          isMobile={isMobile}
          loading={loading}
          albums={albums}
          filteredAlbums={filteredAlbums}
          filteredLibraryMusicCount={filteredLibraryMusicCount}
          pagedAlbums={pagedAlbums}
          albumPage={albumPage}
          totalAlbumPages={totalAlbumPages}
          newAlbumName={newAlbumName}
          canManage={canManage}
          canViewListening={canViewListening}
          listeningSummary={listeningSummary}
          search={search}
          onChangeNewAlbumName={onChangeNewAlbumName}
          onChangeSearch={onChangeSearch}
          onCreateAlbum={onCreateAlbum}
          onOpenAlbumTracks={onOpenAlbumTracks}
          onOpenAlbumEditor={onOpenAlbumEditor}
          onAlbumPageChange={onAlbumPageChange}
          albumTrackCount={albumTrackCount}
        />
      ) : null}

      {screen === "tracks"
        ? isMobile
          ? (
            <MobileTracksScreen
              albumName={selectedAlbumId ? selectedAlbumDetail?.name || "专辑歌曲" : "全部歌曲"}
              albumDescription={selectedAlbumId ? selectedAlbumDetail?.description || "" : ""}
              currentMusicId={currentMusicId}
              filteredMusics={filteredMusics}
              pagedFilteredMusics={pagedFilteredMusics}
              search={search}
              trackPage={trackPage}
              totalTrackPages={totalTrackPages}
              canManage={canManage}
              fileInputRef={fileInputRef}
              onOpenAlbums={onOpenAlbums}
              onBackToAlbums={onBackToAlbums}
              onChangeSearch={onChangeSearch}
              onTrackPageChange={onTrackPageChange}
              onSelectTrack={onSelectTrack}
              onOpenAlbumEditor={() => (selectedAlbumId ? onOpenAlbumEditor(selectedAlbumId) : Promise.resolve())}
              onOpenTrackEditor={onOpenTrackEditor}
              onUploadMusic={onUploadMusic}
              uploadingMusic={uploadingMusic}
              hasSelectedAlbum={Boolean(selectedAlbumId)}
              onQueueTrack={onQueueTrack}
            />
          )
          : (
            <DesktopTracksScreen
              albumName={selectedAlbumId ? selectedAlbumDetail?.name || "专辑歌曲" : "全部歌曲"}
              albumDescription={selectedAlbumId ? selectedAlbumDetail?.description || "" : ""}
              currentMusicId={currentMusicId}
              filteredMusics={filteredMusics}
              pagedFilteredMusics={pagedFilteredMusics}
              search={search}
              trackPage={trackPage}
              totalTrackPages={totalTrackPages}
              canManage={canManage}
              fileInputRef={fileInputRef}
              onOpenAlbums={onOpenAlbums}
              onBackToAlbums={onBackToAlbums}
              onChangeSearch={onChangeSearch}
              onTrackPageChange={onTrackPageChange}
              onSelectTrack={onSelectTrack}
              onOpenAlbumEditor={() => (selectedAlbumId ? onOpenAlbumEditor(selectedAlbumId) : Promise.resolve())}
              onOpenTrackEditor={onOpenTrackEditor}
              onUploadMusic={onUploadMusic}
              uploadingMusic={uploadingMusic}
              hasSelectedAlbum={Boolean(selectedAlbumId)}
              onQueueTrack={onQueueTrack}
            />
          )
        : null}

      {screen === "editor"
        ? isMobile
          ? (
            <MobileEditorScreen
              editorMode={editorMode}
              selectedAlbumDetail={selectedAlbumDetail}
              editingMusicDetail={editingMusicDetail}
              albumDraft={albumDraft}
              trackDraft={trackDraft}
              albums={albums}
              canManage={canManage}
              savingAlbum={savingAlbum}
              savingTrack={savingTrack}
              replacingFile={replacingFile}
              coverInputRef={coverInputRef}
              replaceInputRef={replaceInputRef}
              onBackFromEditor={onBackFromEditor}
              onChangeAlbumDraft={onChangeAlbumDraft}
              onChangeTrackDraft={onChangeTrackDraft}
              onSaveAlbum={onSaveAlbum}
              onDeleteAlbum={onDeleteAlbum}
              onPickCover={onPickCover}
              onCoverSelected={onCoverSelected}
              onSaveTrack={onSaveTrack}
              onDeleteTrack={onDeleteTrack}
              onPickReplaceFile={onPickReplaceFile}
              onReplaceSelected={onReplaceSelected}
            />
          )
          : (
            <DesktopEditorScreen
              editorMode={editorMode}
              selectedAlbumDetail={selectedAlbumDetail}
              editingMusicDetail={editingMusicDetail}
              albumDraft={albumDraft}
              trackDraft={trackDraft}
              albums={albums}
              canManage={canManage}
              savingAlbum={savingAlbum}
              savingTrack={savingTrack}
              replacingFile={replacingFile}
              coverInputRef={coverInputRef}
              replaceInputRef={replaceInputRef}
              onBackFromEditor={onBackFromEditor}
              onChangeAlbumDraft={onChangeAlbumDraft}
              onChangeTrackDraft={onChangeTrackDraft}
              onSaveAlbum={onSaveAlbum}
              onDeleteAlbum={onDeleteAlbum}
              onPickCover={onPickCover}
              onCoverSelected={onCoverSelected}
              onSaveTrack={onSaveTrack}
              onDeleteTrack={onDeleteTrack}
              onPickReplaceFile={onPickReplaceFile}
              onReplaceSelected={onReplaceSelected}
            />
          )
        : null}
    </section>
  );
}

function AlbumsScreen({
  isMobile,
  loading,
  albums,
  filteredAlbums,
  filteredLibraryMusicCount,
  pagedAlbums,
  albumPage,
  totalAlbumPages,
  newAlbumName,
  canManage,
  canViewListening,
  listeningSummary,
  search,
  onChangeNewAlbumName,
  onChangeSearch,
  onCreateAlbum,
  onOpenAlbumTracks,
  onOpenAlbumEditor,
  onAlbumPageChange,
  albumTrackCount,
}: {
  isMobile: boolean;
  loading: boolean;
  albums: AlbumRecord[];
  filteredAlbums: AlbumRecord[];
  filteredLibraryMusicCount: number;
  pagedAlbums: AlbumRecord[];
  albumPage: number;
  totalAlbumPages: number;
  newAlbumName: string;
  canManage: boolean;
  canViewListening: boolean;
  listeningSummary: {
    totalMinutes: number;
    uniqueListeners: number;
  };
  search: string;
  onChangeNewAlbumName: (value: string) => void;
  onChangeSearch: (value: string) => void;
  onCreateAlbum: (nameOverride?: string) => Promise<void>;
  onOpenAlbumTracks: (albumId: number | null) => Promise<void>;
  onOpenAlbumEditor: (albumId: number) => Promise<void>;
  onAlbumPageChange: (page: number) => void;
  albumTrackCount: (albumId: number) => number;
}) {
  const totalAlbumHeat = albums.reduce((sum, album) => sum + Number(album.album_total_minutes ?? 0), 0);
  const hasSearch = Boolean(search.trim());
  const showAllTracksEntry = !hasSearch || filteredLibraryMusicCount > 0;
  const handleCreateAlbumClick = async () => {
    if (!isMobile) {
      void onCreateAlbum();
      return;
    }

    const name = await showPromptDialog({
      title: "新专辑",
      message: "新专辑名称",
      placeholder: "请输入专辑名称",
    });
    if (!name) return;
    void onCreateAlbum(name);
  };

  return (
    <div style={screenStackStyle}>
      <section style={sectionCardStyle(isMobile)}>
        {!isMobile ? (
          <div style={sectionHeaderStyle}>
            <div>
              <div style={sectionTitleStyle}>全部专辑</div>
              <p style={sectionCopyStyle}>
                先从总览进入，再切到歌曲列表和编辑界面。{canViewListening ? "听歌记录已移动到上方“听歌记录”页签。" : ""}
              </p>
            </div>
            <button type="button" style={ghostButtonStyle} onClick={() => void onOpenAlbumTracks(null)}>
              打开全部歌曲
            </button>
          </div>
        ) : null}

        {canManage && !isMobile ? (
          <div style={createBarStyle(isMobile)}>
            <input
              value={newAlbumName}
              onChange={(event) => onChangeNewAlbumName(event.target.value)}
              placeholder="新专辑名称"
              style={inputStyle}
            />
            <button type="button" style={primaryButtonStyle} onClick={() => void onCreateAlbum()}>
              创建专辑
            </button>
          </div>
        ) : null}

        <div style={searchRowStyle(canManage)}>
          <input
            value={search}
            onInput={(event) => onChangeSearch((event.target as HTMLInputElement).value)}
            placeholder="搜索歌曲 / 专辑"
            style={inputStyle}
          />
          {canManage ? (
            <button type="button" style={primaryButtonStyle} onClick={handleCreateAlbumClick}>
              创建专辑
            </button>
          ) : null}
        </div>

        {totalAlbumPages > 1 ? (
          <div style={paginationStyle}>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={albumPage <= 1}
              onClick={() => onAlbumPageChange(albumPage - 1)}
            >
              上一页
            </button>
            <span style={paginationCopyStyle}>
              第 {albumPage} / {totalAlbumPages} 页
            </span>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={albumPage >= totalAlbumPages}
              onClick={() => onAlbumPageChange(albumPage + 1)}
            >
              下一页
            </button>
          </div>
        ) : null}

        {loading ? <div style={emptyStateStyle}>载入专辑中…</div> : null}

        {!loading ? (
          <div style={albumGridStyle(isMobile)}>
            {isMobile ? (
              <MobileAlbumCollection
                showAllTracksEntry={showAllTracksEntry}
                hasSearch={hasSearch}
                filteredLibraryMusicCount={filteredLibraryMusicCount}
                albums={albums}
                pagedAlbums={pagedAlbums}
                totalAlbumHeat={totalAlbumHeat}
                albumTrackCount={albumTrackCount}
                onOpenAlbumTracks={onOpenAlbumTracks}
              />
            ) : (
              <DesktopAlbumCollection
                showAllTracksEntry={showAllTracksEntry}
                hasSearch={hasSearch}
                filteredLibraryMusicCount={filteredLibraryMusicCount}
                albums={albums}
                pagedAlbums={pagedAlbums}
                totalAlbumHeat={totalAlbumHeat}
                canManage={canManage}
                albumTrackCount={albumTrackCount}
                onOpenAlbumTracks={onOpenAlbumTracks}
                onOpenAlbumEditor={onOpenAlbumEditor}
              />
            )}
          </div>
        ) : null}

        {!loading && !showAllTracksEntry && !filteredAlbums.length ? (
          <div style={emptyStateStyle}>没有找到匹配的歌曲或专辑。</div>
        ) : null}

        {!isMobile && canViewListening ? (
          <div style={metaFootnoteStyle}>
            当前累计收听 {listeningSummary.totalMinutes} 分钟，触达 {listeningSummary.uniqueListeners} 位听众。
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

const workspaceHeaderStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gap: "16px",
  gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto",
  alignItems: "end",
});

const headerCopyStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "var(--x-color-accent)",
};

const titleStyle = (isMobile: boolean): CSSProperties => ({
  margin: 0,
  fontSize: isMobile ? "28px" : "34px",
  lineHeight: 1.05,
  color: "var(--x-color-ink)",
});

const subtitleStyle: CSSProperties = {
  margin: 0,
  color: "var(--x-color-ink-muted)",
  fontSize: "14px",
};

const headerMetaStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  alignItems: "center",
};

function chipStyle(kind: "neutral" | "info"): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "34px",
    padding: "0 12px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    color: kind === "info" ? "var(--x-color-info)" : "var(--x-color-ink)",
    background: kind === "info" ? "var(--x-color-info-soft)" : "var(--x-color-panel-alt)",
    border: `1px solid ${kind === "info" ? "rgba(29,78,216,0.18)" : "var(--x-color-line)"}`,
  };
}

function toastStyle(type: "success" | "error"): CSSProperties {
  return {
    padding: "14px 16px",
    borderRadius: "16px",
    fontWeight: 700,
    color: type === "success" ? "var(--x-color-success)" : "var(--x-color-danger)",
    background: type === "success" ? "var(--x-color-success-soft)" : "var(--x-color-danger-soft)",
    border: `1px solid ${type === "success" ? "rgba(21,128,61,0.16)" : "var(--x-color-danger-border)"}`,
  };
}

function workspaceStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: isMobile ? "14px" : "20px",
    minWidth: 0,
    padding: isMobile ? 0 : "28px",
    borderRadius: isMobile ? 0 : "32px",
    background: isMobile ? "transparent" : "rgba(255,255,255,0.95)",
    border: isMobile ? "none" : "1px solid rgba(216, 223, 235, 0.95)",
    boxShadow: isMobile ? "none" : "0 20px 45px rgba(15, 23, 42, 0.08)",
  };
}

function sectionCardStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: isMobile ? "14px" : "18px",
    padding: isMobile ? 0 : "20px",
    borderRadius: isMobile ? 0 : "24px",
    background: isMobile
      ? "transparent"
      : "linear-gradient(180deg, rgba(246,248,252,0.88), rgba(255,255,255,0.98))",
    border: isMobile ? "none" : "1px solid rgba(216,223,235,0.9)",
  };
}

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

const createBarStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gap: "12px",
  gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto",
});

const searchRowStyle = (canManage: boolean): CSSProperties => ({
  display: "grid",
  gap: "12px",
  gridTemplateColumns: canManage ? "minmax(0, 1fr) auto" : "1fr",
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

const albumGridStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gap: isMobile ? "10px" : "16px",
  gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(210px, 1fr))",
});

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

const emptyStateStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "18px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  textAlign: "center",
};

const metaFootnoteStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};
