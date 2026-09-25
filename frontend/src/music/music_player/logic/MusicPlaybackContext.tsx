import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useUserState } from "../../../app/UserState";
import type { AlbumRecord, MusicRecord, PlaybackCommandAction, PlaybackDeviceRecord, PlaybackDeviceState } from "./types";
import { addOneMinute, fetchLastPlayedMusic } from "./api";
import { getWebPlaybackDeviceId, getWebPlaybackDeviceName } from "./playbackDevice";
import { usePlaybackDeviceSync, type RemotePlaybackView } from "./usePlaybackDeviceSync";

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
  /** 伴奏模式：有伴奏文件的歌播放伴奏版。 */
  accompanimentMode: boolean;
  toggleAccompanimentMode: () => void;
  /** 一人一设备：服务端状态（含在线设备列表）。 */
  remotePlayback: PlaybackDeviceState | null;
  remoteDeviceName: string | null;
  isActiveDevice: boolean;
  /** 本机是遥控器时的远端视图（歌 / 进度 / 播放中），本机出声时为 null。 */
  remoteControl: RemotePlaybackView | null;
  devices: PlaybackDeviceRecord[];
  activeDeviceId: string | null;
  thisDeviceId: string;
  /** 设备选择器：把出声切到某台设备。 */
  transferTo: (deviceId: string) => void;
  /** 遥控指令，发给出声的设备。 */
  sendRemoteCommand: (action: PlaybackCommandAction, payload?: Record<string, unknown>) => void;
  /** 本机拖了进度：立刻同步给遥控器。 */
  reportSeek: () => void;
  /** 其他设备接管时递增，播放器据此暂停 <audio>。 */
  pauseSignal: number;
  /** 播放器在 <audio> 真正开始播放时调用：抢占为活动设备。 */
  notifyLocalPlay: () => void;
  /** 播放器每次 timeupdate 上报位置和时长（只写 ref，不触发渲染）。 */
  reportPlaybackPosition: (positionMs: number, durationMs?: number) => void;
  /** 「在此设备播放」：抢占并从远端位置继续。 */
  takeOverPlayback: () => void;
  /** 接管后要跳到的位置（毫秒），播放器用过一次后调用 consumeResumePosition 清掉。 */
  resumePositionMs: number | null;
  consumeResumePosition: () => void;
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
const ACCOMPANIMENT_STORAGE_KEY = "xinya.music.accompaniment";
const MINUTE_MS = 60_000;

