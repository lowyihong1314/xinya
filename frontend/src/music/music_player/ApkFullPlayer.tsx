import type { CSSProperties } from "react";
import { useState } from "react";

import { resolveAlbumCoverUrl } from "./musicCoverUtils";
import { formatTime } from "./ApkAlbumComponents";
import type { MusicRecord } from "./types";

type RepeatMode = "off" | "all" | "one";

type FullPlayerProps = {
  music: MusicRecord;
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
  music, isPlaying, progress, duration, shuffleEnabled, repeatMode,
  queue, currentMusicId, onClose, onPrev, onNext, onTogglePlay,
  onToggleShuffle, onCycleRepeat, onSeek,
  onPlayFromQueue, onRemoveFromQueue, onClearQueue,
}: FullPlayerProps) {
  const [showQueue, setShowQueue] = useState(false);
  const repeatLabel = repeatMode === "off" ? "不循环" : repeatMode === "all" ? "列表循环" : "单曲循环";

  return (
    <div style={fullPlayerStyle}>
      {/* Top bar */}
      <div style={fullTopBarStyle}>
        <button style={fullIconBtnStyle} onClick={onClose}>
          <i className="fas fa-chevron-down" />
        </button>
        <span style={fullTopTitleStyle}>{showQueue ? "播放队列" : "正在播放"}</span>
        <button style={fullIconBtnStyle} onClick={() => setShowQueue((v) => !v)} title="播放队列">
          <i className={showQueue ? "fas fa-music" : "fas fa-list-ul"} />
          {queue.length > 0 && !showQueue && (
            <span style={queueBadgeStyle}>{queue.length}</span>
          )}
        </button>
      </div>

      {showQueue ? (
        <div style={queuePanelStyle}>
          <div style={queueHeaderStyle}>
            <span style={queueHeaderTextStyle}>队列 · {queue.length} 首</span>
            {queue.length > 0 && (
              <button style={clearQueueBtnStyle} onClick={onClearQueue}>清空</button>
            )}
          </div>
          <div style={queueListStyle}>
            {queue.length === 0 ? (
              <div style={queueEmptyStyle}>队列为空，从专辑页添加歌曲</div>
            ) : (
              queue.map((track, i) => (
                <div key={track.id} style={queueRowStyle(track.id === currentMusicId)}>
                  <button style={queueTrackBtnStyle} onClick={() => onPlayFromQueue(track.id)}>
                    <span style={queueTrackNumStyle(track.id === currentMusicId)}>{i + 1}</span>
                    <span style={queueTrackTitleStyle(track.id === currentMusicId)}>{track.title}</span>
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
            <img
              src={resolveAlbumCoverUrl(music.cover_url)}
              alt={music.title}
              style={fullCoverImgStyle}
            />
          </div>
          <div style={fullMetaStyle}>
            <div style={fullTitleStyle}>{music.title}</div>
            <div style={fullAlbumStyle}>{music.album?.name ?? ""}</div>
          </div>
          <div style={fullProgressWrapStyle}>
            <input
              type="range" min={0} max={duration || 1} step={0.5} value={progress}
              onChange={(e) => onSeek(Number(e.target.value))}
              style={rangeStyle}
            />
            <div style={fullTimesStyle}>
              <span>{formatTime(progress)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
          <div style={fullTransportStyle}>
            <button style={toggleBtnStyle(shuffleEnabled)} onClick={onToggleShuffle} title="随机">
              <i className="fas fa-shuffle" />
            </button>
            <button style={transpBtnStyle} onClick={onPrev}>
              <i className="fas fa-backward-step" />
            </button>
            <button style={playBtnStyle} onClick={onTogglePlay}>
              <i className={isPlaying ? "fas fa-pause" : "fas fa-play"} />
            </button>
            <button style={transpBtnStyle} onClick={onNext}>
              <i className="fas fa-forward-step" />
            </button>
            <button style={toggleBtnStyle(repeatMode !== "off")} onClick={onCycleRepeat} title={repeatLabel}>
              <i className={repeatMode === "one" ? "fas fa-1" : "fas fa-repeat"} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const fullPlayerStyle: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 2000,
  background: "linear-gradient(180deg, var(--x-color-nav-start) 0%, #0a1628 100%)",
  display: "flex", flexDirection: "column", overflow: "hidden", maxWidth: "100vw",
};

const fullTopBarStyle: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "12px 12px 0", flexShrink: 0,
};

const fullTopTitleStyle: CSSProperties = {
  flex: 1, textAlign: "center", fontSize: 14, fontWeight: 600,
  color: "rgba(255,255,255,0.7)", padding: "0 4px",
};

const fullIconBtnStyle: CSSProperties = {
  width: 42, height: 42, flexShrink: 0, position: "relative",
  display: "flex", alignItems: "center", justifyContent: "center",
  border: "none", background: "transparent",
  color: "rgba(255,255,255,0.7)", fontSize: 19, cursor: "pointer", borderRadius: 10,
};

const queueBadgeStyle: CSSProperties = {
  position: "absolute", top: 6, right: 6,
  background: "rgba(255,255,255,0.85)", color: "var(--x-color-nav-start)",
  fontSize: 9, fontWeight: 700, borderRadius: 99,
  minWidth: 14, height: 14, lineHeight: "14px", textAlign: "center", padding: "0 3px",
};

const playerPanelStyle: CSSProperties = {
  flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
  padding: "16px 20px 24px", overflow: "hidden", minWidth: 0,
};

const fullCoverStyle: CSSProperties = {
  width: "min(240px, 72vw)", height: "min(240px, 72vw)", flexShrink: 0,
  borderRadius: 20, overflow: "hidden",
  boxShadow: "0 20px 56px rgba(0,0,0,0.55)", marginBottom: 24,
};

const fullCoverImgStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

const fullMetaStyle: CSSProperties = { width: "100%", marginBottom: 20, minWidth: 0 };

const fullTitleStyle: CSSProperties = {
  fontSize: 20, fontWeight: 700, color: "white", marginBottom: 4,
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const fullAlbumStyle: CSSProperties = {
  fontSize: 14, color: "rgba(255,255,255,0.6)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const fullProgressWrapStyle: CSSProperties = { width: "100%", marginBottom: 24, minWidth: 0 };

const rangeStyle: CSSProperties = { width: "100%", accentColor: "white", cursor: "pointer", display: "block" };

const fullTimesStyle: CSSProperties = {
  display: "flex", justifyContent: "space-between",
  fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4,
};

const fullTransportStyle: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 12, width: "100%",
};

function toggleBtnStyle(active: boolean): CSSProperties {
  return {
    width: 38, height: 38, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    border: "none", background: "transparent",
    color: active ? "white" : "rgba(255,255,255,0.35)",
    fontSize: 17, cursor: "pointer", borderRadius: 8,
  };
}

const transpBtnStyle: CSSProperties = {
  width: 44, height: 44, flexShrink: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
  border: "none", background: "transparent",
  color: "rgba(255,255,255,0.88)", fontSize: 24, cursor: "pointer", borderRadius: 12,
};

const playBtnStyle: CSSProperties = {
  width: 60, height: 60, flexShrink: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
  border: "none", background: "rgba(255,255,255,0.18)",
  color: "white", fontSize: 26, cursor: "pointer", borderRadius: 30,
};

const queuePanelStyle: CSSProperties = { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" };

const queueHeaderStyle: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "14px 16px 10px", flexShrink: 0,
};

const queueHeaderTextStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)" };

const clearQueueBtnStyle: CSSProperties = {
  fontSize: 13, color: "rgba(255,255,255,0.5)",
  background: "transparent", border: "none", cursor: "pointer", padding: "4px 8px",
};

const queueListStyle: CSSProperties = { flex: 1, overflowY: "auto" };

const queueEmptyStyle: CSSProperties = {
  padding: "40px 24px", textAlign: "center", fontSize: 14, color: "rgba(255,255,255,0.4)",
};

function queueRowStyle(active: boolean): CSSProperties {
  return {
    display: "flex", alignItems: "center",
    background: active ? "rgba(255,255,255,0.1)" : "transparent",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  };
}

const queueTrackBtnStyle: CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", gap: 10,
  padding: "12px 0 12px 16px",
  border: "none", background: "transparent", cursor: "pointer", textAlign: "left", minWidth: 0,
};

function queueTrackNumStyle(active: boolean): CSSProperties {
  return { width: 22, flexShrink: 0, textAlign: "center", fontSize: 12, color: active ? "white" : "rgba(255,255,255,0.4)" };
}

function queueTrackTitleStyle(active: boolean): CSSProperties {
  return {
    fontSize: 14, fontWeight: active ? 600 : 400,
    color: active ? "white" : "rgba(255,255,255,0.75)",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  };
}

const queueRemoveBtnStyle: CSSProperties = {
  width: 40, height: 40, flexShrink: 0, marginRight: 8,
  display: "flex", alignItems: "center", justifyContent: "center",
  border: "none", background: "transparent",
  color: "rgba(255,255,255,0.35)", fontSize: 14, cursor: "pointer", borderRadius: 8,
};
