import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { API_BASE } from "../../../../js/apiBase";
import { useEnsureDesignTokens } from "../../../../theme/designTokens";
import {
  PINNED_ALL_SONGS_AUDIO_CACHE_SCOPE,
  QUEUE_NEXT_AUDIO_CACHE_SCOPE,
  getCachedMusicAudioUrl,
  warmMusicAudioTrack,
} from "../../logic/musicAudioCache";
import { resolveTrackAlbumName } from "../../logic/musicCoverUtils";
import { resolveNextQueuedTrack } from "../../logic/musicQueueCache";
import { useMusicPlayback } from "../../logic/MusicPlaybackContext";
import { DesktopMusicSectionSidebar } from "../desktop/DesktopMusicSectionSidebar";
import { MobileMusicShell } from "../mobile/MobileMusicShell";
import { type MusicPlaybackSection } from "../mobile/MobileMusicSectionNav";
import { MusicListeningPanel } from "../shared/MusicListeningPanel";
import { MusicPlayerPanel } from "../shared/MusicPlayerPanel";
import { MusicQueuePanel } from "../shared/MusicQueuePanel";
import type { ListeningSessionRecord } from "../shared/listeningActivityShared";

export type { MusicPlaybackSection } from "../mobile/MobileMusicSectionNav";

