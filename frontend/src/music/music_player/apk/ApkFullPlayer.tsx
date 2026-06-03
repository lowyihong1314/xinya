import type { CSSProperties } from "react";
import { useState } from "react";

import { MusicCoverImage } from "../ui/shared/MusicCoverImage";
import { buildMusicCoverCacheKey, resolveTrackAlbumName } from "./utils";
import { PlaybackWaveTimeline } from "../ui/shared/PlaybackWaveTimeline";
import type { MusicRecord, RepeatMode } from "./types";

type FullPlayerProps = {
  music: MusicRecord;
  albumName: string;
  isPlaying: boolean;
  progress: number;
  duration: number;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  queue: MusicRecord[];
  currentMusicId: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onSeek: (t: number) => void;
  onPlayFromQueue: (id: number) => void;
  onRemoveFromQueue: (id: number) => void;
  onClearQueue: () => void;
};

export function FullPlayer({
  music,
  albumName,
  isPlaying,
  progress,
  duration,
  shuffleEnabled,
  repeatMode,
  queue,
  currentMusicId,
  onClose,
  onPrev,
  onNext,
  onTogglePlay,
  onToggleShuffle,
  onCycleRepeat,
  onSeek,
  onPlayFromQueue,
  onRemoveFromQueue,
  onClearQueue,
}: FullPlayerProps) {
  const [showQueue, setShowQueue] = useState(false);
  const repeatLabel = repeatMode === "off" ? "不循环" : repeatMode === "all" ? "列表循环" : "单曲循环";

  return (
    <div style={fullPlayerStyle}>
      <div style={fullTopBarStyle}>
        <button style={fullIconBtnStyle} onClick={onClose}>
          <i className="fas fa-chevron-down" />
        </button>
        <span style={fullTopTitleStyle}>{showQueue ? "当前列队" : "播放器"}</span>
        <button style={fullIconBtnStyle} onClick={() => setShowQueue((value) => !value)} title="播放队列">
          <i className={showQueue ? "fas fa-circle-play" : "fas fa-list-ul"} />
          {queue.length > 0 && !showQueue ? (
            <span style={queueBadgeStyle}>{queue.length}</span>
          ) : null}
        </button>
      </div>

      {showQueue ? (
        <div style={queuePanelStyle}>
          <div style={queueHeaderStyle}>
            <span style={queueHeaderTextStyle}>队列 · {queue.length} 首</span>
            {queue.length > 0 ? (
              <button style={clearQueueBtnStyle} onClick={onClearQueue}>清空</button>
            ) : null}
          </div>
          <div style={queueListStyle}>
            {queue.length === 0 ? (
              <div style={queueEmptyStyle}>队列为空，从找歌页添加歌曲即可。</div>
            ) : (
              queue.map((track, index) => (
                <div key={track.id} style={queueRowStyle(track.id === currentMusicId)}>
                  <button style={queueTrackBtnStyle} onClick={() => onPlayFromQueue(track.id)}>
                    <span style={queueTrackNumStyle(track.id === currentMusicId)}>{index + 1}</span>
                    <span style={queueTrackMetaStyle}>
                      <span style={queueTrackTitleStyle(track.id === currentMusicId)}>{track.title}</span>
                      <span style={queueTrackAlbumStyle}>{resolveTrackAlbumName(track)}</span>
                    </span>
                  </button>
                  <button style={queueRemoveBtnStyle} onClick={() => onRemoveFromQueue(track.id)}>
                    <i className="fas fa-xmark" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div style={playerPanelStyle}>
          <div style={fullCoverStyle}>
            <MusicCoverImage
              source={music.album || music.cover_url}
              cacheKey={buildMusicCoverCacheKey("apk-full-player", music.id)}
              alt={music.title}
              style={fullCoverImgStyle}
            />
          </div>
          <div style={fullMetaStyle}>
            <div style={fullTitleStyle}>{music.title}</div>
            <div style={fullAlbumStyle}>{albumName || resolveTrackAlbumName(music)}</div>
          </div>
          <div style={fullProgressWrapStyle}>
            <PlaybackWaveTimeline
              currentTime={progress}
              duration={duration}
              isPlaying={isPlaying}
              onSeek={onSeek}
            />
          </div>
          <div style={fullTransportStyle}>
            <button
              style={iconTransportButtonStyle(shuffleEnabled)}
              onClick={onToggleShuffle}
              title="随机"
              aria-label="随机"
            >
              <i className="fas fa-shuffle" />
            </button>
            <button style={iconTransportButtonStyle(false)} onClick={onPrev} title="上一首" aria-label="上一首">
              <i className="fas fa-backward-step" />
            </button>
            <button
              style={playBtnStyle}
              onClick={onTogglePlay}
              title={isPlaying ? "暂停" : "播放"}
              aria-label={isPlaying ? "暂停" : "播放"}
            >
              <i className={isPlaying ? "fas fa-pause" : "fas fa-play"} style={playIconStyle(isPlaying)} />
            </button>
            <button style={iconTransportButtonStyle(false)} onClick={onNext} title="下一首" aria-label="下一首">
              <i className="fas fa-forward-step" />
            </button>
            <button
              style={iconTransportButtonStyle(repeatMode !== "off")}
              onClick={onCycleRepeat}
              title={repeatLabel}
              aria-label={repeatLabel}
            >
              <RepeatModeGlyph repeatMode={repeatMode} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RepeatModeGlyph({ repeatMode }: { repeatMode: RepeatMode }) {
  return (
    <span style={repeatGlyphShellStyle}>
      <i className="fas fa-repeat" />
      {repeatMode === "one" ? <span style={repeatSingleBadgeStyle}>1</span> : null}
    </span>
  );
}

const fullPlayerStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2000,
  background: "rgba(246,248,252,0.98)",
  backdropFilter: "blur(18px)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  maxWidth: "100vw",
};

const fullTopBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 12px 10px",
  borderBottom: "1px solid var(--x-color-line)",
  background: "rgba(255,255,255,0.88)",
  flexShrink: 0,
};

const fullTopTitleStyle: CSSProperties = {
  flex: 1,
  textAlign: "center",
  fontSize: 14,
  fontWeight: 700,
  color: "var(--x-color-ink)",
  padding: "0 4px",
};

const fullIconBtnStyle: CSSProperties = {
  width: 42,
  height: 42,
  flexShrink: 0,
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  background: "transparent",
  color: "var(--x-color-ink-muted)",
  fontSize: 18,
  cursor: "pointer",
  borderRadius: 10,
};

const queueBadgeStyle: CSSProperties = {
  position: "absolute",
  top: 6,
  right: 6,
  background: "var(--x-color-accent)",
  color: "#fff",
  fontSize: 9,
  fontWeight: 700,
  borderRadius: 99,
  minWidth: 14,
  height: 14,
  lineHeight: "14px",
  textAlign: "center",
  padding: "0 3px",
};

const playerPanelStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "18px 20px 24px",
  overflow: "auto",
  minWidth: 0,
  gap: 18,
};

const fullCoverStyle: CSSProperties = {
  width: "min(240px, 72vw)",
  height: "min(240px, 72vw)",
  flexShrink: 0,
  borderRadius: 22,
  overflow: "hidden",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  boxShadow: "0 18px 36px var(--x-color-shadow-soft)",
};

const fullCoverImgStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

const fullMetaStyle: CSSProperties = { width: "100%", minWidth: 0, textAlign: "center" };

const fullTitleStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: "var(--x-color-ink)",
  marginBottom: 4,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const fullAlbumStyle: CSSProperties = {
  fontSize: 14,
  color: "var(--x-color-ink-muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const fullProgressWrapStyle: CSSProperties = { width: "100%", minWidth: 0 };

const fullTransportStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  width: "100%",
};

function iconTransportButtonStyle(active: boolean): CSSProperties {
  return {
    width: 44,
    height: 44,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: `1px solid ${active ? "var(--x-color-accent-border)" : "var(--x-color-line)"}`,
    background: active ? "var(--x-color-accent-soft)" : "var(--x-color-panel)",
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)",
    fontSize: 16,
    cursor: "pointer",
    borderRadius: 16,
  };
}

const playBtnStyle: CSSProperties = {
  width: 64,
  height: 64,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  background: "var(--x-color-accent)",
  color: "#fff",
  fontSize: 24,
  cursor: "pointer",
  borderRadius: 32,
  boxShadow: "0 14px 30px rgba(15,118,110,0.24)",
  padding: 0,
};

function playIconStyle(isPlaying: boolean): CSSProperties {
  return {
    fontSize: isPlaying ? 22 : 24,
    marginLeft: isPlaying ? 0 : 3,
  };
}

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

const queuePanelStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  background: "var(--x-color-canvas)",
};

const queueHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "14px 16px 10px",
  flexShrink: 0,
};

const queueHeaderTextStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
};

const clearQueueBtnStyle: CSSProperties = {
  minHeight: "34px",
  padding: "0 12px",
  borderRadius: "10px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
  fontWeight: 700,
};

const queueListStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "0 14px 24px",
  display: "grid",
  gap: 10,
};

const queueEmptyStyle: CSSProperties = {
  padding: "40px 24px",
  textAlign: "center",
  fontSize: 14,
  color: "var(--x-color-ink-muted)",
};

function queueRowStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    background: active ? "var(--x-color-accent-soft)" : "var(--x-color-panel)",
    border: `1px solid ${active ? "var(--x-color-accent-border)" : "var(--x-color-line)"}`,
    borderRadius: 16,
  };
}

const queueTrackBtnStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 0 12px 14px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
  minWidth: 0,
};

function queueTrackNumStyle(active: boolean): CSSProperties {
  return {
    width: 22,
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 700,
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)",
  };
}

const queueTrackMetaStyle: CSSProperties = {
  display: "grid",
  gap: 2,
  minWidth: 0,
  flex: 1,
};

function queueTrackTitleStyle(active: boolean): CSSProperties {
  return {
    fontSize: 14,
    fontWeight: 700,
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}

const queueTrackAlbumStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--x-color-ink-muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const queueRemoveBtnStyle: CSSProperties = {
  width: 40,
  height: 40,
  flexShrink: 0,
  border: "none",
  background: "transparent",
  color: "var(--x-color-ink-muted)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};
