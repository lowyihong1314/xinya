import type { CSSProperties, RefObject } from "react";

import { buildMusicCoverCacheKey } from "../../logic/musicCoverUtils";
import { MusicCoverImage } from "./MusicCoverImage";
import { PlaybackWaveTimeline } from "./PlaybackWaveTimeline";

type RepeatMode = "off" | "all" | "one";

type PlayerMusicRecord = {
  id: number;
  title: string;
  cover_url?: string | null;
  album?: {
    name?: string | null;
    cover_url?: string | null;
    image?: string | null;
  } | null;
};

type MusicPlayerPanelProps = {
  isMobile: boolean;
  currentMusic: PlayerMusicRecord | null;
  albumName: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  audioRef?: RefObject<HTMLAudioElement | null>;
  compact?: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  hasQueue: boolean;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onPlayPrevious: () => void;
  onPlayNext: () => void;
  onTogglePlay: () => void;
  onSeek: (nextTime: number) => void;
  onTrackEnded?: () => void;
};

export function MusicPlayerPanel({
  isMobile,
  currentMusic,
  albumName,
  isPlaying,
  currentTime,
  duration,
  audioRef,
  compact = false,
  shuffleEnabled,
  repeatMode,
  hasQueue,
  onToggleShuffle,
  onCycleRepeat,
  onPlayPrevious,
  onPlayNext,
  onTogglePlay,
  onSeek,
  onTrackEnded,
}: MusicPlayerPanelProps) {
  const resolvedAlbumName = currentMusic
    ? albumName || currentMusic.album?.name || "未分配专辑"
    : "从左侧进入找歌后开始播放";
  const playbackStateLabel = currentMusic ? (isPlaying ? "播放中" : "已暂停") : "待命";
  const canControl = Boolean(currentMusic);

  return (
    <section style={playerPanelStyle(isMobile, compact)}>
      <div style={playerLayoutStyle(isMobile)}>
        <div style={coverShellStyle(isMobile)}>
          {currentMusic ? (
            <MusicCoverImage
              source={currentMusic.album || currentMusic.cover_url}
              cacheKey={buildMusicCoverCacheKey("player-panel", currentMusic.id)}
              alt={currentMusic.title}
              style={coverImageStyle}
            />
          ) : (
            <div style={coverPlaceholderStyle}>
              <span style={coverPlaceholderGlyphStyle}>♪</span>
            </div>
          )}
        </div>

        <div style={playerBodyStyle}>
          <div style={playerHeaderRowStyle}>
            <div style={eyebrowStyle}>播放器</div>
            <span style={statePillStyle(Boolean(currentMusic), isPlaying)}>{playbackStateLabel}</span>
          </div>
          <h2 style={playerTitleStyle(compact)}>{currentMusic?.title || "选择一首歌曲开始播放"}</h2>
          <p style={playerSubtitleStyle(compact)}>{resolvedAlbumName}</p>

          {audioRef ? (
            <audio
              ref={audioRef}
              preload="metadata"
              onEnded={onTrackEnded}
              style={hiddenAudioStyle}
            />
          ) : null}

          <PlaybackWaveTimeline
            currentTime={currentTime}
            duration={duration}
            isPlaying={isPlaying}
            onSeek={onSeek}
          />

          <div style={transportRowStyle(isMobile)}>
            <button
              type="button"
              style={transportIconButtonStyle(isMobile, shuffleEnabled, !hasQueue)}
              onClick={onToggleShuffle}
              disabled={!hasQueue}
              aria-label="随机"
              title="随机"
            >
              <i className="fas fa-shuffle" />
            </button>
            <button
              type="button"
              style={transportIconButtonStyle(isMobile, false, !hasQueue)}
              onClick={onPlayPrevious}
              disabled={!hasQueue}
              aria-label="上一首"
              title="上一首"
            >
              <i className="fas fa-backward-step" />
            </button>
            <button
              type="button"
              style={playPauseButtonStyle(isMobile, !canControl)}
              onClick={onTogglePlay}
              disabled={!canControl}
              aria-label={isPlaying ? "暂停" : "播放"}
              title={isPlaying ? "暂停" : "播放"}
            >
              <i className={isPlaying ? "fas fa-pause" : "fas fa-play"} style={playPauseIconStyle(isPlaying)} />
            </button>
            <button
              type="button"
              style={transportIconButtonStyle(isMobile, false, !hasQueue)}
              onClick={onPlayNext}
              disabled={!hasQueue}
              aria-label="下一首"
              title="下一首"
            >
              <i className="fas fa-forward-step" />
            </button>
            <button
              type="button"
              style={transportIconButtonStyle(isMobile, repeatMode !== "off", !canControl)}
              onClick={onCycleRepeat}
              disabled={!canControl}
              aria-label={repeatButtonLabel(repeatMode)}
              title={repeatButtonLabel(repeatMode)}
            >
              <RepeatModeGlyph repeatMode={repeatMode} />
            </button>
          </div>

          <div style={metaRowStyle}>
            {hasQueue ? (
              <>
                <span style={metaChipStyle}>列队 {hasQueue ? "已连接" : "空"}</span>
                <span style={metaChipStyle}>{repeatLabel(repeatMode)}</span>
              </>
            ) : (
              <span style={hintTextStyle}>先去“找歌”里选一首歌，播放器就会在这里接上。</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function repeatLabel(repeatMode: RepeatMode) {
  if (repeatMode === "one") return "单曲循环";
  if (repeatMode === "all") return "列表循环";
  return "循环关闭";
}

function repeatButtonLabel(repeatMode: RepeatMode) {
  if (repeatMode === "one") return "单曲循环";
  if (repeatMode === "all") return "列表循环";
  return "循环关闭";
}

function RepeatModeGlyph({ repeatMode }: { repeatMode: RepeatMode }) {
  return (
    <span style={repeatGlyphShellStyle}>
      <i className="fas fa-repeat" />
      {repeatMode === "one" ? <span style={repeatSingleBadgeStyle}>1</span> : null}
    </span>
  );
}

function playerLayoutStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "220px minmax(0, 1fr)",
    gap: isMobile ? "14px" : "24px",
    alignItems: "start",
  };
}

function coverShellStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    maxWidth: isMobile ? "220px" : "220px",
    margin: isMobile ? "0 auto" : 0,
    borderRadius: isMobile ? "16px" : "22px",
    overflow: "hidden",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-alt)",
    aspectRatio: "1 / 1",
  };
}

const coverImageStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const coverPlaceholderStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "grid",
  placeItems: "center",
  background: "linear-gradient(135deg, var(--x-color-panel-alt), var(--x-color-accent-soft))",
  color: "var(--x-color-accent-strong)",
};

const coverPlaceholderGlyphStyle: CSSProperties = {
  fontSize: "54px",
  lineHeight: 1,
};

const playerBodyStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  alignContent: "start",
};

const playerHeaderRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  flexWrap: "wrap",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-accent)",
};

function statePillStyle(hasMusic: boolean, isPlaying: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "30px",
    padding: "0 12px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    color: hasMusic ? (isPlaying ? "var(--x-color-accent-strong)" : "var(--x-color-ink)") : "var(--x-color-ink-muted)",
    background: hasMusic ? (isPlaying ? "var(--x-color-accent-soft)" : "var(--x-color-panel-alt)") : "var(--x-color-panel-alt)",
    border: "1px solid var(--x-color-line)",
  };
}

function playerTitleStyle(compact: boolean): CSSProperties {
  return {
    margin: 0,
    fontSize: compact ? "22px" : "30px",
    lineHeight: compact ? 1.12 : 1.1,
    color: "var(--x-color-ink)",
  };
}

function playerSubtitleStyle(compact: boolean): CSSProperties {
  return {
    margin: 0,
    fontSize: compact ? "13px" : "14px",
    color: "var(--x-color-ink-muted)",
  };
}

const hiddenAudioStyle: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  opacity: 0,
  pointerEvents: "none",
};

function transportRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: isMobile ? "space-between" : "center",
    gap: "10px",
    width: "100%",
  };
}

function transportIconButtonStyle(isMobile: boolean, active: boolean, disabled: boolean): CSSProperties {
  return {
    width: isMobile ? "44px" : "48px",
    height: isMobile ? "44px" : "48px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "16px",
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line)",
    background: active ? "var(--x-color-accent-soft)" : "var(--x-color-panel)",
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.46 : 1,
  };
}

function playPauseButtonStyle(isMobile: boolean, disabled: boolean): CSSProperties {
  return {
    width: isMobile ? "60px" : "64px",
    height: isMobile ? "60px" : "64px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    border: "none",
    borderRadius: "30px",
    background: "var(--x-color-accent)",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.46 : 1,
    boxShadow: "0 14px 30px rgba(15,118,110,0.24)",
  };
}

function playPauseIconStyle(isPlaying: boolean): CSSProperties {
  return {
    fontSize: isPlaying ? "20px" : "22px",
    marginLeft: isPlaying ? 0 : "3px",
  };
}

function playerPanelStyle(isMobile: boolean, compact: boolean): CSSProperties {
  return {
    display: "grid",
    gap: compact ? "14px" : isMobile ? "14px" : "18px",
    padding: compact ? "18px" : isMobile ? "12px 0 0" : "22px",
    borderRadius: isMobile ? 0 : "24px",
    background: isMobile ? "transparent" : "var(--x-color-panel-strongest)",
    border: isMobile ? "none" : "1px solid var(--x-color-line-soft)",
    boxShadow: isMobile ? "none" : "0 14px 32px var(--x-color-shadow-soft)",
    alignContent: "start",
  };
}

const metaRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  alignItems: "center",
};

const metaChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: "30px",
  padding: "0 12px",
  borderRadius: "999px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line)",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 700,
};

const hintTextStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.7,
};

const repeatGlyphShellStyle: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const repeatSingleBadgeStyle: CSSProperties = {
  position: "absolute",
  right: "-4px",
  bottom: "-5px",
  minWidth: "11px",
  height: "11px",
  display: "grid",
  placeItems: "center",
  borderRadius: "999px",
  background: "currentColor",
  color: "var(--x-color-panel)",
  fontSize: "8px",
  fontWeight: 800,
  lineHeight: 1,
};
