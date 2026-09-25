import type { CSSProperties, ReactNode, RefObject } from "react";

import { showPromptDialog } from "../../../../js/dialogs";
import type { AlbumRecord, MusicRecord } from "../../logic/types";
import type { AlbumDraft, EditorMode, MusicUploadDraft, Toast, TrackDraft, WorkspaceScreen } from "../../logic/workspaceTypes";
import { DesktopAlbumCollection } from "../desktop/DesktopAlbumCollection";
import { DesktopEditorScreen } from "../desktop/DesktopEditorScreen";
import { DesktopTracksScreen } from "../desktop/DesktopTracksScreen";
import { MobileAlbumCollection } from "../mobile/MobileAlbumCollection";
import { MobileEditorScreen } from "../mobile/MobileEditorScreen";
import { MobileTracksScreen } from "../mobile/MobileTracksScreen";
import { MusicSearchInput } from "../shared/MusicSearchInput";

export type MusicLibraryTab = "library" | "playlists";

type MusicWorkspacePanelProps = {
  isMobile: boolean;
  /** 顶部「资料库 / 我的歌单」页签。 */
  libraryTab: MusicLibraryTab;
  onChangeLibraryTab: (tab: MusicLibraryTab) => void;
  /** 登录后才显示「我的歌单」页签。 */
  showPlaylistsTab: boolean;
  playlistsPane?: ReactNode;
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
  savingAccompaniment: boolean;
  canManage: boolean;
  coverInputRef: RefObject<HTMLInputElement | null>;
  replaceInputRef: RefObject<HTMLInputElement | null>;
  accompanimentInputRef: RefObject<HTMLInputElement | null>;
  onChangeSearch: (value: string) => void;
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
  onUploadMusic: (upload: MusicUploadDraft | null) => Promise<void>;
  onSelectTrack: (musicId: number) => void;
  onQueueTrack: (musicId: number) => void;
  /** 传了就在每首歌旁显示「+歌单」。 */
  onAddToPlaylist?: (musicId: number) => void;
  /** 管理员：每首歌旁的「上传伴奏 / 换伴奏」。 */
  onPickAccompanimentForTrack?: (musicId: number) => void;
  onSaveTrack: () => Promise<void>;
  onDeleteTrack: () => Promise<void>;
  onPickReplaceFile: () => void;
  onReplaceSelected: (file: File | null) => Promise<void>;
  onPickAccompanimentFile: () => void;
  onAccompanimentSelected: (file: File | null) => Promise<void>;
  onDeleteAccompaniment: () => Promise<void>;
  onAlbumPageChange: (page: number) => void;
  onTrackPageChange: (page: number) => void;
  albumTrackCount: (albumId: number) => number;
};

