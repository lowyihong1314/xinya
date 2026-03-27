import type { CSSProperties, RefObject } from "react";

import { resolveAlbumCoverUrl } from "./musicCoverUtils";
import type { AlbumRecord, MusicRecord } from "./types";
import type { AlbumDraft, EditorMode, Toast, TrackDraft, WorkspaceScreen } from "./workspaceTypes";

type MusicWorkspacePanelProps = {
  isMobile: boolean;
  screen: WorkspaceScreen;
  editorMode: EditorMode;
  loading: boolean;
  refreshing: boolean;
  albums: AlbumRecord[];
  pagedAlbums: AlbumRecord[];
  albumPage: number;
  totalAlbumPages: number;
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
  onCreateAlbum: () => Promise<void>;
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
    pagedAlbums,
    albumPage,
    totalAlbumPages,
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
    albumTrackCount,
  } = props;

  return (
    <section style={workspaceStyle(isMobile)}>
      <header style={workspaceHeaderStyle(isMobile)}>
        <div style={headerCopyStyle}>
          <div style={eyebrowStyle}>Music Workspace</div>
          <h1 style={titleStyle}>佛曲资料库</h1>
          <p style={subtitleStyle}>右侧工作区拆成三层：全部专辑、歌曲列表、专辑管理 / 歌曲编辑。</p>
        </div>
        <div style={headerMetaStyle}>
          {refreshing ? <span style={chipStyle("info")}>同步中</span> : null}
          <span style={chipStyle("neutral")}>{albums.length} 张专辑</span>
          <span style={chipStyle("neutral")}>{musics.length} 首当前歌曲</span>
        </div>
      </header>

      {toast ? <div style={toastStyle(toast.type)}>{toast.text}</div> : null}

      {screen === "albums" ? (
        <AlbumsScreen
          isMobile={isMobile}
          loading={loading}
          albums={albums}
          pagedAlbums={pagedAlbums}
          albumPage={albumPage}
          totalAlbumPages={totalAlbumPages}
          newAlbumName={newAlbumName}
          canManage={canManage}
          onChangeNewAlbumName={onChangeNewAlbumName}
          onCreateAlbum={onCreateAlbum}
          onOpenAlbumTracks={onOpenAlbumTracks}
          onOpenAlbumEditor={onOpenAlbumEditor}
          onAlbumPageChange={onAlbumPageChange}
          albumTrackCount={albumTrackCount}
        />
      ) : null}

      {screen === "tracks" ? (
        <TracksScreen
          isMobile={isMobile}
          albumName={selectedAlbumId ? selectedAlbumDetail?.name || "专辑歌曲" : "全部歌曲"}
          albumDescription={selectedAlbumId ? selectedAlbumDetail?.description || "" : ""}
          currentMusicId={currentMusicId}
          filteredMusics={filteredMusics}
          search={search}
          canManage={canManage}
          fileInputRef={fileInputRef}
          onOpenAlbums={onOpenAlbums}
          onBackToAlbums={onBackToAlbums}
          onChangeSearch={onChangeSearch}
          onSelectTrack={onSelectTrack}
          onOpenAlbumEditor={() => (selectedAlbumId ? onOpenAlbumEditor(selectedAlbumId) : Promise.resolve())}
          onOpenTrackEditor={onOpenTrackEditor}
          onUploadMusic={onUploadMusic}
          uploadingMusic={uploadingMusic}
          hasSelectedAlbum={Boolean(selectedAlbumId)}
          onQueueTrack={onQueueTrack}
        />
      ) : null}

      {screen === "editor" ? (
        <EditorScreen
          isMobile={isMobile}
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
      ) : null}
    </section>
  );
}

