import type { CSSProperties, RefObject } from "react";

import { resolveAlbumCoverUrl } from "./musicCoverUtils";
import type { MusicRecord } from "./types";

type RepeatMode = "off" | "all" | "one";

type MusicPlayerPanelProps = {
  isMobile: boolean;
  currentMusic: MusicRecord | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  audioSrc: string | null;
  isPlaying: boolean;
  compact?: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  hasQueue: boolean;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onPlayPrevious: () => void;
  onPlayNext: () => void;
  onTrackEnded: () => void;
};

export function MusicPlayerPanel({
  isMobile,
  currentMusic,
  audioRef,
  audioSrc,
  isPlaying,
  compact = false,
  shuffleEnabled,
  repeatMode,
  hasQueue,
  onToggleShuffle,
  onCycleRepeat,
  onPlayPrevious,
  onPlayNext,
  onTrackEnded,
}: MusicPlayerPanelProps) {
  return (
    <section style={playerPanelStyle(isMobile, compact)}>
      <div style={playerHeroStyle(compact)}>
        <div style={coverShellStyle}>
          {currentMusic ? (
            <img
              src={resolveAlbumCoverUrl(currentMusic.cover_url)}
              alt={currentMusic.title}
              style={coverImageStyle}
            />
          ) : (
            <div style={coverPlaceholderStyle}>
              <div style={discStyle(false)}>
                <div style={discCenterStyle}>
                  <span style={coverPlaceholderGlyphStyle}>♪</span>
                </div>
              </div>
            </div>
          )}
        </div>
        <div style={playerMetaStyle}>
          <div style={eyebrowStyle}>Now Playing</div>
          <h2 style={playerTitleStyle(compact)}>{currentMusic?.title || "选择一首歌曲开始播放"}</h2>
          <p style={playerSubtitleStyle(compact)}>{currentMusic?.album?.name || "从右侧专辑进入歌曲列表"}</p>
        </div>
      </div>

      <audio
        ref={audioRef}
        controls
        onEnded={onTrackEnded}
        style={audioStyle}
        src={audioSrc || undefined}
      />

      <div style={playerActionGridStyle(isMobile, compact)}>
        <button type="button" style={secondaryButtonStyle} onClick={onPlayPrevious} disabled={!hasQueue}>
          上一首
        </button>
        <button type="button" style={secondaryButtonStyle} onClick={onPlayNext} disabled={!hasQueue}>
          下一首
        </button>
        <button
          type="button"
          style={toggleButtonStyle(shuffleEnabled)}
          onClick={onToggleShuffle}
          disabled={!hasQueue}
        >
          {shuffleEnabled ? "随机播放中" : "随机播放"}
        </button>
        <button type="button" style={toggleButtonStyle(repeatMode !== "off")} onClick={onCycleRepeat}>
          {repeatButtonLabel(repeatMode)}
        </button>
      </div>

      <div style={queueHintStyle(compact)}>
        {hasQueue ? (
          <span>{repeatLabel(repeatMode)}，按当前右侧歌曲列表顺序播放。</span>
        ) : (
          <span>右侧进入专辑或全部歌曲后，列表会成为当前播放队列。</span>
        )}
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

function playerHeroStyle(compact: boolean): CSSProperties {
  return {
    display: "grid",
    gap: compact ? "14px" : "20px",
  };
}

const coverShellStyle: CSSProperties = {
  borderRadius: "30px",
  overflow: "hidden",
  border: "1px solid rgba(15, 118, 110, 0.18)",
  boxShadow: "0 24px 50px rgba(15, 23, 42, 0.18)",
  background: "linear-gradient(160deg, rgba(15,118,110,0.16), rgba(18,52,59,0.92))",
  aspectRatio: "1 / 1",
};

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
  color: "rgba(255,255,255,0.82)",
};

function discStyle(rotating: boolean): CSSProperties {
  return {
    width: "84%",
    height: "84%",
    borderRadius: "999px",
    display: "grid",
    placeItems: "center",
    background:
      "radial-gradient(circle at center, rgba(255,255,255,0.14) 0 10%, rgba(255,255,255,0.02) 11% 14%, rgba(6,18,22,0.88) 15% 56%, rgba(21,78,74,0.98) 57% 74%, rgba(245,250,252,0.22) 75% 78%, rgba(7,12,18,0.95) 79% 100%)",
    boxShadow: "0 18px 34px rgba(15, 23, 42, 0.22)",
    animation: rotating ? "music-default-cover-spin 14s linear infinite" : undefined,
  };
}

const discCenterStyle: CSSProperties = {
  width: "28%",
  height: "28%",
  borderRadius: "999px",
  display: "grid",
  placeItems: "center",
  background: "radial-gradient(circle, rgba(255,255,255,0.92), rgba(208,217,227,0.88))",
  color: "var(--x-color-accent-strong)",
  boxShadow: "0 0 0 8px rgba(255,255,255,0.08)",
};

const coverPlaceholderGlyphStyle: CSSProperties = {
  fontSize: "28px",
  lineHeight: 1,
};

const playerMetaStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "var(--x-color-accent)",
};

function playerTitleStyle(compact: boolean): CSSProperties {
  return {
    margin: 0,
    fontSize: compact ? "22px" : "28px",
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

const audioStyle: CSSProperties = {
  width: "100%",
};

function queueHintStyle(compact: boolean): CSSProperties {
  return {
    fontSize: compact ? "12px" : "13px",
    color: "var(--x-color-ink-muted)",
  };
}

const secondaryButtonStyle: CSSProperties = {
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  borderRadius: "14px",
  padding: "12px 14px",
  fontWeight: 700,
  cursor: "pointer",
};

function toggleButtonStyle(active: boolean): CSSProperties {
  return {
    ...secondaryButtonStyle,
    borderColor: active ? "var(--x-color-accent-border)" : "var(--x-color-line)",
    background: active ? "var(--x-color-accent-soft)" : "var(--x-color-panel)",
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink)",
  };
}

function playerPanelStyle(isMobile: boolean, compact: boolean): CSSProperties {
  return {
    display: "grid",
    gap: compact ? "16px" : "20px",
    padding: compact ? "18px" : isMobile ? "20px" : "24px",
    borderRadius: "28px",
    background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(238,243,249,0.96))",
    border: "1px solid rgba(216, 223, 235, 0.95)",
    boxShadow: "0 18px 42px rgba(15, 23, 42, 0.08)",
    alignContent: "start",
  };
}

function playerActionGridStyle(isMobile: boolean, compact: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: compact || isMobile ? "1fr 1fr" : "1fr",
    gap: "12px",
  };
}

if (typeof document !== "undefined" && !document.getElementById("music-default-cover-spin")) {
  const style = document.createElement("style");
  style.id = "music-default-cover-spin";
  style.textContent = `
    @keyframes music-default-cover-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}