export function MusicWorkspacePanel(props: MusicWorkspacePanelProps) {
  const {
    isMobile,
    libraryTab,
    onChangeLibraryTab,
    showPlaylistsTab,
    playlistsPane,
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
    albumDraft,
    trackDraft,
    toast,
    canViewListening,
    listeningSummary,
    savingAlbum,
    savingTrack,
    uploadingMusic,
    replacingFile,
    savingAccompaniment,
    canManage,
    coverInputRef,
    replaceInputRef,
    accompanimentInputRef,
    onChangeSearch,
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
    onAddToPlaylist,
    onPickAccompanimentForTrack,
    onSaveTrack,
    onDeleteTrack,
    onPickReplaceFile,
    onReplaceSelected,
    onPickAccompanimentFile,
    onAccompanimentSelected,
    onDeleteAccompaniment,
    onAlbumPageChange,
    onTrackPageChange,
    albumTrackCount,
  } = props;

  const activeTab: MusicLibraryTab = showPlaylistsTab ? libraryTab : "library";

  return (
    <section style={workspaceStyle(isMobile)}>
      <header style={workspaceHeaderStyle(isMobile)}>
        <div style={libraryTabsStyle} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "library"}
            style={libraryTabButtonStyle(activeTab === "library")}
            onClick={() => onChangeLibraryTab("library")}
          >
            资料库
          </button>
          {showPlaylistsTab ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "playlists"}
              style={libraryTabButtonStyle(activeTab === "playlists")}
              onClick={() => onChangeLibraryTab("playlists")}
            >
              我的歌单
            </button>
          ) : null}
        </div>
        {activeTab === "library" ? (
          <div style={headerSearchStyle}>
            <MusicSearchInput value={search} onChange={onChangeSearch} />
          </div>
        ) : (
          <div />
        )}
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

      {activeTab === "playlists" ? playlistsPane ?? null : null}

      {activeTab === "library" && screen === "albums" ? (
        <AlbumsScreen
          isMobile={isMobile}
          loading={loading}
          albums={albums}
          filteredAlbums={filteredAlbums}
          filteredLibraryMusicCount={filteredLibraryMusicCount}
          pagedAlbums={pagedAlbums}
          albumPage={albumPage}
          totalAlbumPages={totalAlbumPages}
          canManage={canManage}
          canViewListening={canViewListening}
          listeningSummary={listeningSummary}
          search={search}
          onChangeSearch={onChangeSearch}
          onCreateAlbum={onCreateAlbum}
          onOpenAlbumTracks={onOpenAlbumTracks}
          onOpenAlbumEditor={onOpenAlbumEditor}
          onAlbumPageChange={onAlbumPageChange}
          albumTrackCount={albumTrackCount}
        />
      ) : null}

      {activeTab === "library" && screen === "tracks"
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
              onAddToPlaylist={onAddToPlaylist}
              onPickAccompanimentForTrack={onPickAccompanimentForTrack}
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
              onAddToPlaylist={onAddToPlaylist}
              onPickAccompanimentForTrack={onPickAccompanimentForTrack}
            />
          )
        : null}

      {activeTab === "library" && screen === "editor"
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
              savingAccompaniment={savingAccompaniment}
              coverInputRef={coverInputRef}
              replaceInputRef={replaceInputRef}
              accompanimentInputRef={accompanimentInputRef}
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
              onPickAccompanimentFile={onPickAccompanimentFile}
              onAccompanimentSelected={onAccompanimentSelected}
              onDeleteAccompaniment={onDeleteAccompaniment}
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
              savingAccompaniment={savingAccompaniment}
              coverInputRef={coverInputRef}
              replaceInputRef={replaceInputRef}
              accompanimentInputRef={accompanimentInputRef}
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
              onPickAccompanimentFile={onPickAccompanimentFile}
              onAccompanimentSelected={onAccompanimentSelected}
              onDeleteAccompaniment={onDeleteAccompaniment}
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
  canManage,
  canViewListening,
  listeningSummary,
  search,
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
  canManage: boolean;
  canViewListening: boolean;
  listeningSummary: {
    totalMinutes: number;
    uniqueListeners: number;
  };
  search: string;
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

        {canManage ? (
          <div style={searchRowStyle(false)}>
            <button type="button" style={primaryButtonStyle} onClick={handleCreateAlbumClick}>
              创建专辑
            </button>
          </div>
        ) : null}

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

// 顶栏一行：左边「资料库 / 我的歌单」页签，右边搜索框；桌面端再带一排统计小标签。
const workspaceHeaderStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gap: isMobile ? "10px" : "14px",
  gridTemplateColumns: isMobile ? "auto minmax(0, 1fr)" : "auto minmax(0, 1fr) auto",
  alignItems: "center",
});

const libraryTabsStyle: CSSProperties = {
  display: "inline-flex",
  padding: "4px",
  borderRadius: "14px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line)",
  gap: "4px",
  flexShrink: 0,
};

function libraryTabButtonStyle(active: boolean): CSSProperties {
  return {
    minHeight: "36px",
    padding: "0 14px",
    borderRadius: "10px",
    border: "none",
    background: active ? "var(--x-color-panel)" : "transparent",
    color: active ? "var(--x-color-ink)" : "var(--x-color-ink-muted)",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: active ? "0 4px 12px var(--x-color-shadow-soft)" : "none",
    whiteSpace: "nowrap",
  };
}

const headerSearchStyle: CSSProperties = {
  minWidth: 0,
};

const headerMetaStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  alignItems: "center",
  justifyContent: "flex-end",
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

const searchRowStyle = (canManage: boolean): CSSProperties => ({
  display: "grid",
  gap: "12px",
  gridTemplateColumns: canManage ? "minmax(0, 1fr) auto" : "1fr",
  alignItems: "center",
});

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