export function MusicPlaybackWorkspace({
  isMobile,
  activeSection,
  onSectionChange,
  browsePane,
  canUsePlaylists,
  onAddCurrentToPlaylist,
  onUploadAccompaniment,
  viewportHeight,
  stickyTop,
  pinnedAllSongsCacheIds,
  canViewListening,
  listeningLoading,
  listeningTimezone,
  listeningTotalMinutes,
  listeningUniqueListeners,
  listeningSessions,
}: {
  isMobile: boolean;
  activeSection: MusicPlaybackSection;
  onSectionChange: (section: MusicPlaybackSection) => void;
  browsePane: ReactNode;
  canUsePlaylists?: boolean;
  onAddCurrentToPlaylist?: (musicId: number) => void;
  /** 管理员：当前曲没有伴奏时的「上传伴奏」。 */
  onUploadAccompaniment?: (musicId: number) => void;
  viewportHeight: number | null;
  stickyTop: number;
  pinnedAllSongsCacheIds: number[];
  canViewListening: boolean;
  listeningLoading: boolean;
  listeningTimezone: string;
  listeningTotalMinutes: number;
  listeningUniqueListeners: number;
  listeningSessions: ListeningSessionRecord[];
}) {
  useEnsureDesignTokens();

  const {
    albums,
    libraryMusics,
    currentMusic,
    currentMusicId,
    orderedQueue,
    queue,
    isPlaying,
    shuffleEnabled,
    repeatMode,
    autoplayKey,
    accompanimentMode,
    toggleAccompanimentMode,
    pauseSignal,
    notifyLocalPlay,
    reportPlaybackPosition,
    remoteDeviceName,
    remoteControl,
    devices,
    activeDeviceId,
    thisDeviceId,
    transferTo,
    sendRemoteCommand,
    reportSeek,
    resumePositionMs,
    consumeResumePosition,
    toggleShuffle,
    cycleRepeatMode,
    playRelative,
    handleTrackEnded,
    playFromQueue,
    removeFromQueue,
    clearQueue,
    setIsPlayingState,
  } = useMusicPlayback();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastAutoplayKeyRef = useRef(autoplayKey);
  const lastSourceRef = useRef<string | null>(null);
  const lastSourceTrackIdRef = useRef<number | null>(null);
  const playAttemptRef = useRef(0);
  const setIsPlayingStateRef = useRef(setIsPlayingState);
  const notifyLocalPlayRef = useRef(notifyLocalPlay);
  const reportPlaybackPositionRef = useRef(reportPlaybackPosition);
  const consumeResumePositionRef = useRef(consumeResumePosition);
  const pinnedAllSongsCacheSet = useMemo(
    () => new Set(pinnedAllSongsCacheIds),
    [pinnedAllSongsCacheIds],
  );
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // 遥控模式：远端播放中时每 500ms 刷新一次外推的进度。
  const [remoteTick, setRemoteTick] = useState(0);
  useEffect(() => {
    if (!remoteControl?.isPlaying) return;
    const timer = window.setInterval(() => setRemoteTick((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, [remoteControl?.isPlaying, remoteControl?.deviceId]);
  const remoteMusic = useMemo(() => {
    if (!remoteControl || remoteControl.musicId == null) return null;
    return libraryMusics.find((music) => music.id === remoteControl.musicId) ?? null;
  }, [remoteControl, libraryMusics]);
  void remoteTick;
  const [audioSource, setAudioSource] = useState<{
    trackId: number | null;
    src: string | null;
  }>({
    trackId: null,
    src: null,
  });
  const visibleQueue = useMemo(
    () => (orderedQueue.length ? orderedQueue : queue),
    [orderedQueue, queue],
  );
  const nextQueuedTrack = useMemo(
    () => resolveNextQueuedTrack(visibleQueue, currentMusicId, repeatMode),
    [visibleQueue, currentMusicId, repeatMode],
  );
  const audioSrc = audioSource.src;
  // 歌曲自带的 album 字段优先，找不到再去专辑列表里查。
  const currentAlbumName = currentMusic
    ? currentMusic.album?.name || resolveTrackAlbumName(currentMusic.id, libraryMusics, albums) || "未分配专辑"
    : "从左侧进入找歌后开始播放";
  const currentHasAccompaniment = Boolean(currentMusic?.has_accompaniment);
  const useAccompaniment = accompanimentMode && currentHasAccompaniment;

  useEffect(() => {
    setIsPlayingStateRef.current = setIsPlayingState;
    notifyLocalPlayRef.current = notifyLocalPlay;
    reportPlaybackPositionRef.current = reportPlaybackPosition;
    consumeResumePositionRef.current = consumeResumePosition;
  }, [setIsPlayingState, notifyLocalPlay, reportPlaybackPosition, consumeResumePosition]);

  // 其他设备接管：本地 <audio> 立刻暂停。
  useEffect(() => {
    if (!pauseSignal) return;
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
    }
  }, [pauseSignal]);

  // 「在此设备播放」接管后跳到远端的进度。
  useEffect(() => {
    if (resumePositionMs == null) return;
    const audio = audioRef.current;
    if (!audio || !audioSrc || audioSource.trackId !== (currentMusic?.id ?? null)) return;
    const apply = () => {
      const target = Math.max(0, resumePositionMs / 1000);
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = Math.min(target, Math.max(0, audio.duration - 0.25));
      } else {
        audio.currentTime = target;
      }
      consumeResumePositionRef.current();
    };
    if (audio.readyState >= 1) {
      apply();
      return;
    }
    audio.addEventListener("loadedmetadata", apply, { once: true });
    return () => audio.removeEventListener("loadedmetadata", apply);
  }, [resumePositionMs, audioSrc, audioSource.trackId, currentMusic?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => {
      setIsPlayingStateRef.current(true);
      // 本设备开始播放：抢占为活动设备，其他设备会收到通知并暂停。
      notifyLocalPlayRef.current();
    };
    const handlePause = () => setIsPlayingStateRef.current(false);

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);

    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
    };
  }, []);

  useEffect(() => {
    if (!currentMusic) {
      setCurrentTime(0);
      setDuration(0);
    }
  }, [currentMusic]);

  useEffect(() => {
    if (!currentMusic) {
      setAudioSource({ trackId: null, src: null });
      return;
    }

    const variant = useAccompaniment ? "accompaniment" : "vocal";
    const directUrl = useAccompaniment
      ? `${API_BASE}/api/music/accompaniment/${currentMusic.id}`
      : `${API_BASE}/api/music/download/${currentMusic.id}`;
    const isPinnedTrack = pinnedAllSongsCacheSet.has(currentMusic.id);
    const cachedUrl = getCachedMusicAudioUrl(currentMusic, { variant });

    setAudioSource({
      trackId: currentMusic.id,
      src: cachedUrl || directUrl,
    });

    if (!isPinnedTrack || cachedUrl || useAccompaniment) {
      return;
    }

    void warmMusicAudioTrack(currentMusic, {
      scope: PINNED_ALL_SONGS_AUDIO_CACHE_SCOPE,
    })
      .catch((error) => {
        console.warn("Pinned all-songs playback cache warmup failed", error);
      });
  }, [currentMusic, pinnedAllSongsCacheSet, useAccompaniment]);

  useEffect(() => {
    if (!nextQueuedTrack) {
      return;
    }

    void warmMusicAudioTrack(nextQueuedTrack, {
      scope: QUEUE_NEXT_AUDIO_CACHE_SCOPE,
    }).catch((error) => {
      console.warn("Queue-next audio prewarm failed", error);
    });
  }, [nextQueuedTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const syncState = () => {
      const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      const length = Number.isFinite(audio.duration) ? audio.duration : 0;
      setCurrentTime(position);
      setDuration(length);
      reportPlaybackPositionRef.current(position * 1000, length * 1000);
    };

    syncState();
    audio.addEventListener("timeupdate", syncState);
    audio.addEventListener("loadedmetadata", syncState);
    audio.addEventListener("durationchange", syncState);
    audio.addEventListener("emptied", syncState);

    return () => {
      audio.removeEventListener("timeupdate", syncState);
      audio.removeEventListener("loadedmetadata", syncState);
      audio.removeEventListener("durationchange", syncState);
      audio.removeEventListener("emptied", syncState);
    };
  }, [currentMusic?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audioSource.trackId !== (currentMusic?.id ?? null)) {
      return;
    }

    if (!audioSrc) {
      playAttemptRef.current += 1;
      if (lastSourceRef.current) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      lastSourceRef.current = null;
      setIsPlayingStateRef.current(false);
      return;
    }

    const sourceChanged = audioSrc !== lastSourceRef.current;
    // 同一首歌只是在原唱 / 伴奏之间切换：保留进度和播放状态，不从头开始。
    const sameTrackVariantSwitch =
      sourceChanged && lastSourceRef.current != null && lastSourceTrackIdRef.current === audioSource.trackId;
    let resumeAfterSwitch = false;
    if (sourceChanged) {
      const resumeAt = sameTrackVariantSwitch && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      const wasPlaying = sameTrackVariantSwitch && !audio.paused && !audio.ended;
      playAttemptRef.current += 1;
      lastSourceRef.current = audioSrc;
      lastSourceTrackIdRef.current = audioSource.trackId;
      audio.pause();
      audio.src = audioSrc;
      audio.currentTime = 0;
      audio.load();
      setIsPlayingStateRef.current(false);
      if (sameTrackVariantSwitch && resumeAt > 0) {
        const restorePosition = () => {
          audio.removeEventListener("loadedmetadata", restorePosition);
          if (lastSourceRef.current !== audioSrc) return;
          const safeTime = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.min(resumeAt, audio.duration - 0.25) : resumeAt;
          audio.currentTime = Math.max(0, safeTime);
        };
        audio.addEventListener("loadedmetadata", restorePosition);
      }
      resumeAfterSwitch = wasPlaying;
    }

    if (autoplayKey <= lastAutoplayKeyRef.current && !resumeAfterSwitch) {
      return;
    }

    lastAutoplayKeyRef.current = autoplayKey;
    const attemptId = ++playAttemptRef.current;
    let cancelled = false;
    const playAudio = () => {
      if (cancelled || playAttemptRef.current !== attemptId) return;
      if (!sourceChanged && audio.ended) {
        audio.currentTime = 0;
      }
      audio.play().catch((error) => {
        if (cancelled || playAttemptRef.current !== attemptId || isAbortLikeMediaError(error)) {
          return;
        }
        console.warn("Music playback start failed", error);
      });
    };

    if (audio.readyState >= 2) {
      const timer = window.setTimeout(playAudio, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }

    const handleCanPlay = () => {
      audio.removeEventListener("canplay", handleCanPlay);
      void playAudio();
    };

    audio.addEventListener("canplay", handleCanPlay);
    return () => {
      cancelled = true;
      audio.removeEventListener("canplay", handleCanPlay);
    };
  }, [audioSource.trackId, audioSrc, autoplayKey, currentMusic?.id]);

  useEffect(() => {
    return () => {
      playAttemptRef.current += 1;
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      setIsPlayingStateRef.current(false);
    };
  }, []);

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
      count: visibleQueue.length,
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

  const playerPane = (
    <section style={playerStageStyle(isMobile, viewportHeight)}>
      <MusicPlayerPanel
        isMobile={isMobile}
        fill={isMobile}
        currentMusic={remoteControl ? remoteMusic ?? currentMusic : currentMusic}
        albumName={remoteControl && remoteMusic ? remoteMusic.album?.name || "未分配专辑" : currentAlbumName}
        audioRef={audioRef}
        isPlaying={remoteControl ? remoteControl.isPlaying : isPlaying}
        currentTime={remoteControl ? remoteControl.getPositionMs() / 1000 : currentTime}
        duration={remoteControl ? remoteControl.durationMs / 1000 : duration}
        devices={devices}
        activeDeviceId={activeDeviceId}
        thisDeviceId={thisDeviceId}
        onSelectDevice={transferTo}
        shuffleEnabled={shuffleEnabled}
        repeatMode={repeatMode}
        hasQueue={visibleQueue.length > 0}
        accompanimentMode={accompanimentMode}
        hasAccompaniment={currentHasAccompaniment}
        onToggleAccompaniment={toggleAccompanimentMode}
        onUploadAccompaniment={onUploadAccompaniment && currentMusic ? () => onUploadAccompaniment(currentMusic.id) : undefined}
        remoteDeviceName={remoteDeviceName}
        onTakeOver={() => transferTo(thisDeviceId)}
        onAddToPlaylist={
          canUsePlaylists && onAddCurrentToPlaylist && currentMusic
            ? () => onAddCurrentToPlaylist(currentMusic.id)
            : undefined
        }
        onToggleShuffle={toggleShuffle}
        onCycleRepeat={cycleRepeatMode}
        onPlayPrevious={() => (remoteControl ? sendRemoteCommand("previous") : playRelative(-1))}
        onPlayNext={() => (remoteControl ? sendRemoteCommand("next") : playRelative(1))}
        onTogglePlay={() => {
          if (remoteControl) {
            // 本机是遥控器：指令发给出声的设备。
            sendRemoteCommand("toggle");
            return;
          }
          const audio = audioRef.current;
          if (!audio || !currentMusic) {
            return;
          }
          if (isPlaying) {
            audio.pause();
            return;
          }
          void audio.play().catch((error) => {
            console.warn("Music playback toggle failed", error);
          });
        }}
        onSeek={(nextTime) => {
          if (remoteControl) {
            sendRemoteCommand("seek", { position_ms: Math.round(nextTime * 1000) });
            return;
          }
          const audio = audioRef.current;
          if (!audio || !currentMusic) {
            return;
          }
          audio.currentTime = nextTime;
          setCurrentTime(nextTime);
          reportSeek();
        }}
        onTrackEnded={handleTrackEnded}
      />
    </section>
  );

  const queuePane = (
    <MusicQueuePanel
      isMobile={isMobile}
      queue={visibleQueue}
      currentMusic={currentMusic}
      currentMusicId={currentMusicId}
      onOpenPlayer={() => onSectionChange("player")}
      onPlayFromQueue={playFromQueue}
      onRemoveFromQueue={removeFromQueue}
      onClearQueue={clearQueue}
    />
  );

  const historyPane = canViewListening ? (
    <MusicListeningPanel
      isMobile={isMobile}
      loading={listeningLoading}
      timezone={listeningTimezone}
      totalMinutes={listeningTotalMinutes}
      uniqueListeners={listeningUniqueListeners}
      sessions={listeningSessions}
    />
  ) : null;

  if (isMobile) {
    return (
      <MobileMusicShell
        activeSection={activeSection}
        onSectionChange={onSectionChange}
        sectionTabs={sectionTabs}
        browsePane={browsePane}
        playerPane={playerPane}
        queuePane={queuePane}
        historyPane={historyPane}
      />
    );
  }

  return (
    <div style={workspaceShellStyle(false, viewportHeight)}>
      <DesktopMusicSectionSidebar
        sectionTabs={sectionTabs}
        activeSection={activeSection}
        onSectionChange={onSectionChange}
        currentMusicTitle={currentMusic?.title || null}
        isPlaying={isPlaying}
        stickyTop={stickyTop}
        viewportHeight={viewportHeight}
      />

      <div style={contentViewportStyle(false, viewportHeight)}>
        <div style={panelMountStyle(activeSection === "browse", false)}>{browsePane}</div>

        <div style={panelMountStyle(activeSection === "player", false)}>{playerPane}</div>

        <div style={panelMountStyle(activeSection === "queue", false)}>{queuePane}</div>

        {canViewListening ? (
          <div style={panelMountStyle(activeSection === "history", false)}>{historyPane}</div>
        ) : null}
      </div>
    </div>
  );
}