function AlbumsScreen({
  isMobile,
  loading,
  albums,
  pagedAlbums,
  albumPage,
  totalAlbumPages,
  newAlbumName,
  canManage,
  onChangeNewAlbumName,
  onCreateAlbum,
  onOpenAlbumTracks,
  onOpenAlbumEditor,
  onAlbumPageChange,
  albumTrackCount,
}: {
  isMobile: boolean;
  loading: boolean;
  albums: AlbumRecord[];
  pagedAlbums: AlbumRecord[];
  albumPage: number;
  totalAlbumPages: number;
  newAlbumName: string;
  canManage: boolean;
  onChangeNewAlbumName: (value: string) => void;
  onCreateAlbum: () => Promise<void>;
  onOpenAlbumTracks: (albumId: number | null) => Promise<void>;
  onOpenAlbumEditor: (albumId: number) => Promise<void>;
  onAlbumPageChange: (page: number) => void;
  albumTrackCount: (albumId: number) => number;
}) {
  return (
    <div style={screenStackStyle}>
      <section style={sectionCardStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <div style={sectionTitleStyle}>全部专辑</div>
            <p style={sectionCopyStyle}>先从总览进入，再切到歌曲列表和编辑界面。</p>
          </div>
          <button type="button" style={ghostButtonStyle} onClick={() => void onOpenAlbumTracks(null)}>
            打开全部歌曲
          </button>
        </div>

        {canManage ? (
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

        {loading ? <div style={emptyStateStyle}>载入专辑中…</div> : null}

        {!loading ? (
          <div style={albumGridStyle(isMobile)}>
            <button type="button" style={albumCardStyle} onClick={() => void onOpenAlbumTracks(null)}>
              <div style={albumArtPlaceholderStyle}>全部</div>
              <div style={albumNameStyle}>全部歌曲</div>
              <div style={albumMetaStyle}>{albums.reduce((sum, album) => sum + albumTrackCount(album.id), 0)} 首</div>
            </button>

            {pagedAlbums.map((album) => (
              <article key={album.id} style={albumCardStyle}>
                <button type="button" style={albumOpenButtonStyle} onClick={() => void onOpenAlbumTracks(album.id)}>
                  <img src={resolveAlbumCoverUrl(album.cover_url)} alt={album.name} style={albumArtStyle} />
                </button>
                <div style={albumCardBodyStyle}>
                  <div>
                    <div style={albumNameStyle}>{album.name}</div>
                    <div style={albumMetaStyle}>{albumTrackCount(album.id)} 首歌曲</div>
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
      </section>
    </div>
  );
}

function TracksScreen({
  isMobile,
  albumName,
  albumDescription,
  currentMusicId,
  filteredMusics,
  search,
  canManage,
  fileInputRef,
  onOpenAlbums,
  onBackToAlbums,
  onChangeSearch,
  onSelectTrack,
  onOpenAlbumEditor,
  onOpenTrackEditor,
  onUploadMusic,
  uploadingMusic,
  hasSelectedAlbum,
  onQueueTrack,
}: {
  isMobile: boolean;
  albumName: string;
  albumDescription: string;
  currentMusicId: number | null;
  filteredMusics: MusicRecord[];
  search: string;
  canManage: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onOpenAlbums: () => void;
  onBackToAlbums: () => void;
  onChangeSearch: (value: string) => void;
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
          <div style={toolbarStyle(isMobile)}>
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

        <div style={createBarStyle(isMobile)}>
          <input
            value={search}
            onChange={(event) => onChangeSearch(event.target.value)}
            placeholder="搜索歌曲标题"
            style={inputStyle}
          />
          {canManage && hasSelectedAlbum ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp3,.wav,.wma"
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
            {filteredMusics.map((music, index) => (
              <article key={music.id} style={trackRowStyle(music.id === currentMusicId)}>
                <button type="button" style={trackPlayButtonStyle} onClick={() => onSelectTrack(music.id)}>
                  <span style={trackIndexStyle}>{String(index + 1).padStart(2, "0")}</span>
                  <span style={trackMainStyle}>
                    <span style={trackNameStyle}>{music.title}</span>
                    <span style={trackMetaStyle}>{music.album?.name || albumName}</span>
                  </span>
                </button>
                <button type="button" style={secondaryButtonStyle} onClick={() => onQueueTrack(music.id)}>
                  +列队
                </button>
                {canManage ? (
                  <button type="button" style={ghostButtonStyle} onClick={() => void onOpenTrackEditor(music.id)}>
                    编辑
                  </button>
                ) : null}
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

function EditorScreen({
  isMobile,
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
  isMobile: boolean;
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
          <div style={editorGridStyle(isMobile)}>
            <div style={previewCardStyle}>
              <img src={resolveAlbumCoverUrl(selectedAlbumDetail?.cover_url)} alt={selectedAlbumDetail?.name ?? ""} style={albumArtStyle} />
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
          <div style={editorGridStyle(isMobile)}>
            <div style={previewCardStyle}>
              <img src={resolveAlbumCoverUrl(editingMusicDetail?.cover_url)} alt={editingMusicDetail?.title ?? ""} style={albumArtStyle} />
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

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "34px",
  lineHeight: 1.05,
  color: "var(--x-color-ink)",
};

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
    gap: "20px",
    minWidth: 0,
    padding: isMobile ? "20px" : "28px",
    borderRadius: "32px",
    background: "rgba(255,255,255,0.95)",
    border: "1px solid rgba(216, 223, 235, 0.95)",
    boxShadow: "0 20px 45px rgba(15, 23, 42, 0.08)",
  };
}

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

const createBarStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gap: "12px",
  gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto",
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

const albumGridStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gap: "16px",
  gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(210px, 1fr))",
});

const albumCardStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  padding: "14px",
  borderRadius: "20px",
  border: "1px solid rgba(216,223,235,0.9)",
  background: "rgba(255,255,255,0.98)",
};

const albumOpenButtonStyle: CSSProperties = {
  padding: 0,
  border: "none",
  background: "transparent",
  cursor: "pointer",
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

const toolbarStyle = (isMobile: boolean): CSSProperties => ({
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  width: isMobile ? "100%" : "auto",
});

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

const emptyStateStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "18px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  textAlign: "center",
};

const editorGridStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gap: "18px",
  gridTemplateColumns: isMobile ? "1fr" : "280px minmax(0, 1fr)",
});

const previewCardStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  alignContent: "start",
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

const editorActionBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "12px",
};

const editorHintStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};
