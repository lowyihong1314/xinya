import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { useUserState } from "../../../app/UserState";
import { ensureDesignTokens } from "../../../theme/designTokens";
import {
  PINNED_ALL_SONGS_AUDIO_CACHE_SCOPE,
  buildMusicAudioRevision,
} from "../logic/musicAudioCache";
import { fetchMinuteLogs } from "../logic/api";
import { getPinnedAllSongsCacheCandidates, sortAllSongsByListOrder } from "../logic/musicListOrder";
import { resolveNextQueuedTrack } from "../logic/musicQueueCache";
import type { AlbumDraft, TrackDraft, Toast } from "../logic/workspaceTypes";
import { MobileMusicShell } from "../ui/mobile/MobileMusicShell";
import type { MusicPlaybackSection } from "../ui/mobile/MobileMusicSectionNav";
import { MusicListeningPanel } from "../ui/shared/MusicListeningPanel";
import { MusicPlayerPanel } from "../ui/shared/MusicPlayerPanel";
import { MusicQueuePanel } from "../ui/shared/MusicQueuePanel";
import {
  countUniqueListeners,
  groupMinuteLogsIntoSessions,
  sumSessionMinutes,
  type ListeningSessionRecord,
} from "../ui/shared/listeningActivityShared";
import { MusicWorkspacePanel } from "../ui/web/MusicWorkspacePanel";
import { musicPlayerLightThemeStyle } from "../ui/shared/musicPlayerLightTheme";
import { NativeApkMusic, normalizeMusicSnapshot } from "./nativeMusicClient";
import type { AlbumRecord, MusicRecord, MusicSnapshot } from "./types";

type ApkScreen = "albums" | "tracks";

const EMPTY_SNAPSHOT = normalizeMusicSnapshot();
const PAGE_SIZE = 20;
const EMPTY_ALBUM_DRAFT: AlbumDraft = { name: "", description: "" };
const EMPTY_TRACK_DRAFT: TrackDraft = { title: "", album_id: "" };

async function noopAsync() {
  return undefined;
}

