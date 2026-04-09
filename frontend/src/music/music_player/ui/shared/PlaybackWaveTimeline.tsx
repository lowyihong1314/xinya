import type { CSSProperties } from "react";

const WAVE_SCALES = [0.28, 0.44, 0.66, 0.84, 0.58, 0.76, 0.96, 0.68, 0.5, 0.72, 0.92, 0.62, 0.4, 0.56, 0.78, 0.98, 0.7, 0.46, 0.64, 0.88, 0.6, 0.82, 0.94, 0.54];

export function PlaybackWaveTimeline({
  currentTime,
  duration,
  isPlaying,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onSeek: (time: number) => void;
}) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrentTime = Math.max(0, Math.min(Number.isFinite(currentTime) ? currentTime : 0, safeDuration || Number.MAX_SAFE_INTEGER));
  const progressRatio = safeDuration > 0 ? safeCurrentTime / safeDuration : 0;

  return (
    <div style={timelineShellStyle}>
      <style>{waveKeyframes}</style>
      <div style={timelineTrackStyle}>
        <div style={waveRowStyle}>
          {WAVE_SCALES.map((scale, index) => {
            const threshold = (index + 1) / WAVE_SCALES.length;
            const active = progressRatio >= threshold;
            return (
              <span
                key={index}
                style={waveBarStyle(scale, active, isPlaying, index)}
              />
            );
          })}
        </div>
        <input
          type="range"
          min={0}
          max={safeDuration || 1}
          step={0.2}
          value={safeCurrentTime}
          onChange={(event) => onSeek(Number(event.target.value))}
          style={rangeOverlayStyle}
          aria-label="播放进度"
        />
      </div>
      <div style={timeRowStyle}>
        <span>{formatTime(safeCurrentTime)}</span>
        <span>{formatTime(safeDuration)}</span>
      </div>
    </div>
  );
}

function formatTime(seconds: number) {
  if (!seconds || !isFinite(seconds)) {
    return "0:00";
  }
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function waveBarStyle(scale: number, active: boolean, isPlaying: boolean, index: number): CSSProperties {
  return {
    width: 4,
    minHeight: 10,
    height: `${12 + Math.round(scale * 26)}px`,
    borderRadius: 999,
    background: active ? "var(--x-color-accent)" : "var(--x-color-line)",
    opacity: active ? 1 : 0.52,
    transformOrigin: "center",
    animation: isPlaying && active ? `x-music-wave-pulse ${0.86 + index * 0.03}s ease-in-out infinite` : "none",
    animationDelay: `${index * 0.04}s`,
    transition: "background 160ms ease, opacity 160ms ease",
  };
}

const waveKeyframes = `
@keyframes x-music-wave-pulse {
  0%, 100% { transform: scaleY(0.72); opacity: 0.82; }
  50% { transform: scaleY(1.08); opacity: 1; }
}
`;

const timelineShellStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const timelineTrackStyle: CSSProperties = {
  position: "relative",
  display: "grid",
  alignItems: "center",
  minHeight: "62px",
  padding: "10px 12px",
  borderRadius: "18px",
  border: "1px solid var(--x-color-line)",
  background: "linear-gradient(180deg, var(--x-color-panel-alt), var(--x-color-panel))",
  overflow: "hidden",
};

const waveRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "4px",
  width: "100%",
};

const rangeOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  opacity: 0,
  cursor: "pointer",
  margin: 0,
};

const timeRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  fontSize: "11px",
  color: "var(--x-color-ink-muted)",
  padding: "0 2px",
};
