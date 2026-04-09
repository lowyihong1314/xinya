import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useUserState } from "../../../app/UserState";
import type { AlbumRecord, MusicRecord } from "./types";
import { addOneMinute, fetchLastPlayedMusic } from "./api";

type RepeatMode = "off" | "all" | "one";

type MusicPlaybackContextValue = {
  albums: AlbumRecord[];
  libraryMusics: MusicRecord[];
  queue: MusicRecord[];
  /** Queue in playback order — respects shuffle. Use this for native playlist sync. */
  orderedQueue: MusicRecord[];
  currentMusic: MusicRecord | null;
  currentMusicId: number | null;
  isPlaying: boolean;
  hasPlaybackSession: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  autoplayKey: number;
  setAlbums: (albums: AlbumRecord[]) => void;
  setLibraryMusics: (musics: MusicRecord[]) => void;
  setQueue: (musics: MusicRecord[]) => void;
  setCurrentMusicId: (musicId: number | null) => void;
  selectMusic: (musicId: number) => void;
  insertNext: (musicId: number) => void;
  appendToQueue: (musicId: number) => void;
  removeFromQueue: (musicId: number) => void;
  clearQueue: () => void;
  playFromQueue: (musicId: number) => void;
  playRelative: (step: -1 | 1) => void;
  handleTrackEnded: () => void;
  toggleShuffle: () => void;
  cycleRepeatMode: () => void;
  dismissPlayer: () => void;
  setIsPlayingState: (playing: boolean) => void;
};

const QUEUE_STORAGE_KEY = "xinya.music.queue.ids";
const CURRENT_STORAGE_KEY = "xinya.music.current.id";

const MusicPlaybackContext = createContext<MusicPlaybackContextValue | null>(null);