export function MusicPageApk() {
  ensureDesignTokens();

  const { isAuthenticated } = useUserState();
  const canViewListening = isAuthenticated;
  const [snapshot, setSnapshot] = useState<MusicSnapshot>(EMPTY_SNAPSHOT);
  const [activeSection, setActiveSection] = useState<MusicPlaybackSection>("browse");
  const [screen, setScreen] = useState<ApkScreen>("albums");
  const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(null);
  const [showAllSongs, setShowAllSongs] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listeningLoading, setListeningLoading] = useState(false);
  const [listeningLoaded, setListeningLoaded] = useState(false);
  const [fetchedListeningTimezone, setFetchedListeningTimezone] = useState("Asia/Kuala_Lumpur");
  const [fetchedListeningSessions, setFetchedListeningSessions] = useState<ListeningSessionRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [albumPage, setAlbumPage] = useState(1);
  const [trackPage, setTrackPage] = useState(1);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const savedScrollRef = useRef(0);
  const pendingScrollRestoreRef = useRef(false);

  const albums = snapshot.albums;
  const allMusics = snapshot.musics;
  const queue = snapshot.queue;
  const currentMusic = snapshot.currentMusic;
  const duration = snapshot.durationMs / 1000;
  const progress = snapshot.progressMs / 1000;
  const selectedAlbum = useMemo(
    () => albums.find((album) => album.id === selectedAlbumId) || null,
    [albums, selectedAlbumId],
  );
  const toast: Toast = errorText ? { type: "error", text: errorText } : null;
  const listeningSessions = listeningLoaded ? fetchedListeningSessions : snapshot.listeningSessions;
  const listeningTimezone = listeningLoaded ? fetchedListeningTimezone : snapshot.listeningTimezone;
  const listeningSummary = useMemo(
    () => {
      if (!listeningLoaded) {
        return {
          totalMinutes: snapshot.listeningTotalMinutes,
          uniqueListeners: snapshot.listeningUniqueListeners,
        };
      }
      return {
        totalMinutes: sumSessionMinutes(listeningSessions),
        uniqueListeners: countUniqueListeners(listeningSessions),
      };
    },
    [
      fetchedListeningSessions,
      listeningLoaded,
      listeningSessions,
      snapshot.listeningTotalMinutes,
      snapshot.listeningUniqueListeners,
    ],
  );

  const refreshListeningActivity = useCallback(
    async (options?: { silent?: boolean; isCancelled?: () => boolean }) => {
      if (!canViewListening) {
        return;
      }
      if (!options?.silent) {
        setListeningLoading(true);
      }
      try {
        const payload = await fetchMinuteLogs({ perPage: 240 });
        if (options?.isCancelled?.()) {
          return;
        }
        setFetchedListeningSessions(groupMinuteLogsIntoSessions(payload.items || []));
        setFetchedListeningTimezone(payload.timezone || "Asia/Kuala_Lumpur");
        setListeningLoaded(true);
      } catch (error) {
        if (!options?.isCancelled?.()) {
          setErrorText(error instanceof Error ? error.message : "读取听歌记录失败");
        }
      } finally {
        if (!options?.silent && !options?.isCancelled?.()) {
          setListeningLoading(false);
        }
      }
    },
    [canViewListening],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorText(null);

    void NativeApkMusic.bootstrap(canViewListening)
      .then((nextSnapshot) => {
        if (!cancelled) {
          setSnapshot(nextSnapshot);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : "原生音乐初始化失败");
          setSnapshot(EMPTY_SNAPSHOT);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canViewListening]);

  useEffect(() => {
    if (!canViewListening) {
      setListeningLoaded(false);
      setFetchedListeningSessions([]);
      setFetchedListeningTimezone("Asia/Kuala_Lumpur");
      setListeningLoading(false);
      return;
    }

    let cancelled = false;
    void refreshListeningActivity({ isCancelled: () => cancelled });

    return () => {
      cancelled = true;
    };
  }, [canViewListening, refreshListeningActivity]);

  useEffect(() => {
    if (!canViewListening || activeSection !== "history") {
      return;
    }

    let cancelled = false;
    const refresh = () => {
      void refreshListeningActivity({
        silent: true,
        isCancelled: () => cancelled,
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSection, canViewListening, refreshListeningActivity]);

  useEffect(() => {
    let active = true;
    const handles: Array<{ remove: () => Promise<void> | void }> = [];

    async function bindListeners() {
      try {
        const refresh = async () => {
          try {
            const nextSnapshot = await NativeApkMusic.getSnapshot();
            if (active) {
              setSnapshot(nextSnapshot);
            }
          } catch (error) {
            if (active) {
              console.error("Native music snapshot refresh failed", error);
            }
          }
        };

        const listeners = await Promise.all([
          NativeApkMusic.addListener("trackChanged", refresh),
          NativeApkMusic.addListener("trackEnded", refresh),
          NativeApkMusic.addListener("playStateChanged", refresh),
        ]);
        if (!active) {
          await Promise.all(listeners.map((listener) => listener.remove()));
          return;
        }
        handles.push(...listeners);
      } catch (error) {
        if (active) {
          console.error("Native music listener setup failed", error);
        }
      }
    }

    void bindListeners();

    return () => {
      active = false;
      void Promise.all(handles.map((listener) => listener.remove()));
    };
  }, []);

  useEffect(() => {
    if (!snapshot.hasPlaybackSession) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      void NativeApkMusic.getSnapshot()
        .then((nextSnapshot) => {
          if (!cancelled) {
            setSnapshot(nextSnapshot);
          }
        })
        .catch(() => undefined);
    }, activeSection === "player" ? 500 : 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSection, snapshot.hasPlaybackSession]);

  useLayoutEffect(() => {
    if (screen === "albums" && pendingScrollRestoreRef.current) {
      pendingScrollRestoreRef.current = false;
      window.scrollTo({ top: savedScrollRef.current, behavior: "auto" });
    }
  }, [screen]);

  useEffect(() => {
    setAlbumPage(1);
  }, [searchQuery]);

  useEffect(() => {
    setTrackPage(1);
  }, [screen, searchQuery, selectedAlbumId, showAllSongs]);

  const allMusicsSorted = useMemo(
    () => sortAllSongsByListOrder(allMusics),
    [allMusics],
  );
  const pinnedAllSongsCacheTracks = useMemo(
    () => getPinnedAllSongsCacheCandidates(allMusicsSorted),
    [allMusicsSorted],
  );
  const pinnedAllSongsCacheSignature = useMemo(
    () => pinnedAllSongsCacheTracks.map((music) => buildMusicAudioRevision(music)).join("|"),
    [pinnedAllSongsCacheTracks],
  );
  const nextQueuedTrack = useMemo(
    () => resolveNextQueuedTrack(queue, currentMusic?.id ?? null, snapshot.repeatMode),
    [queue, currentMusic?.id, snapshot.repeatMode],
  );
  const cacheChainTracks = useMemo(() => {
    const byId = new Map<number, MusicRecord>();
    pinnedAllSongsCacheTracks.forEach((music) => {
      byId.set(music.id, music);
    });
    if (nextQueuedTrack) {
      byId.set(nextQueuedTrack.id, nextQueuedTrack);
    }
    return [...byId.values()];
  }, [nextQueuedTrack, pinnedAllSongsCacheTracks]);
  const cacheChainSignature = useMemo(
    () => cacheChainTracks.map((music) => buildMusicAudioRevision(music)).join("|"),
    [cacheChainTracks],
  );

  useEffect(() => {
    let cancelled = false;

    void NativeApkMusic.syncCachedTrackSources(cacheChainTracks, {
      scope: PINNED_ALL_SONGS_AUDIO_CACHE_SCOPE,
    }).catch((error) => {
      if (!cancelled) {
        console.warn("APK audio cache chain sync failed", error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [cacheChainSignature]);

  const albumNameByMusicId = useMemo(
    () =>
      new Map(
        allMusics.map((music) => [music.id, music.album?.name || "全部歌曲"]),
      ),
    [allMusics],
  );
  const trackCountByAlbumId = useMemo(() => {
    const next = new Map<number, number>();
    for (const music of allMusics) {
      if (music.album_id == null) continue;
      next.set(music.album_id, (next.get(music.album_id) || 0) + 1);
    }
    return next;
  }, [allMusics]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const hasSearch = normalizedQuery.length > 0;
  const matchesTrackSearch = (music: MusicRecord) => {
    if (!hasSearch) return true;
    const albumName = (albumNameByMusicId.get(music.id) || "").toLowerCase();
    return music.title.toLowerCase().includes(normalizedQuery) || albumName.includes(normalizedQuery);
  };

  const filteredAlbums = useMemo(() => {
    if (!hasSearch) {
      return albums;
    }
    return albums.filter((album) => {
      if (album.name.toLowerCase().includes(normalizedQuery)) {
        return true;
      }
      return allMusics.some((music) => music.album_id === album.id && matchesTrackSearch(music));
    });
  }, [albums, allMusics, hasSearch, normalizedQuery]);
  const filteredLibraryMusicCount = useMemo(
    () => allMusics.filter((music) => matchesTrackSearch(music)).length,
    [allMusics, hasSearch, normalizedQuery],
  );

  const totalAlbumPages = Math.max(1, Math.ceil(filteredAlbums.length / PAGE_SIZE));
  const safeAlbumPage = Math.min(albumPage, totalAlbumPages);
  const pagedAlbums = useMemo(() => {
    const start = (safeAlbumPage - 1) * PAGE_SIZE;
    return filteredAlbums.slice(start, start + PAGE_SIZE);
  }, [filteredAlbums, safeAlbumPage]);

  const albumTracks = useMemo(() => {
    if (showAllSongs) {
      return allMusicsSorted;
    }
    if (!selectedAlbum) {
      return [];
    }
    return allMusics.filter((music) => music.album_id === selectedAlbum.id);
  }, [allMusics, allMusicsSorted, selectedAlbum, showAllSongs]);
  const filteredAlbumTracks = useMemo(
    () => albumTracks.filter((music) => matchesTrackSearch(music)),
    [albumTracks, hasSearch, normalizedQuery],
  );
  const totalTrackPages = Math.max(1, Math.ceil(filteredAlbumTracks.length / PAGE_SIZE));
  const safeTrackPage = Math.min(trackPage, totalTrackPages);
  const pagedFilteredMusics = useMemo(() => {
    const start = (safeTrackPage - 1) * PAGE_SIZE;
    return filteredAlbumTracks.slice(start, start + PAGE_SIZE);
  }, [filteredAlbumTracks, safeTrackPage]);

  function openAlbum(album: AlbumRecord | null) {
    savedScrollRef.current = window.scrollY;
    setSelectedAlbumId(album?.id ?? null);
    setShowAllSongs(album == null);
    setScreen("tracks");
  }

  function returnToAlbums() {
    pendingScrollRestoreRef.current = true;
    setScreen("albums");
  }

  async function runNativeAction(action: Promise<MusicSnapshot>) {
    try {
      setErrorText(null);
      const nextSnapshot = await action;
      setSnapshot(nextSnapshot);
    } catch (error) {
      console.error("Native APK music action failed", error);
      setErrorText(error instanceof Error ? error.message : "原生音乐操作失败");
    }
  }

  function resolveTrackSelectionQueueIds() {
    if (selectedAlbumId != null) {
      return albumTracks.map((music) => music.id);
    }
    const source = filteredAlbumTracks.length ? filteredAlbumTracks : allMusicsSorted;
    return source.map((music) => music.id);
  }

  function handleSelectTrack(musicId: number) {
    setActiveSection("player");
    void runNativeAction(NativeApkMusic.playMusic(musicId, resolveTrackSelectionQueueIds()));
  }

  async function handleOpenAlbumTracks(albumId: number | null) {
    openAlbum(albumId == null ? null : albums.find((album) => album.id === albumId) || null);
    return undefined;
  }

  const sectionTabs = [
    {
      key: "browse" as const,
      label: "找歌",
      iconClassName: "fas fa-magnifying-glass",
    },
    {
      key: "player" as const,
      label: "播放器",
      iconClassName: "fas fa-circle-play",
    },
    {
      key: "queue" as const,
      label: "列队",
      iconClassName: "fas fa-list-ul",
      count: queue.length,
    },
    ...(canViewListening
      ? [
          {
            key: "history" as const,
            label: "听歌记录",
            iconClassName: "fas fa-chart-column",
          },
        ]
      : []),
  ];

  return (
    <div style={pageShellStyle}>
      <div style={layoutStyle}>
        <MobileMusicShell
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          sectionTabs={sectionTabs}
          browsePane={
            <MusicWorkspacePanel
              isMobile
              screen={screen}
              editorMode={null}
              loading={loading}
              refreshing={false}
              albums={albums}
              filteredAlbums={filteredAlbums}
              filteredLibraryMusicCount={filteredLibraryMusicCount}
              pagedAlbums={pagedAlbums}
              albumPage={safeAlbumPage}
              totalAlbumPages={totalAlbumPages}
              pagedFilteredMusics={pagedFilteredMusics}
              trackPage={safeTrackPage}
              totalTrackPages={totalTrackPages}
              selectedAlbumId={selectedAlbumId}
              selectedAlbumDetail={selectedAlbum}
              musics={showAllSongs ? allMusicsSorted : albumTracks}
              filteredMusics={filteredAlbumTracks}
              currentMusicId={currentMusic?.id ?? null}
              editingMusicDetail={null}
              search={searchQuery}
              albumDraft={EMPTY_ALBUM_DRAFT}
              trackDraft={EMPTY_TRACK_DRAFT}
              toast={toast}
              canViewListening={canViewListening}
              listeningSummary={listeningSummary}
              savingAlbum={false}
              savingTrack={false}
              uploadingMusic={false}
              replacingFile={false}
              canManage={false}
              coverInputRef={coverInputRef}
              replaceInputRef={replaceInputRef}
              onChangeSearch={setSearchQuery}
              onChangeAlbumDraft={() => undefined}
              onChangeTrackDraft={() => undefined}
              onCreateAlbum={noopAsync}
              onOpenAlbums={returnToAlbums}
              onOpenAlbumTracks={handleOpenAlbumTracks}
              onOpenAlbumEditor={noopAsync}
              onOpenTrackEditor={noopAsync}
              onBackFromEditor={returnToAlbums}
              onBackToAlbums={returnToAlbums}
              onDeleteAlbum={noopAsync}
              onSaveAlbum={noopAsync}
              onPickCover={() => undefined}
              onCoverSelected={noopAsync}
              onUploadMusic={noopAsync}
              onSelectTrack={handleSelectTrack}
              onQueueTrack={(musicId) => {
                setActiveSection("queue");
                void runNativeAction(NativeApkMusic.appendToQueue(musicId));
              }}
              onSaveTrack={noopAsync}
              onDeleteTrack={noopAsync}
              onPickReplaceFile={() => undefined}
              onReplaceSelected={noopAsync}
              onAlbumPageChange={setAlbumPage}
              onTrackPageChange={setTrackPage}
              albumTrackCount={(albumId) => trackCountByAlbumId.get(albumId) || 0}
            />
          }
          playerPane={
            <MusicPlayerPanel
              isMobile
              currentMusic={currentMusic}
              albumName={currentMusic?.album?.name || "未分配专辑"}
              isPlaying={snapshot.isPlaying}
              currentTime={progress}
              duration={duration}
              shuffleEnabled={snapshot.shuffleEnabled}
              repeatMode={snapshot.repeatMode}
              hasQueue={queue.length > 0}
              onToggleShuffle={() => void runNativeAction(NativeApkMusic.toggleShuffle())}
              onCycleRepeat={() => void runNativeAction(NativeApkMusic.cycleRepeat())}
              onPlayPrevious={() => void runNativeAction(NativeApkMusic.playRelative(-1))}
              onPlayNext={() => void runNativeAction(NativeApkMusic.playRelative(1))}
              onTogglePlay={() => void runNativeAction(NativeApkMusic.togglePlayback())}
              onSeek={(nextTime) => void runNativeAction(NativeApkMusic.seekTo(Math.max(nextTime, 0) * 1000))}
            />
          }
          queuePane={
            <MusicQueuePanel
              isMobile
              queue={queue}
              currentMusic={currentMusic}
              currentMusicId={currentMusic?.id ?? null}
              onOpenPlayer={() => setActiveSection("player")}
              onPlayFromQueue={(musicId) => void runNativeAction(NativeApkMusic.playFromQueue(musicId))}
              onRemoveFromQueue={(musicId) => void runNativeAction(NativeApkMusic.removeFromQueue(musicId))}
              onClearQueue={() => void runNativeAction(NativeApkMusic.clearQueue())}
            />
          }
          historyPane={
            canViewListening ? (
              <MusicListeningPanel
                isMobile
                loading={loading || listeningLoading}
                timezone={listeningTimezone}
                totalMinutes={listeningSummary.totalMinutes}
                uniqueListeners={listeningSummary.uniqueListeners}
                sessions={listeningSessions}
              />
            ) : undefined
          }
        />
      </div>
    </div>
  );
}

const pageShellStyle: CSSProperties = {
  ...musicPlayerLightThemeStyle,
  minHeight: "100%",
  padding: "12px 12px calc(92px + env(safe-area-inset-bottom, 0px))",
  background:
    "radial-gradient(circle at top left, var(--x-color-accent-tint-strong), transparent 32%), linear-gradient(180deg, var(--x-color-canvas) 0%, var(--x-color-panel-alt) 100%)",
};

const layoutStyle: CSSProperties = {
  width: "min(1360px, 100%)",
  margin: "0 auto",
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "1fr",
  alignItems: "start",
};
