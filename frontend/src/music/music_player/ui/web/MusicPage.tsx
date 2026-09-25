import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAppChrome } from "../../../../router/AppChromeContext";
import { useUserState } from "../../../../app/UserState";
import { useEnsureDesignTokens } from "../../../../theme/designTokens";
import { MusicPlaybackWorkspace } from "./MusicPlaybackWorkspace";
import { MusicWorkspacePanel, type MusicLibraryTab } from "./MusicWorkspacePanel";
import { useMusicPlayback } from "../../logic/MusicPlaybackContext";
import { useMusicPlaylists } from "../../logic/useMusicPlaylists";
import { useMusicWorkspace } from "../../logic/useMusicWorkspace";
import { MusicPlaylistsPanel } from "../shared/MusicPlaylistsPanel";
import { musicAudioUploadAccept } from "../shared/audioUpload";
import { musicPlayerLightThemeStyle } from "../shared/musicPlayerLightTheme";
import {
  parseMusicPlayerRouteStateFromLocation,
  patchMusicPlayerRouteState,
  type MusicPlayerRouteState,
} from "../../logic/routeState";
import { useMusicViewport } from "../../../shared/useMusicViewport";

export function MusicPage() {
  const viewport = useMusicViewport();
  useEnsureDesignTokens();

  const [layoutMetrics, setLayoutMetrics] = useState({
    contentHeight: null as number | null,
    stickyTop: 84,
  });
  const shellRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { navbarHeight } = useAppChrome();
  const routeState = useMemo(
    () =>
      parseMusicPlayerRouteStateFromLocation(
        location.pathname,
        new URLSearchParams(location.search),
      ),
    [location.pathname, location.search],
  );

  const updateRouteState = useCallback(
    (patch: Partial<MusicPlayerRouteState>, options?: { replace?: boolean }) => {
      const currentParams = new URLSearchParams(location.search);
      const next = patchMusicPlayerRouteState(location.pathname, currentParams, patch);
      const currentSearch = currentParams.toString();
      const nextSearch = next.searchParams.toString();
      if (next.pathname === location.pathname && nextSearch === currentSearch) {
        return;
      }
      navigate(
        {
          pathname: next.pathname,
          search: nextSearch ? `?${nextSearch}` : "",
        },
        { replace: options?.replace ?? false },
      );
    },
    [location.pathname, location.search, navigate],
  );

  const routeActions = useMemo(
    () => ({
      setSearch: (value: string, options?: { replace?: boolean }) => {
        updateRouteState({ search: value, albumPage: 1, trackPage: 1 }, options);
      },
      setAlbumPage: (page: number, options?: { replace?: boolean }) => {
        updateRouteState({ albumPage: Math.max(1, page) }, options);
      },
      setTrackPage: (
        page: number,
        options?: { replace?: boolean },
      ) => {
        updateRouteState({ trackPage: Math.max(1, page) }, options);
      },
      openAlbums: (options?: { replace?: boolean }) => {
        updateRouteState(
          {
            screen: "albums",
            editorMode: null,
            albumId: null,
            musicId: null,
          },
          options,
        );
      },
      openAlbumTracks: (
        albumId: number | null,
        options?: { clearSearch?: boolean; replace?: boolean; resetTrackPage?: boolean },
      ) => {
        const routePatch: Partial<MusicPlayerRouteState> = {
          screen: "tracks",
          editorMode: null,
          albumId,
          musicId: null,
          trackPage: options?.resetTrackPage === false ? routeState.trackPage : 1,
        };
        if (options?.clearSearch) {
          routePatch.search = "";
        }
        updateRouteState(
          routePatch,
          options,
        );
      },
      openAlbumEditor: (albumId: number, options?: { replace?: boolean }) => {
        updateRouteState(
          {
            screen: "editor",
            editorMode: "album",
            albumId,
            musicId: null,
          },
          options,
        );
      },
      openTrackEditor: (
        musicId: number,
        albumId: number | null,
        options?: { replace?: boolean },
      ) => {
        updateRouteState(
          {
            screen: "editor",
            editorMode: "track",
            musicId,
            albumId,
          },
          options,
        );
      },
    }),
    [routeState.trackPage, updateRouteState],
  );

  const { state, actions } = useMusicWorkspace({
    routeState,
    routeActions,
  });

  // 我的歌单（歌单与用户多对多），登录后可用。
  const { user, isAuthenticated } = useUserState();
  const currentUserId = typeof user?.id === "number" ? user.id : null;
  const playback = useMusicPlayback();
  const [libraryTab, setLibraryTab] = useState<MusicLibraryTab>("library");
  const playlistsApi = useMusicPlaylists({
    enabled: isAuthenticated,
    libraryMusics: playback.libraryMusics,
    currentUserId,
  });

  useEffect(() => {
    if (routeState.section === "history" && !state.canViewListening) {
      updateRouteState({ section: "browse" }, { replace: true });
    }
    // 「歌单」不再是独立分区，改成资料库上方的页签。
    if (routeState.section === "playlists") {
      setLibraryTab("playlists");
      updateRouteState({ section: "browse" }, { replace: true });
    }
  }, [routeState.section, state.canViewListening, isAuthenticated, updateRouteState]);

  const playlistsPane = (
    <MusicPlaylistsPanel
      isMobile={state.isMobile}
      enabled={isAuthenticated}
      loading={playlistsApi.loading}
      busy={playlistsApi.busy}
      notice={playlistsApi.notice}
      playlists={playlistsApi.playlists}
publicPlaylists={playlistsApi.publicPlaylists}
      selectedPlaylist={playlistsApi.selectedPlaylist}
      currentMusicId={playback.currentMusicId}
      currentUserId={currentUserId}
      resolveTracks={playlistsApi.resolveTracks}
      onSelectPlaylist={playlistsApi.setSelectedPlaylistId}
      onCreate={() => void playlistsApi.handleCreate()}
      onRename={(playlist) => void playlistsApi.handleRename(playlist)}
      onDelete={(playlist) => void playlistsApi.handleDelete(playlist)}
      onLeave={(playlist) => void playlistsApi.handleLeave(playlist)}
      onPlayPlaylist={(playlist, startMusicId) => {
        const tracks = playlistsApi.resolveTracks(playlist);
        if (!tracks.length) return;
        playback.setQueue(tracks);
        playback.selectMusic(startMusicId ?? tracks[0].id);
        updateRouteState({ section: "player" });
      }}
      onQueuePlaylist={(playlist) => {
        playlistsApi.resolveTracks(playlist).forEach((music) => playback.appendToQueue(music.id));
        updateRouteState({ section: "queue" });
      }}
      onRemoveTrack={(playlist, musicId) => void playlistsApi.handleRemoveTrack(playlist, musicId)}
      onMoveTrack={(playlist, musicId, direction) => void playlistsApi.handleMoveTrack(playlist, musicId, direction)}
      onAddCurrentTrack={(playlist) => {
        if (playback.currentMusicId != null) void playlistsApi.handleAddTrack(playlist, playback.currentMusicId);
      }}
      onAddMember={(playlist) => void playlistsApi.handleAddMember(playlist)}
onTogglePublic={(playlist) => void playlistsApi.handleTogglePublic(playlist)}
      onRemoveMember={(playlist, userId, label) => void playlistsApi.handleRemoveMember(playlist, userId, label)}
    />
  );

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof window === "undefined") {
      return;
    }

    let frame = 0;
    const measure = () => {
      const shellStyle = window.getComputedStyle(shell);
      const paddingTop = parseFloat(shellStyle.paddingTop || "0") || 0;
      const paddingBottom = parseFloat(shellStyle.paddingBottom || "0") || 0;
      // 外壳已经钉在「视口 - 顶栏」的高度上并自己滚动，内部布局按外壳的实际高度算。
      const nextHeight = Math.max(320, Math.round(shell.clientHeight - paddingTop - paddingBottom));
      const nextStickyTop = Math.round(paddingTop);

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

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
    observer?.observe(shell);

    window.addEventListener("resize", scheduleMeasure);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleMeasure);
      observer?.disconnect();
    };
  }, [navbarHeight, viewport.contentHeight]);

  return (
    <div ref={shellRef} style={{ ...pageShellStyle(state.isMobile), ...viewport.shellStyle }}>
      {/* 伴奏文件选择器放在页面层，歌曲列表、播放器、编辑页的「上传伴奏 / 换伴奏」都用它。 */}
      <input
        ref={state.accompanimentInputRef}
        type="file"
        accept={musicAudioUploadAccept}
        hidden
        onChange={(event) => {
          void actions.handleAccompanimentSelected(event.target.files?.[0] || null);
        }}
      />
      <div style={layoutStyle(state.isMobile)}>
        <MusicPlaybackWorkspace
          isMobile={state.isMobile}
          activeSection={
            (routeState.section === "history" && !state.canViewListening) || routeState.section === "playlists"
              ? "browse"
              : routeState.section
          }
          onSectionChange={(section) => updateRouteState({ section })}
          canUsePlaylists={isAuthenticated}
          onAddCurrentToPlaylist={(musicId) => void playlistsApi.handleAddTrackWithPicker(musicId)}
          onUploadAccompaniment={state.canManage ? actions.pickAccompanimentFor : undefined}
          viewportHeight={layoutMetrics.contentHeight}
          stickyTop={layoutMetrics.stickyTop}
          pinnedAllSongsCacheIds={state.pinnedAllSongsCacheIds}
          canViewListening={state.canViewListening}
          listeningLoading={state.listeningLoading}
          listeningTimezone={state.listeningTimezone}
          listeningTotalMinutes={state.listeningSummary.totalMinutes}
          listeningUniqueListeners={state.listeningSummary.uniqueListeners}
          listeningSessions={state.listeningSessions}
          browsePane={
            <MusicWorkspacePanel
              isMobile={state.isMobile}
              libraryTab={libraryTab}
              onChangeLibraryTab={setLibraryTab}
              showPlaylistsTab={isAuthenticated}
              playlistsPane={playlistsPane}
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
              albumDraft={state.albumDraft}
              trackDraft={state.trackDraft}
              toast={state.toast}
              canViewListening={state.canViewListening}
              listeningSummary={state.listeningSummary}
              savingAlbum={state.savingAlbum}
              savingTrack={state.savingTrack}
              uploadingMusic={state.uploadingMusic}
              replacingFile={state.replacingFile}
              savingAccompaniment={state.savingAccompaniment}
              accompanimentInputRef={state.accompanimentInputRef}
              canManage={state.canManage}
              coverInputRef={state.coverInputRef}
              replaceInputRef={state.replaceInputRef}
              onChangeSearch={actions.setSearch}
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
                updateRouteState({ section: "player" });
              }}
              onQueueTrack={(musicId) => {
                actions.handleQueueTrack(musicId);
                updateRouteState({ section: "queue" });
              }}
              onAddToPlaylist={isAuthenticated ? (musicId) => void playlistsApi.handleAddTrackWithPicker(musicId) : undefined}
              onPickAccompanimentForTrack={state.canManage ? actions.pickAccompanimentFor : undefined}
              onSaveTrack={actions.handleSaveTrack}
              onDeleteTrack={actions.handleDeleteTrack}
              onPickReplaceFile={() => state.replaceInputRef.current?.click()}
              onReplaceSelected={actions.handleReplaceSelected}
              onPickAccompanimentFile={() => state.accompanimentInputRef.current?.click()}
              onAccompanimentSelected={actions.handleAccompanimentSelected}
              onDeleteAccompaniment={actions.handleDeleteAccompaniment}
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
  ...musicPlayerLightThemeStyle,
  padding: isMobile ? "10px 12px calc(52px + env(safe-area-inset-bottom, 0px))" : "24px",
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