export function MusicPlaybackProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loadingUser } = useUserState();
  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [libraryMusics, setLibraryMusics] = useState<MusicRecord[]>([]);
  const [queueIds, setQueueIds] = useState<number[]>([]);
  const [currentMusicId, setCurrentMusicIdState] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasPlaybackSession, setHasPlaybackSession] = useState(false);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [shuffleQueueIds, setShuffleQueueIds] = useState<number[]>([]);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [autoplayKey, setAutoplayKey] = useState(0);
  const [restoredState, setRestoredState] = useState(false);
  const attemptedRemoteRestoreRef = useRef(false);

  const musicMap = useMemo(() => new Map(libraryMusics.map((music) => [music.id, music])), [libraryMusics]);
  const queue = useMemo(
    () => queueIds.map((id) => musicMap.get(id)).filter((music): music is MusicRecord => Boolean(music)),
    [queueIds, musicMap],
  );
  const currentMusic = (currentMusicId ? musicMap.get(currentMusicId) : null) || null;

  // Ordered queue respecting shuffle — kept for web playback queue resolution.
  const orderedQueue = useMemo(() => {
    if (!shuffleEnabled || !shuffleQueueIds.length) return queue;
    return shuffleQueueIds
      .filter((id) => queueIds.includes(id))
      .map((id) => musicMap.get(id))
      .filter((m): m is MusicRecord => m != null);
  }, [queue, queueIds, shuffleEnabled, shuffleQueueIds, musicMap]);

  useEffect(() => {
    try {
      const storedQueue = window.localStorage.getItem(QUEUE_STORAGE_KEY);
      const storedCurrent = window.localStorage.getItem(CURRENT_STORAGE_KEY);
      const parsedQueue = storedQueue ? JSON.parse(storedQueue) : [];
      const restoredQueueIds = Array.isArray(parsedQueue)
        ? parsedQueue.map((value) => Number(value)).filter((value) => Number.isFinite(value))
        : [];
      const restoredCurrentId = storedCurrent ? Number(storedCurrent) || null : null;
      setQueueIds(restoredQueueIds);
      setCurrentMusicIdState(restoredCurrentId);
      if (restoredCurrentId != null || restoredQueueIds.length > 0) {
        setHasPlaybackSession(true);
      }
    } catch {
      setQueueIds([]);
      setCurrentMusicIdState(null);
    } finally {
      setRestoredState(true);
    }
  }, []);

  useEffect(() => {
    if (!restoredState) {
      return;
    }
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queueIds));
  }, [queueIds, restoredState]);

  useEffect(() => {
    if (!restoredState) {
      return;
    }
    if (currentMusicId == null) {
      window.localStorage.removeItem(CURRENT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(CURRENT_STORAGE_KEY, String(currentMusicId));
  }, [currentMusicId, restoredState]);

  useEffect(() => {
    if (!queueIds.length) {
      setShuffleQueueIds([]);
      return;
    }
    const next = buildStableShuffleIds(queueIds, currentMusicId);
    setShuffleQueueIds((current) => (current.join(",") === next.join(",") ? current : next));
  }, [queueIds, currentMusicId]);

  // Track play minutes: call addOneMinute every 60s while a song is playing.
  const playingMusicIdRef = useRef<number | null>(null);
  useEffect(() => {
    playingMusicIdRef.current = isPlaying ? currentMusicId : null;
  }, [isPlaying, currentMusicId]);

  useEffect(() => {
    if (!isPlaying || !currentMusicId) return;
    const timer = window.setInterval(() => {
      const id = playingMusicIdRef.current;
      if (id != null) {
        void addOneMinute(id).catch(() => undefined);
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [isPlaying, currentMusicId]);

  useEffect(() => {
    if (!libraryMusics.length) {
      return;
    }
    const filteredQueueIds = queueIds.filter((id) => musicMap.has(id));
    if (
      filteredQueueIds.length !== queueIds.length ||
      filteredQueueIds.some((id, index) => id !== queueIds[index])
    ) {
      setQueueIds(filteredQueueIds);
      return;
    }
    if (currentMusicId && !musicMap.has(currentMusicId)) {
      setCurrentMusicIdState(filteredQueueIds[0] ?? null);
    }
  }, [libraryMusics, musicMap, currentMusicId, queueIds]);

  useEffect(() => {
    if (!restoredState || loadingUser) {
      return;
    }
    if (!isAuthenticated) {
      attemptedRemoteRestoreRef.current = false;
      return;
    }
    if (!libraryMusics.length) {
      return;
    }
    if (queueIds.length || currentMusicId != null || hasPlaybackSession) {
      attemptedRemoteRestoreRef.current = true;
      return;
    }
    if (attemptedRemoteRestoreRef.current) {
      return;
    }

    attemptedRemoteRestoreRef.current = true;
    let cancelled = false;

    void fetchLastPlayedMusic()
      .then((payload) => {
        if (cancelled) {
          return;
        }
        const musicId = payload.last_played?.music_id;
        if (musicId == null || !musicMap.has(musicId)) {
          return;
        }

        const orderedAllSongIds = [...libraryMusics]
          .sort(
            (a, b) =>
              (Number(b.play_minutes ?? 0) - Number(a.play_minutes ?? 0)) ||
              a.title.localeCompare(b.title, "zh-Hans-CN"),
          )
          .map((music) => music.id);

        setQueueIds(normalizeQueue(orderedAllSongIds));
        setCurrentMusicIdState(musicId);
        setHasPlaybackSession(true);
        setAutoplayKey((value) => value + 1);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    currentMusicId,
    hasPlaybackSession,
    isAuthenticated,
    libraryMusics,
    loadingUser,
    musicMap,
    queueIds.length,
    restoredState,
  ]);

  function normalizeQueue(nextIds: number[]) {
    return Array.from(new Set(nextIds)).filter((id) => musicMap.has(id));
  }

  function setCurrentMusicId(musicId: number | null) {
    setCurrentMusicIdState(musicId);
    if (musicId != null) {
      setHasPlaybackSession(true);
    }
  }

  function selectMusic(musicId: number) {
    setCurrentMusicIdState(musicId);
    setHasPlaybackSession(true);
    setAutoplayKey((value) => value + 1);
  }

  function insertNext(musicId: number) {
    if (!musicMap.has(musicId)) {
      return;
    }
    setQueueIds((current) => normalizeQueue([musicId, ...current]));
    selectMusic(musicId);
  }

  function appendToQueue(musicId: number) {
    if (!musicMap.has(musicId)) {
      return;
    }
    const nextQueueIds = normalizeQueue([...queueIds, musicId]);
    const nextCurrentId = nextQueueIds[0] ?? null;
    setQueueIds(nextQueueIds);
    setCurrentMusicIdState(nextCurrentId);
    setHasPlaybackSession(nextCurrentId != null);
    if (nextCurrentId != null) {
      setAutoplayKey((value) => value + 1);
    }
  }

  function removeFromQueue(musicId: number) {
    const nextQueueIds = queueIds.filter((id) => id !== musicId);
    setQueueIds(nextQueueIds);

    if (!nextQueueIds.length) {
      setCurrentMusicIdState(null);
      setHasPlaybackSession(false);
      setIsPlaying(false);
      return;
    }

    if (currentMusicId === musicId) {
      const nextCurrentId = nextQueueIds[0] ?? null;
      setCurrentMusicIdState(nextCurrentId);
      if (nextCurrentId != null) {
        setHasPlaybackSession(true);
        setAutoplayKey((value) => value + 1);
      }
      return;
    }

    setHasPlaybackSession(true);
  }

  function clearQueue() {
    setQueueIds([]);
    setCurrentMusicIdState(null);
    setHasPlaybackSession(false);
    setIsPlaying(false);
  }

  function playFromQueue(musicId: number) {
    if (!queueIds.includes(musicId)) {
      return;
    }
    selectMusic(musicId);
  }

  function getOrderedQueueIds() {
    if (!queueIds.length) {
      return [];
    }
    if (!shuffleEnabled || !shuffleQueueIds.length) {
      return queueIds;
    }
    return shuffleQueueIds.filter((id) => queueIds.includes(id));
  }

  function playRelative(step: -1 | 1) {
    const orderedIds = getOrderedQueueIds();
    if (!orderedIds.length) {
      return;
    }

    const currentIndex = currentMusicId ? orderedIds.indexOf(currentMusicId) : -1;
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    let nextIndex = safeIndex + step;

    if (nextIndex < 0) {
      nextIndex = repeatMode === "all" ? orderedIds.length - 1 : 0;
    }
    if (nextIndex >= orderedIds.length) {
      nextIndex = repeatMode === "all" ? 0 : orderedIds.length - 1;
    }

    const nextId = orderedIds[nextIndex] || null;
    setCurrentMusicIdState(nextId);
    if (nextId != null) {
      setHasPlaybackSession(true);
      setAutoplayKey((value) => value + 1);
    }
  }

  function handleTrackEnded() {
    const orderedIds = getOrderedQueueIds();
    if (!orderedIds.length) {
      return;
    }
    if (repeatMode === "one") {
      setAutoplayKey((value) => value + 1);
      return;
    }

    const currentIndex = currentMusicId ? orderedIds.indexOf(currentMusicId) : -1;
    const atLast = currentIndex >= orderedIds.length - 1;
    if (atLast && repeatMode !== "all") {
      return;
    }
    playRelative(1);
  }

  const value = useMemo<MusicPlaybackContextValue>(
    () => ({
      albums,
      libraryMusics,
      queue,
      orderedQueue,
      currentMusic,
      currentMusicId,
      isPlaying,
      hasPlaybackSession,
      shuffleEnabled,
      repeatMode,
      autoplayKey,
      setAlbums,
      setLibraryMusics,
      setQueue: (musics) => setQueueIds(normalizeQueue(musics.map((music) => music.id))),
      setCurrentMusicId,
      selectMusic,
      insertNext,
      appendToQueue,
      removeFromQueue,
      clearQueue,
      playFromQueue,
      playRelative,
      handleTrackEnded,
      toggleShuffle: () => setShuffleEnabled((value) => !value),
      cycleRepeatMode: () =>
        setRepeatMode((value) => {
          if (value === "off") return "all";
          if (value === "all") return "one";
          return "off";
        }),
      dismissPlayer: () => {
        setIsPlaying(false);
        setHasPlaybackSession(false);
        setCurrentMusicIdState(null);
      },
      setIsPlayingState: (playing: boolean) => {
        setIsPlaying(playing);
        if (playing) {
          setHasPlaybackSession(true);
        }
      },
    }),
    [albums, libraryMusics, queue, orderedQueue, currentMusic, currentMusicId, isPlaying, hasPlaybackSession, shuffleEnabled, repeatMode, autoplayKey, musicMap],
  );

  return <MusicPlaybackContext.Provider value={value}>{children}</MusicPlaybackContext.Provider>;
}

export function useMusicPlayback() {
  const context = useContext(MusicPlaybackContext);
  if (!context) {
    throw new Error("useMusicPlayback must be used within MusicPlaybackProvider");
  }
  return context;
}

function buildStableShuffleIds(ids: number[], currentId: number | null) {
  const pool = [...ids];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const next = pool[index];
    pool[index] = pool[swapIndex];
    pool[swapIndex] = next;
  }
  if (currentId == null) {
    return pool;
  }
  const currentIndex = pool.indexOf(currentId);
  if (currentIndex <= 0) {
    return pool;
  }
  pool.splice(currentIndex, 1);
  pool.unshift(currentId);
  return pool;
}
