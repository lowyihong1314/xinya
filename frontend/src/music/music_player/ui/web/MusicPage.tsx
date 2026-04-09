import { useEffect, useRef, useState } from "react";

import { ensureDesignTokens } from "../../../../theme/designTokens";
import { MusicPlaybackWorkspace } from "./MusicPlaybackWorkspace";
import { MusicWorkspacePanel } from "./MusicWorkspacePanel";
import { useMusicWorkspace } from "../../logic/useMusicWorkspace";

export function MusicPage() {
  ensureDesignTokens();

  const [activeSection, setActiveSection] = useState<"browse" | "player" | "queue" | "history">("browse");
  const [layoutMetrics, setLayoutMetrics] = useState({
    contentHeight: null as number | null,
    stickyTop: 84,
  });
  const shellRef = useRef<HTMLDivElement | null>(null);
  const { state, actions } = useMusicWorkspace();

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof window === "undefined") {
      return;
    }

    let frame = 0;
    const measure = () => {
      const navbar = document.getElementById("base_navbar");
      const navHeight = navbar?.getBoundingClientRect().height ?? 0;
      const shellStyle = window.getComputedStyle(shell);
      const paddingTop = parseFloat(shellStyle.paddingTop || "0") || 0;
      const paddingBottom = parseFloat(shellStyle.paddingBottom || "0") || 0;
      const nextHeight = Math.max(320, Math.round(window.innerHeight - navHeight - paddingTop - paddingBottom));
      const nextStickyTop = Math.round(navHeight + paddingTop);

      setLayoutMetrics((current) => {
        if (current.contentHeight === nextHeight && current.stickyTop === nextStickyTop) {
          return current;
        }
        return {
          contentHeight: nextHeight,
          stickyTop: nextStickyTop,
        };
      });
    };

    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();

    const navbar = document.getElementById("base_navbar");
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
    observer?.observe(shell);
    if (navbar) {
      observer?.observe(navbar);
    }

    window.addEventListener("resize", scheduleMeasure);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleMeasure);
      observer?.disconnect();
    };
  }, []);

  return (
    <div ref={shellRef} style={pageShellStyle(state.isMobile)}>
      <div style={layoutStyle(state.isMobile)}>
        <MusicPlaybackWorkspace
          isMobile={state.isMobile}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          viewportHeight={layoutMetrics.contentHeight}
          stickyTop={layoutMetrics.stickyTop}
          canViewListening={state.canViewListening}
          listeningLoading={state.listeningLoading}
          listeningTimezone={state.listeningTimezone}
          listeningTotalMinutes={state.listeningSummary.totalMinutes}
          listeningUniqueListeners={state.listeningSummary.uniqueListeners}
          listeningSessions={state.listeningSessions}
          browsePane={
            <MusicWorkspacePanel
              isMobile={state.isMobile}
              screen={state.screen}
              editorMode={state.editorMode}
              loading={state.loading}
              refreshing={state.refreshing}
              albums={state.albums}
              filteredAlbums={state.filteredAlbums}
              filteredLibraryMusicCount={state.filteredLibraryMusicCount}
              pagedAlbums={state.pagedAlbums}
              albumPage={state.albumPage}
              totalAlbumPages={state.totalAlbumPages}
              pagedFilteredMusics={state.pagedFilteredMusics}
              trackPage={state.trackPage}
              totalTrackPages={state.totalTrackPages}
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
              canViewListening={state.canViewListening}
              listeningSummary={state.listeningSummary}
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
              onSelectTrack={(musicId) => {
                actions.handleSelectTrack(musicId);
                setActiveSection("player");
              }}
              onQueueTrack={(musicId) => {
                actions.handleQueueTrack(musicId);
                setActiveSection("queue");
              }}
              onSaveTrack={actions.handleSaveTrack}
              onDeleteTrack={actions.handleDeleteTrack}
              onPickReplaceFile={() => state.replaceInputRef.current?.click()}
              onReplaceSelected={actions.handleReplaceSelected}
              onAlbumPageChange={actions.setAlbumPage}
              onTrackPageChange={actions.setTrackPage}
              albumTrackCount={(albumId) => state.albumTrackCountMap.get(albumId) || 0}
            />
          }
        />
      </div>
    </div>
  );
}

const pageShellStyle = (isMobile: boolean) => ({
  minHeight: "100%",
  padding: isMobile ? "12px 12px calc(92px + env(safe-area-inset-bottom, 0px))" : "24px",
  background:
    "radial-gradient(circle at top left, var(--x-color-accent-tint-strong), transparent 32%), linear-gradient(180deg, var(--x-color-canvas) 0%, var(--x-color-panel-alt) 100%)",
});

const layoutStyle = (isMobile: boolean) => ({
  width: "min(1360px, 100%)",
  margin: "0 auto",
  display: "grid",
  gap: isMobile ? "12px" : "24px",
  gridTemplateColumns: "1fr",
  alignItems: "start",
});
