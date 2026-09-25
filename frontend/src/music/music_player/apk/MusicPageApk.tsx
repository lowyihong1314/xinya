import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useUserState } from "../../../app/UserState";
import { ensureDesignTokens } from "../../../theme/designTokens";
import { MUSIC_PLAYER_PATH } from "../../router/paths";
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
import { useMusicPlaylists } from "../logic/useMusicPlaylists";
import { usePlaybackDeviceSync } from "../logic/usePlaybackDeviceSync";
import { MusicListeningPanel } from "../ui/shared/MusicListeningPanel";
import { MusicPlayerPanel } from "../ui/shared/MusicPlayerPanel";
import { MusicPlaylistsPanel } from "../ui/shared/MusicPlaylistsPanel";
import { MusicQueuePanel } from "../ui/shared/MusicQueuePanel";
import {
  countUniqueListeners,
  groupMinuteLogsIntoSessions,
  sumSessionMinutes,
  type ListeningSessionRecord,
} from "../ui/shared/listeningActivityShared";
import { MusicWorkspacePanel, type MusicLibraryTab } from "../ui/web/MusicWorkspacePanel";
import { musicPlayerLightThemeStyle } from "../ui/shared/musicPlayerLightTheme";
import { NativeApkMusic, normalizeMusicSnapshot, progressFromSnapshot } from "./nativeMusicClient";
import type { AlbumRecord, MusicProgress, MusicRecord, MusicSnapshot } from "./types";
import { useMusicViewport } from "../../shared/useMusicViewport";

type ApkScreen = "albums" | "tracks";

const EMPTY_SNAPSHOT = normalizeMusicSnapshot();
const EMPTY_PROGRESS = progressFromSnapshot(EMPTY_SNAPSHOT);
const PAGE_SIZE = 20;
const SEEK_COMMIT_DELAY_MS = 150;
const SEEK_OVERRIDE_TIMEOUT_MS = 1500;
const EMPTY_ALBUM_DRAFT: AlbumDraft = { name: "", description: "" };
const EMPTY_TRACK_DRAFT: TrackDraft = { title: "", album_id: "" };

async function noopAsync() {
  return undefined;
}

function sameRecordArray<T>(prev: T[], next: T[]) {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let index = 0; index < prev.length; index += 1) {
    const a = prev[index];
    const b = next[index];
    if (a === b) continue;
    if (JSON.stringify(a) !== JSON.stringify(b)) return false;
  }
  return true;
}

/**
 * Merges a freshly fetched snapshot into the previous one, keeping array/object
 * references stable when their content did not change so downstream `useMemo`s
 * (sorting, filtering, pagination) do not recompute on every refresh.
 */
function mergeSnapshot(prev: MusicSnapshot, next: MusicSnapshot): MusicSnapshot {
  const albums = sameRecordArray(prev.albums, next.albums) ? prev.albums : next.albums;
  const musics = sameRecordArray(prev.musics, next.musics) ? prev.musics : next.musics;
  const queue = sameRecordArray(prev.queue, next.queue) ? prev.queue : next.queue;
  const listeningSessions = sameRecordArray(prev.listeningSessions, next.listeningSessions)
    ? prev.listeningSessions
    : next.listeningSessions;
  const currentMusic =
    prev.currentMusic &&
    next.currentMusic &&
    prev.currentMusic.id === next.currentMusic.id &&
    JSON.stringify(prev.currentMusic) === JSON.stringify(next.currentMusic)
      ? prev.currentMusic
      : next.currentMusic;

  const merged: MusicSnapshot = {
    ...next,
    albums,
    musics,
    queue,
    listeningSessions,
    currentMusic,
  };

  const structurallySame =
    albums === prev.albums &&
    musics === prev.musics &&
    queue === prev.queue &&
    listeningSessions === prev.listeningSessions &&
    currentMusic === prev.currentMusic &&
    prev.currentMusicId === next.currentMusicId &&
    prev.isPlaying === next.isPlaying &&
    prev.hasPlaybackSession === next.hasPlaybackSession &&
    prev.shuffleEnabled === next.shuffleEnabled &&
    prev.repeatMode === next.repeatMode &&
    prev.accompanimentMode === next.accompanimentMode &&
    prev.progressMs === next.progressMs &&
    prev.durationMs === next.durationMs &&
    prev.bufferedMs === next.bufferedMs &&
    prev.isBuffering === next.isBuffering &&
    prev.listeningTimezone === next.listeningTimezone &&
    prev.listeningTotalMinutes === next.listeningTotalMinutes &&
    prev.listeningUniqueListeners === next.listeningUniqueListeners &&
    prev.stateVersion === next.stateVersion;

  return structurallySame ? prev : merged;
}