function resolveViewportHeight(viewportHeight: number | null) {
  return viewportHeight ? `${viewportHeight}px` : "calc(100vh - 108px)";
}

function workspaceShellStyle(isMobile: boolean, viewportHeight: number | null): CSSProperties {
  return {
    display: "grid",
    gap: isMobile ? "12px" : "18px",
    gridTemplateColumns: isMobile ? "1fr" : "272px minmax(0, 1fr)",
    alignItems: "stretch",
    minHeight: isMobile ? "auto" : resolveViewportHeight(viewportHeight),
    height: isMobile ? "auto" : resolveViewportHeight(viewportHeight),
  };
}

function panelMountStyle(active: boolean, isMobile: boolean): CSSProperties {
  return {
    display: active ? "block" : "none",
    height: isMobile ? "auto" : "100%",
    overflow: isMobile ? "visible" : "auto",
  };
}

function playerStageStyle(isMobile: boolean, viewportHeight: number | null): CSSProperties {
  return {
    width: "100%",
    maxWidth: isMobile ? "100%" : "980px",
    margin: "0 auto",
    padding: 0,
    // 手机：播放器整页钉在可用高度里（已扣掉顶栏和底部导航），不滚动。
    height: isMobile && viewportHeight ? `${viewportHeight}px` : undefined,
    overflow: isMobile ? "hidden" : undefined,
  };
}

function isAbortLikeMediaError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const name = "name" in error ? String(error.name ?? "") : "";
  const message = "message" in error ? String(error.message ?? "") : "";

  return (
    name === "AbortError"
    || /aborted by the user agent/i.test(message)
    || /interrupted by a new load request/i.test(message)
    || /interrupted by a call to pause/i.test(message)
  );
}

function contentViewportStyle(isMobile: boolean, viewportHeight: number | null): CSSProperties {
  return {
    height: isMobile ? "auto" : resolveViewportHeight(viewportHeight),
    minHeight: isMobile ? "auto" : resolveViewportHeight(viewportHeight),
    overflow: isMobile ? "visible" : "auto",
    padding: 0,
    background: "transparent",
    border: "none",
    boxShadow: "none",
  };
};
