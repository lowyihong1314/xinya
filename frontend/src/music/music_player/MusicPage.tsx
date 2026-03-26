import { ensureDesignTokens } from "../../theme/designTokens";
import { MusicWorkspacePanel } from "./MusicWorkspacePanel";
import { useMusicWorkspace } from "./useMusicWorkspace";

export function MusicPage() {
  ensureDesignTokens();

  const { state, actions } = useMusicWorkspace();

  return (
    <div style={pageShellStyle}>
      <div style={layoutStyle(state.isMobile)}>
        <MusicWorkspacePanel
          isMobile={state.isMobile}
          screen={state.screen}
          editorMode={state.editorMode}
          loading={state.loading}
          refreshing={state.refreshing}
          albums={state.albums}
          pagedAlbums={state.pagedAlbums}
          albumPage={state.albumPage}
          totalAlbumPages={state.totalAlbumPages}
          selectedAlbumId={state.selectedAlbumId}
          selectedAlbumDetail={state.selectedAlbumDetail}
          musics={state.musics}
          filteredMusics={state.filteredMusics}
          currentMusicId={state.currentMusicId}
          editingMusicDetail={state.editingMusicDetail}
          search={state.search}
          newAlbumName={state.newAlbumName}
          albumDraft={state.albumDraft}
          trackDraft={state.trackDraft}
          toast={state.toast}
          savingAlbum={state.savingAlbum}
          savingTrack={state.savingTrack}
          uploadingMusic={state.uploadingMusic}
          replacingFile={state.replacingFile}
          canManage={state.canManage}
          fileInputRef={state.fileInputRef}
          coverInputRef={state.coverInputRef}
          replaceInputRef={state.replaceInputRef}
          onChangeSearch={actions.setSearch}
          onChangeNewAlbumName={actions.setNewAlbumName}
          onChangeAlbumDraft={actions.setAlbumDraft}
          onChangeTrackDraft={actions.setTrackDraft}
          onCreateAlbum={actions.handleCreateAlbum}
          onOpenAlbums={actions.openAlbums}
          onOpenAlbumTracks={actions.openAlbumTracks}
          onOpenAlbumEditor={actions.openAlbumEditor}
          onOpenTrackEditor={actions.openTrackEditor}
          onBackFromEditor={actions.backFromEditor}
          onBackToAlbums={actions.backToAlbums}
          onDeleteAlbum={actions.handleDeleteAlbum}
          onSaveAlbum={actions.handleSaveAlbum}
          onPickCover={() => state.coverInputRef.current?.click()}
          onCoverSelected={actions.handleCoverSelected}
          onUploadMusic={actions.handleUploadMusic}
          onSelectTrack={actions.handleSelectTrack}
          onQueueTrack={actions.handleQueueTrack}
          onSaveTrack={actions.handleSaveTrack}
          onDeleteTrack={actions.handleDeleteTrack}
          onPickReplaceFile={() => state.replaceInputRef.current?.click()}
          onReplaceSelected={actions.handleReplaceSelected}
          onAlbumPageChange={actions.setAlbumPage}
          albumTrackCount={(albumId) => state.albumTrackCountMap.get(albumId) || 0}
        />
      </div>
    </div>
  );
}

const pageShellStyle = {
  minHeight: "100%",
  padding: "24px",
  background:
    "radial-gradient(circle at top left, rgba(15,118,110,0.18), transparent 32%), linear-gradient(180deg, #eef3f9 0%, #f6f8fc 100%)",
};

const layoutStyle = (isMobile: boolean) => ({
  width: "min(1360px, 100%)",
  margin: "0 auto",
  display: "grid",
  gap: "24px",
  gridTemplateColumns: "1fr",
  alignItems: "start",
});