function sameProgress(prev: MusicProgress, next: MusicProgress) {
  return (
    prev.positionMs === next.positionMs &&
    prev.durationMs === next.durationMs &&
    prev.bufferedPositionMs === next.bufferedPositionMs &&
    prev.isPlaying === next.isPlaying &&
    prev.isBuffering === next.isBuffering &&
    prev.currentMusicId === next.currentMusicId &&
    prev.hasPlaybackSession === next.hasPlaybackSession &&
    prev.shuffleEnabled === next.shuffleEnabled &&
    prev.repeatMode === next.repeatMode &&
    prev.accompanimentMode === next.accompanimentMode &&
    prev.pausedByRemoteDevice === next.pausedByRemoteDevice &&
    prev.stateVersion === next.stateVersion
  );
}

function getApkRouteSection(pathname: string, canViewListening: boolean): MusicPlaybackSection {
  const relativePath = pathname.startsWith(`${MUSIC_PLAYER_PATH}/`)
    ? pathname.slice(MUSIC_PLAYER_PATH.length + 1)
    : "";
  const [section] = relativePath.split("/").filter(Boolean);

  if (section === "player" || section === "queue") {
    return section;
  }
  if (section === "history" && canViewListening) {
    return "history";
  }
  return "browse";
}

function buildApkSectionPath(section: MusicPlaybackSection) {
  if (section === "player" || section === "queue" || section === "history") {
    return `${MUSIC_PLAYER_PATH}/${section}`;
  }
  return MUSIC_PLAYER_PATH;
}