function readStoredAccompanimentMode() {
  try {
    return window.localStorage.getItem(ACCOMPANIMENT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

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
  const [accompanimentMode, setAccompanimentMode] = useState<boolean>(readStoredAccompanimentMode);
  const [autoplayKey, setAutoplayKey] = useState(0);
  const [pauseSignal, setPauseSignal] = useState(0);
  const [resumePositionMs, setResumePositionMs] = useState<number | null>(null);
  const positionMsRef = useRef(0);
  const durationMsRef = useRef(0);
  const deviceId = useMemo(() => getWebPlaybackDeviceId(), []);
  const deviceName = useMemo(() => getWebPlaybackDeviceName(), []);
  const [restoredState, setRestoredState] = useState(false);
  const attemptedRemoteRestoreRef = useRef(false);

  const musicMap = useMemo(() => new Map(libraryMusics.map((music) => [music.id, music])), [libraryMusics]);

  // 本机作为出声设备时执行的本地动作（遥控指令 / 切换到本机）。
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const musicMapRef = useRef(musicMap);
  musicMapRef.current = musicMap;

  function startLocally(musicId: number | null, positionMs: number, autoplay: boolean) {
    if (musicId != null && musicMapRef.current.has(musicId)) {
      setQueueIds((current) => (current.includes(musicId) ? current : Array.from(new Set([...current, musicId]))));
      positionMsRef.current = positionMs;
      setResumePositionMs(positionMs);
      setCurrentMusicIdState(musicId);
    }
    setHasPlaybackSession(true);
    if (autoplay) setAutoplayKey((value) => value + 1);
  }

  function executeCommand(action: PlaybackCommandAction, payload: Record<string, unknown>) {
    switch (action) {
      case "play":
        setAutoplayKey((value) => value + 1);
        return;
      case "pause":
        setPauseSignal((value) => value + 1);
        return;
      case "toggle":
        if (isPlayingRef.current) setPauseSignal((value) => value + 1);
        else setAutoplayKey((value) => value + 1);
        return;
      case "next":
        playRelative(1);
        return;
      case "previous":
        playRelative(-1);
        return;
      case "seek": {
        const position = Number(payload.position_ms);
        if (Number.isFinite(position)) {
          positionMsRef.current = position;
          setResumePositionMs(Math.max(0, position));
        }
        return;
      }
      case "play_music": {
        const musicId = Number(payload.music_id);
        const queueIdsPayload = Array.isArray(payload.queue_ids)
          ? (payload.queue_ids as unknown[]).map((value) => Number(value)).filter((value) => Number.isFinite(value))
          : null;
        if (queueIdsPayload && queueIdsPayload.length) {
          setQueueIds(queueIdsPayload.filter((id) => musicMapRef.current.has(id)));
        }
        if (Number.isFinite(musicId)) startLocally(musicId, 0, true);
        return;
      }
      case "set_queue": {
        const ids = Array.isArray(payload.queue_ids)
          ? (payload.queue_ids as unknown[]).map((value) => Number(value)).filter((value) => Number.isFinite(value))
          : [];
        setQueueIds(ids.filter((id) => musicMapRef.current.has(id)));
        return;
      }
      default:
        return;
    }
  }

  const deviceSync = usePlaybackDeviceSync({
    enabled: isAuthenticated && !loadingUser,
    deviceId,
    deviceName,
    kind: "web",
    isPlaying,
    currentMusicId,
    getPositionMs: () => positionMsRef.current,
    getDurationMs: () => durationMsRef.current,
    onRemoteTakeover: () => {
      // 别的设备出声了：本机暂停，变成遥控器；队列不清，随时可以切回来。
      setIsPlaying(false);
      setPauseSignal((value) => value + 1);
    },
    onTransferredToMe: (state) => {
      startLocally(state.music_id ?? null, state.position_ms || 0, Boolean(state.resume || state.is_playing));
    },
    onCommand: executeCommand,
  });
  const deviceSyncRef = useRef(deviceSync);
  deviceSyncRef.current = deviceSync;
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
    try {
      window.localStorage.setItem(ACCOMPANIMENT_STORAGE_KEY, accompanimentMode ? "1" : "0");
    } catch {
      // 存不进去只影响记忆偏好
    }
  }, [accompanimentMode]);

  // 随机顺序只在「队列成员变化」时重排：换歌不重洗，否则随机模式下会重复播、无法回退。
  // 队列新增的歌随机插入到当前曲之后，移除的歌直接剔除。
  const currentMusicIdRef = useRef<number | null>(currentMusicId);
  currentMusicIdRef.current = currentMusicId;
  useEffect(() => {
    if (!queueIds.length) {
      setShuffleQueueIds([]);
      return;
    }
    setShuffleQueueIds((current) => {
      const queueSet = new Set(queueIds);
      const kept = current.filter((id) => queueSet.has(id));
      const keptSet = new Set(kept);
      const added = queueIds.filter((id) => !keptSet.has(id));
      if (!added.length && kept.length === current.length) {
        return current;
      }
      if (!kept.length) {
        return buildStableShuffleIds(queueIds, currentMusicIdRef.current);
      }
      const shuffledAdded = buildStableShuffleIds(added, null);
      const currentIndex = currentMusicIdRef.current != null ? kept.indexOf(currentMusicIdRef.current) : -1;
      const insertAt = currentIndex >= 0 ? currentIndex + 1 : kept.length;
      return [...kept.slice(0, insertAt), ...shuffledAdded, ...kept.slice(insertAt)];
    });
  }, [queueIds]);

  // 听歌分钟：累计「真正在播放」的毫秒数，暂停/缓冲只停表不清零，每满 60 秒上报一次；
  // 未满 60 秒的部分在切歌时保留，归到下一首继续累计。
  const playedMsRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isPlaying || currentMusicId == null) {
      lastTickRef.current = null;
      return;
    }
    lastTickRef.current = performance.now();
    const tick = () => {
      const now = performance.now();
      if (lastTickRef.current != null) {
        playedMsRef.current += now - lastTickRef.current;
      }
      lastTickRef.current = now;
      while (playedMsRef.current >= MINUTE_MS) {
        playedMsRef.current -= MINUTE_MS;
        void addOneMinute(currentMusicId).catch(() => undefined);
      }
    };
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(timer);
      tick();
      lastTickRef.current = null;
    };
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
    const remote = deviceSyncRef.current.remote;
    if (remote) {
      // 本机是遥控器：点歌就让出声的设备去播，本机只更新显示。
      const nextQueue = queueIds.includes(musicId) ? queueIds : [...queueIds, musicId];
      void deviceSyncRef.current.sendCommand("play_music", { music_id: musicId, queue_ids: nextQueue });
      setCurrentMusicIdState(musicId);
      setHasPlaybackSession(true);
      return;
    }
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
    setQueueIds(nextQueueIds);

    if (currentMusicId == null) {
      const nextCurrentId = nextQueueIds[0] ?? null;
      setCurrentMusicIdState(nextCurrentId);
      setHasPlaybackSession(nextCurrentId != null);
      if (nextCurrentId != null) {
        setAutoplayKey((value) => value + 1);
      }
      return;
    }

    setHasPlaybackSession(true);
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
      accompanimentMode,
      toggleAccompanimentMode: () => setAccompanimentMode((value) => !value),
      remotePlayback: deviceSync.state,
      remoteDeviceName: deviceSync.remoteDeviceName,
      isActiveDevice: deviceSync.isActiveDevice,
      remoteControl: deviceSync.remote,
      devices: deviceSync.devices,
      activeDeviceId: deviceSync.activeDeviceId,
      thisDeviceId: deviceId,
      transferTo: (targetId: string) => {
        void deviceSyncRef.current.transferTo(targetId);
      },
      sendRemoteCommand: (action, payload) => {
        void deviceSyncRef.current.sendCommand(action, payload);
      },
      reportSeek: () => deviceSyncRef.current.reportSeek(),
      pauseSignal,
      resumePositionMs,
      consumeResumePosition: () => setResumePositionMs(null),
      notifyLocalPlay: () => {
        void deviceSyncRef.current.claim();
      },
      reportPlaybackPosition: (positionMs: number, durationMs?: number) => {
        positionMsRef.current = positionMs;
        if (typeof durationMs === "number" && Number.isFinite(durationMs)) durationMsRef.current = durationMs;
      },
      takeOverPlayback: () => {
        // 「在此设备播放」= 在选择器里选中本机。
        void deviceSyncRef.current.transferTo(deviceId);
      },
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
      toggleShuffle: () =>
        setShuffleEnabled((value) => {
          const next = !value;
          if (next) {
            // 开启随机时重洗一次，并把当前曲放在最前面。
            setShuffleQueueIds(buildStableShuffleIds(queueIds, currentMusicId));
          }
          return next;
        }),
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
    [albums, libraryMusics, queue, orderedQueue, currentMusic, currentMusicId, isPlaying, hasPlaybackSession, shuffleEnabled, repeatMode, autoplayKey, accompanimentMode, musicMap, deviceSync.state, deviceSync.remote, deviceSync.remoteDeviceName, deviceSync.isActiveDevice, deviceSync.devices, deviceSync.activeDeviceId, deviceId, pauseSignal, resumePositionMs],
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
