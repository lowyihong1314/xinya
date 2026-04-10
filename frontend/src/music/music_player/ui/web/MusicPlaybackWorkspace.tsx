import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { API_BASE } from "../../../../js/apiBase";
import { useEnsureDesignTokens } from "../../../../theme/designTokens";
import { resolveTrackAlbumName } from "../../logic/musicCoverUtils";
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
  viewportHeight,
  stickyTop,
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
  viewportHeight: number | null;
  stickyTop: number;
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
  const playAttemptRef = useRef(0);
  const setIsPlayingStateRef = useRef(setIsPlayingState);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const visibleQueue = useMemo(
    () => (orderedQueue.length ? orderedQueue : queue),
    [orderedQueue, queue],
  );
  const audioSrc = currentMusic ? `${API_BASE}/api/music/download/${currentMusic.id}` : null;
  const currentAlbumName = currentMusic
    ? resolveTrackAlbumName(currentMusic.id, libraryMusics, albums) || "未分配专辑"
    : "从左侧进入找歌后开始播放";

  useEffect(() => {
    setIsPlayingStateRef.current = setIsPlayingState;
  }, [setIsPlayingState]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => setIsPlayingStateRef.current(true);
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
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const syncState = () => {
      setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
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
    if (sourceChanged) {
      playAttemptRef.current += 1;
      lastSourceRef.current = audioSrc;
      audio.pause();
      audio.src = audioSrc;
      audio.currentTime = 0;
      audio.load();
      setIsPlayingStateRef.current(false);
    }

    if (autoplayKey <= lastAutoplayKeyRef.current) {
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
  }, [audioSrc, autoplayKey]);

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
    <section style={playerStageStyle(isMobile)}>
      <MusicPlayerPanel
        isMobile={isMobile}
        currentMusic={currentMusic}
        albumName={currentAlbumName}
        audioRef={audioRef}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        shuffleEnabled={shuffleEnabled}
        repeatMode={repeatMode}
        hasQueue={visibleQueue.length > 0}
        onToggleShuffle={toggleShuffle}
        onCycleRepeat={cycleRepeatMode}
        onPlayPrevious={() => playRelative(-1)}
        onPlayNext={() => playRelative(1)}
        onTogglePlay={() => {
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
          const audio = audioRef.current;
          if (!audio || !currentMusic) {
            return;
          }
          audio.currentTime = nextTime;
          setCurrentTime(nextTime);
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

function playerStageStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    maxWidth: isMobile ? "100%" : "980px",
    margin: "0 auto",
    padding: 0,
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