export function MusicPageApk() {
  const viewport = useMusicViewport();
  ensureDesignTokens();

  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useUserState();
  const canViewListening = isAuthenticated;
  const currentUserId = typeof user?.id === "number" ? user.id : null;
  const [snapshot, setSnapshotState] = useState<MusicSnapshot>(EMPTY_SNAPSHOT);
  const [progress, setProgressState] = useState<MusicProgress>(EMPTY_PROGRESS);
  // Version of the last applied full snapshot; used to skip redundant full pulls.
  const knownStateVersionRef = useRef(0);
  const snapshotFetchRef = useRef<{ inFlight: boolean; queued: boolean }>({ inFlight: false, queued: false });
  // Seek scrubbing: show the dragged position immediately, commit natively after a short pause.
  const [seekOverrideSec, setSeekOverrideSec] = useState<number | null>(null);
  const seekCommitTimerRef = useRef<number | null>(null);
  const seekOverrideTimerRef = useRef<number | null>(null);
  const seekTargetMsRef = useRef<number | null>(null);

  const setSnapshot = useCallback((next: MusicSnapshot) => {
    knownStateVersionRef.current = Math.max(knownStateVersionRef.current, next.stateVersion);
    setSnapshotState((prev) => mergeSnapshot(prev, next));
    setProgressState((prev) => {
      const nextProgress = progressFromSnapshot(next);
      return sameProgress(prev, nextProgress) ? prev : nextProgress;
    });
  }, []);

  const setProgress = useCallback((next: MusicProgress) => {
    setProgressState((prev) => (sameProgress(prev, next) ? prev : next));
  }, []);
  const activeSection = useMemo(
    () => getApkRouteSection(location.pathname, canViewListening),
    [canViewListening, location.pathname],
  );
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
  const pageShellRef = useRef<HTMLDivElement | null>(null);

  const albums = snapshot.albums;
  const allMusics = snapshot.musics;
  const queue = snapshot.queue;
  const currentMusic = snapshot.currentMusic;
  const hasPlaybackSession = snapshot.hasPlaybackSession || progress.hasPlaybackSession;
  const isPlaying = progress.isPlaying;
  // 一人一设备：心跳/抢占由原生 MusicService 负责（WebView 被杀也还在），JS 只订阅推送来显示横幅和即时暂停。
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const deviceSync = usePlaybackDeviceSync({
    enabled: isAuthenticated,
    deviceId: snapshot.deviceId,
    deviceName: snapshot.deviceName,
    kind: "android",
    isPlaying,
    currentMusicId: currentMusic?.id ?? null,
    getPositionMs: () => progressRef.current.positionMs,
    getDurationMs: () => progressRef.current.durationMs,
    onRemoteTakeover: () => {
      void runNativeAction(NativeApkMusic.pause());
    },
    onTransferredToMe: (state) => {
      // 别处选中了手机：接着那首歌和进度播。
      if (state.music_id == null) return;
      const musicId = state.music_id;
      const position = state.position_ms || 0;
      void (async () => {
        await runNativeAction(NativeApkMusic.playMusic(musicId, queue.some((m) => m.id === musicId) ? queue.map((m) => m.id) : [musicId]));
        if (position > 0) await runNativeAction(NativeApkMusic.seekTo(position));
        if (!(state.resume || state.is_playing)) await runNativeAction(NativeApkMusic.pause());
      })();
    },
    onCommand: (action, payload) => {
      switch (action) {
        case "play":
          void runNativeAction(NativeApkMusic.resume());
          return;
        case "pause":
          void runNativeAction(NativeApkMusic.pause());
          return;
        case "toggle":
          void runNativeAction(NativeApkMusic.togglePlayback());
          return;
        case "next":
          void runNativeAction(NativeApkMusic.playRelative(1));
          return;
        case "previous":
          void runNativeAction(NativeApkMusic.playRelative(-1));
          return;
        case "seek": {
          const position = Number(payload.position_ms);
          if (Number.isFinite(position)) void runNativeAction(NativeApkMusic.seekTo(Math.max(0, Math.round(position))));
          return;
        }
        case "play_music": {
          const musicId = Number(payload.music_id);
          if (!Number.isFinite(musicId)) return;
          const ids = Array.isArray(payload.queue_ids)
            ? (payload.queue_ids as unknown[]).map((value) => Number(value)).filter((value) => Number.isFinite(value))
            : [];
          void runNativeAction(NativeApkMusic.playMusic(musicId, ids.length ? ids : [musicId]));
          return;
        }
        default:
          return;
      }
    },
    passive: true,
  });
  const remoteControl = deviceSync.remote;
  const remoteDeviceName = deviceSync.remoteDeviceName ?? (!remoteControl && (snapshot.pausedByRemoteDevice || progress.pausedByRemoteDevice) ? "其他设备" : null);
  const [remoteTick, setRemoteTick] = useState(0);
  useEffect(() => {
    if (!remoteControl?.isPlaying) return;
    const timer = window.setInterval(() => setRemoteTick((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, [remoteControl?.isPlaying, remoteControl?.deviceId]);
  void remoteTick;
  const remoteMusic = remoteControl && remoteControl.musicId != null ? allMusics.find((m) => m.id === remoteControl.musicId) ?? null : null;
  const duration = progress.durationMs / 1000;
  const playbackPositionSec = progress.positionMs / 1000;
  const displayedPositionSec = seekOverrideSec ?? playbackPositionSec;
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

  // Full snapshot pull, coalesced: concurrent requests collapse into at most one
  // follow-up fetch so a burst of native events does not fan out into N bridge calls.
  const refreshSnapshot = useCallback(
    async (isCancelled?: () => boolean) => {
      const state = snapshotFetchRef.current;
      if (state.inFlight) {
        state.queued = true;
        return;
      }
      state.inFlight = true;
      try {
        do {
          state.queued = false;
          try {
            const nextSnapshot = await NativeApkMusic.getSnapshot();
            if (isCancelled?.()) {
              return;
            }
            setSnapshot(nextSnapshot);
          } catch (error) {
            if (!isCancelled?.()) {
              console.error("Native music snapshot refresh failed", error);
            }
          }
        } while (state.queued && !isCancelled?.());
      } finally {
        state.inFlight = false;
      }
    },
    [setSnapshot],
  );

  // Lightweight progress pull; escalates to a full snapshot only when the native
  // state version moved (library / queue / current track / modes changed).
  const refreshProgress = useCallback(
    async (isCancelled?: () => boolean) => {
      try {
        const nextProgress = await NativeApkMusic.getProgress();
        if (isCancelled?.()) {
          return;
        }
        setProgress(nextProgress);
        if (nextProgress.stateVersion > knownStateVersionRef.current) {
          void refreshSnapshot(isCancelled);
        }
      } catch {
        // ignore transient bridge errors during polling
      }
    },
    [refreshSnapshot, setProgress],
  );

  useEffect(() => {
    let active = true;
    const handles: Array<{ remove: () => Promise<void> | void }> = [];
    const isCancelled = () => !active;

    async function bindListeners() {
      try {
        const onSnapshotChanged = (payload?: { version?: number }) => {
          const version = Number(payload?.version || 0);
          if (version > 0 && version <= knownStateVersionRef.current) {
            // Already applied via a method result (or an earlier event).
            void refreshProgress(isCancelled);
            return;
          }
          void refreshSnapshot(isCancelled);
        };
        const onPlaybackEvent = () => {
          void refreshProgress(isCancelled);
        };

        const listeners = await Promise.all([
          NativeApkMusic.addSnapshotChangedListener(onSnapshotChanged),
          NativeApkMusic.addListener("trackChanged", onPlaybackEvent),
          NativeApkMusic.addListener("trackEnded", onPlaybackEvent),
          NativeApkMusic.addListener("playStateChanged", onPlaybackEvent),
          NativeApkMusic.addListener("playbackTransferred", onSnapshotChanged),
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
  }, [refreshProgress, refreshSnapshot]);

  useEffect(() => {
    if (!hasPlaybackSession) {
      return;
    }

    let cancelled = false;
    const isCancelled = () => cancelled;
    const timer = window.setInterval(() => {
      void refreshProgress(isCancelled);
    }, activeSection === "player" ? 500 : 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSection, hasPlaybackSession, refreshProgress]);

  const clearSeekTimers = useCallback(() => {
    if (seekCommitTimerRef.current != null) {
      window.clearTimeout(seekCommitTimerRef.current);
      seekCommitTimerRef.current = null;
    }
    if (seekOverrideTimerRef.current != null) {
      window.clearTimeout(seekOverrideTimerRef.current);
      seekOverrideTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearSeekTimers, [clearSeekTimers]);

  // Release the local scrub override once the native position caught up with the target.
  useEffect(() => {
    if (seekOverrideSec == null || seekTargetMsRef.current == null) {
      return;
    }
    if (seekCommitTimerRef.current != null) {
      return; // still scrubbing, not committed yet
    }
    if (Math.abs(progress.positionMs - seekTargetMsRef.current) <= 1500) {
      seekTargetMsRef.current = null;
      setSeekOverrideSec(null);
      if (seekOverrideTimerRef.current != null) {
        window.clearTimeout(seekOverrideTimerRef.current);
        seekOverrideTimerRef.current = null;
      }
    }
  }, [progress.positionMs, seekOverrideSec]);

  const handleSeek = useCallback(
    (nextTime: number) => {
      const safeSec = Math.max(nextTime, 0);
      const targetMs = Math.round(safeSec * 1000);
      setSeekOverrideSec(safeSec);
      seekTargetMsRef.current = targetMs;
      if (seekCommitTimerRef.current != null) {
        window.clearTimeout(seekCommitTimerRef.current);
      }
      // Commit only after the scrub pauses (trailing debounce) instead of on every change event.
      seekCommitTimerRef.current = window.setTimeout(() => {
        seekCommitTimerRef.current = null;
        setErrorText(null);
        void NativeApkMusic.seekTo(targetMs)
          .then((nextSnapshot) => {
            setSnapshot(nextSnapshot);
          })
          .catch((error) => {
            console.error("Native APK music seek failed", error);
            setErrorText(error instanceof Error ? error.message : "原生音乐操作失败");
          })
          .finally(() => {
            if (seekOverrideTimerRef.current != null) {
              window.clearTimeout(seekOverrideTimerRef.current);
            }
            // Safety net: drop the override even if the position never reports "close enough".
            seekOverrideTimerRef.current = window.setTimeout(() => {
              seekOverrideTimerRef.current = null;
              seekTargetMsRef.current = null;
              setSeekOverrideSec(null);
            }, SEEK_OVERRIDE_TIMEOUT_MS);
          });
      }, SEEK_COMMIT_DELAY_MS);
    },
    [setSnapshot],
  );

  useLayoutEffect(() => {
    if (screen === "albums" && pendingScrollRestoreRef.current) {
      pendingScrollRestoreRef.current = false;
      const shell = pageShellRef.current;
      if (shell) shell.scrollTop = savedScrollRef.current;
      else window.scrollTo({ top: savedScrollRef.current, behavior: "auto" });
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

  const selectSection = useCallback(
    (section: MusicPlaybackSection) => {
      const nextSection = section === "history" && !canViewListening ? "browse" : section;
      const nextPath = buildApkSectionPath(nextSection);
      if (location.pathname !== nextPath) {
        navigate(nextPath);
      }
    },
    [canViewListening, location.pathname, navigate],
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

  useEffect(() => {
    if (canViewListening || !location.pathname.startsWith(`${MUSIC_PLAYER_PATH}/history`)) {
      return;
    }
    navigate(MUSIC_PLAYER_PATH, { replace: true });
  }, [canViewListening, location.pathname, navigate]);

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

  // 专辑 → 歌曲列表时压一条浏览器历史，这样系统返回键先回到专辑页而不是直接退出 APP。
  const tracksHistoryPushedRef = useRef(false);

  function openAlbum(album: AlbumRecord | null) {
    savedScrollRef.current = pageShellRef.current ? pageShellRef.current.scrollTop : window.scrollY;
    setSelectedAlbumId(album?.id ?? null);
    setShowAllSongs(album == null);
    setScreen("tracks");
    if (!tracksHistoryPushedRef.current) {
      try {
        window.history.pushState({ apkMusicScreen: "tracks" }, "");
        tracksHistoryPushedRef.current = true;
      } catch {
        tracksHistoryPushedRef.current = false;
      }
    }
  }

  function returnToAlbums() {
    if (tracksHistoryPushedRef.current) {
      // 让 popstate 处理器来切屏，保持历史栈干净。
      window.history.back();
      return;
    }
    pendingScrollRestoreRef.current = true;
    setScreen("albums");
  }

  useEffect(() => {
    const handlePopState = () => {
      if (!tracksHistoryPushedRef.current) {
        return;
      }
      tracksHistoryPushedRef.current = false;
      pendingScrollRestoreRef.current = true;
      setScreen("albums");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

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
    selectSection("player");
    if (deviceSync.remote) {
      // 手机是遥控器：让出声的那台设备去播。
      void deviceSync.sendCommand("play_music", { music_id: musicId, queue_ids: resolveTrackSelectionQueueIds() });
      return;
    }
    void runNativeAction(NativeApkMusic.playMusic(musicId, resolveTrackSelectionQueueIds()));
  }

  async function handleOpenAlbumTracks(albumId: number | null) {
    openAlbum(albumId == null ? null : albums.find((album) => album.id === albumId) || null);
    return undefined;
  }

  const [libraryTab, setLibraryTab] = useState<MusicLibraryTab>("library");
  const playlistsApi = useMusicPlaylists({
    enabled: isAuthenticated,
    libraryMusics: allMusics,
    currentUserId,
  });

  function playPlaylist(playlistTracks: MusicRecord[], startMusicId?: number) {
    if (!playlistTracks.length) return;
    const ids = playlistTracks.map((music) => music.id);
    void runNativeAction(NativeApkMusic.playMusic(startMusicId ?? ids[0], ids));
    selectSection("player");
  }

  async function queuePlaylist(playlistTracks: MusicRecord[]) {
    for (const music of playlistTracks) {
      await runNativeAction(NativeApkMusic.appendToQueue(music.id));
    }
    selectSection("queue");
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
    <div ref={pageShellRef} style={{ ...pageShellStyle, ...viewport.shellStyle }}>
      <div style={layoutStyle}>
        <MobileMusicShell
          activeSection={activeSection}
          onSectionChange={selectSection}
          sectionTabs={sectionTabs}
          browsePane={
            <MusicWorkspacePanel
              isMobile
              libraryTab={libraryTab}
              onChangeLibraryTab={setLibraryTab}
              showPlaylistsTab={isAuthenticated}
              playlistsPane={
                isAuthenticated ? (
                  <MusicPlaylistsPanel
                    isMobile
                    enabled={isAuthenticated}
                    loading={playlistsApi.loading}
                    busy={playlistsApi.busy}
                    notice={playlistsApi.notice}
                    playlists={playlistsApi.playlists}
publicPlaylists={playlistsApi.publicPlaylists}
                    selectedPlaylist={playlistsApi.selectedPlaylist}
                    currentMusicId={currentMusic?.id ?? null}
                    currentUserId={currentUserId}
                    resolveTracks={playlistsApi.resolveTracks}
                    onSelectPlaylist={playlistsApi.setSelectedPlaylistId}
                    onCreate={() => void playlistsApi.handleCreate()}
                    onRename={(playlist) => void playlistsApi.handleRename(playlist)}
                    onDelete={(playlist) => void playlistsApi.handleDelete(playlist)}
                    onLeave={(playlist) => void playlistsApi.handleLeave(playlist)}
                    onPlayPlaylist={(playlist, startMusicId) => playPlaylist(playlistsApi.resolveTracks(playlist), startMusicId)}
                    onQueuePlaylist={(playlist) => void queuePlaylist(playlistsApi.resolveTracks(playlist))}
                    onRemoveTrack={(playlist, musicId) => void playlistsApi.handleRemoveTrack(playlist, musicId)}
                    onMoveTrack={(playlist, musicId, direction) => void playlistsApi.handleMoveTrack(playlist, musicId, direction)}
                    onAddCurrentTrack={(playlist) => {
                      if (currentMusic) void playlistsApi.handleAddTrack(playlist, currentMusic.id);
                    }}
                    onAddMember={(playlist) => void playlistsApi.handleAddMember(playlist)}
onTogglePublic={(playlist) => void playlistsApi.handleTogglePublic(playlist)}
                    onRemoveMember={(playlist, userId, label) => void playlistsApi.handleRemoveMember(playlist, userId, label)}
                  />
                ) : undefined
              }
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
              savingAccompaniment={false}
              accompanimentInputRef={replaceInputRef}
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
              onAddToPlaylist={isAuthenticated ? (musicId) => void playlistsApi.handleAddTrackWithPicker(musicId) : undefined}
              onQueueTrack={(musicId) => {
                selectSection("queue");
                void runNativeAction(NativeApkMusic.appendToQueue(musicId));
              }}
              onSaveTrack={noopAsync}
              onDeleteTrack={noopAsync}
              onPickReplaceFile={() => undefined}
              onReplaceSelected={noopAsync}
              onPickAccompanimentFile={() => undefined}
              onAccompanimentSelected={noopAsync}
              onDeleteAccompaniment={noopAsync}
              onAlbumPageChange={setAlbumPage}
              onTrackPageChange={setTrackPage}
              albumTrackCount={(albumId) => trackCountByAlbumId.get(albumId) || 0}
            />
          }
          playerPane={
            <section style={apkPlayerStageStyle(viewport.contentHeight)}>
            <MusicPlayerPanel
              isMobile
              fill
              currentMusic={remoteControl ? remoteMusic ?? currentMusic : currentMusic}
              albumName={(remoteControl ? remoteMusic ?? currentMusic : currentMusic)?.album?.name || "未分配专辑"}
              isPlaying={remoteControl ? remoteControl.isPlaying : isPlaying}
              currentTime={remoteControl ? remoteControl.getPositionMs() / 1000 : displayedPositionSec}
              duration={remoteControl ? remoteControl.durationMs / 1000 : duration}
              devices={deviceSync.devices}
              activeDeviceId={deviceSync.activeDeviceId}
              thisDeviceId={snapshot.deviceId}
              onSelectDevice={(id) => void deviceSync.transferTo(id)}
              shuffleEnabled={snapshot.shuffleEnabled}
              repeatMode={snapshot.repeatMode}
              hasQueue={queue.length > 0}
              accompanimentMode={snapshot.accompanimentMode}
              hasAccompaniment={Boolean(currentMusic?.has_accompaniment)}
              onToggleAccompaniment={() => void runNativeAction(NativeApkMusic.toggleAccompanimentMode())}
              onAddToPlaylist={
                isAuthenticated && currentMusic ? () => void playlistsApi.handleAddTrackWithPicker(currentMusic.id) : undefined
              }
              remoteDeviceName={remoteDeviceName}
              onTakeOver={() => {
                if (snapshot.deviceId) void deviceSync.transferTo(snapshot.deviceId);
                else void runNativeAction(NativeApkMusic.takeOverPlayback());
              }}
              onToggleShuffle={() => void runNativeAction(NativeApkMusic.toggleShuffle())}
              onCycleRepeat={() => void runNativeAction(NativeApkMusic.cycleRepeat())}
              onPlayPrevious={() => (remoteControl ? void deviceSync.sendCommand("previous") : void runNativeAction(NativeApkMusic.playRelative(-1)))}
              onPlayNext={() => (remoteControl ? void deviceSync.sendCommand("next") : void runNativeAction(NativeApkMusic.playRelative(1)))}
              onTogglePlay={() => (remoteControl ? void deviceSync.sendCommand("toggle") : void runNativeAction(NativeApkMusic.togglePlayback()))}
              onSeek={remoteControl ? (nextTime) => void deviceSync.sendCommand("seek", { position_ms: Math.round(nextTime * 1000) }) : handleSeek}
            />
            </section>
          }
          queuePane={
            <MusicQueuePanel
              isMobile
              queue={queue}
              currentMusic={currentMusic}
              currentMusicId={currentMusic?.id ?? null}
              onOpenPlayer={() => selectSection("player")}
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
  padding: "10px 12px calc(52px + env(safe-area-inset-bottom, 0px))",
  background:
    "radial-gradient(circle at top left, var(--x-color-accent-tint-strong), transparent 32%), linear-gradient(180deg, var(--x-color-canvas) 0%, var(--x-color-panel-alt) 100%)",
};

// 手机播放器整页不滚动：可用高度扣掉页面上下内边距（底部含导航条预留）。
function apkPlayerStageStyle(contentHeight: number): CSSProperties {
  return {
    height: `calc(${contentHeight}px - 10px - 52px - env(safe-area-inset-bottom, 0px))`,
    overflow: "hidden",
  };
}

const layoutStyle: CSSProperties = {
  width: "min(1360px, 100%)",
  margin: "0 auto",
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "1fr",
  alignItems: "start",
};
