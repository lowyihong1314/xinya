import type { CSSProperties } from "react";

const WAVE_SCALES = [0.28, 0.44, 0.66, 0.84, 0.58, 0.76, 0.96, 0.68, 0.5, 0.72, 0.92, 0.62, 0.4, 0.56, 0.78, 0.98, 0.7, 0.46, 0.64, 0.88, 0.6, 0.82, 0.94, 0.54];
const ENERGY_PARTICLES = [
  { left: 6, top: 66, size: 4, duration: 2.2, delay: -0.8 },
  { left: 14, top: 40, size: 5, duration: 1.9, delay: -0.3 },
  { left: 22, top: 60, size: 3, duration: 2.5, delay: -1.1 },
  { left: 30, top: 34, size: 6, duration: 2.15, delay: -0.5 },
  { left: 42, top: 72, size: 4, duration: 2.8, delay: -1.4 },
  { left: 51, top: 48, size: 5, duration: 2.35, delay: -0.1 },
  { left: 60, top: 28, size: 3, duration: 1.8, delay: -1.2 },
  { left: 72, top: 62, size: 5, duration: 2.6, delay: -0.9 },
  { left: 82, top: 38, size: 4, duration: 2.05, delay: -0.6 },
  { left: 92, top: 58, size: 3, duration: 2.45, delay: -1.5 },
] as const;

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
  const clampedProgressRatio = Math.max(0, Math.min(progressRatio, 1));
  const hasPlayback = safeDuration > 0;

  return (
    <div style={timelineShellStyle}>
      <style>{waveKeyframes}</style>
      <div style={timelineTrackStyle}>
        <div style={waveRowStyle}>
          {WAVE_SCALES.map((scale, index) => {
            const threshold = (index + 1) / WAVE_SCALES.length;
            const active = clampedProgressRatio >= threshold;
            return (
              <span
                key={index}
                style={waveBarStyle(scale, active, isPlaying, index)}
              />
            );
          })}
        </div>

        <div style={energyRailShellStyle}>
          <div style={energyRailBaseStyle} />
          <div style={energyRailFillClipStyle(clampedProgressRatio, hasPlayback)}>
            <div style={energyRailFillStyle(isPlaying)} />
            <div style={energyRailSheenStyle(isPlaying)} />
            <div style={energyParticleLayerStyle}>
              {ENERGY_PARTICLES.map((particle, index) => (
                <span
                  key={index}
                  style={energyParticleStyle(particle, isPlaying, hasPlayback)}
                />
              ))}
            </div>
          </div>
          <div style={playheadHaloStyle(clampedProgressRatio, isPlaying, hasPlayback)} />
          <div style={playheadCoreStyle(clampedProgressRatio, hasPlayback)} />
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
    height: `${13 + Math.round(scale * 28)}px`,
    borderRadius: 999,
    background: active
      ? "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, #67e8f9 20%, var(--x-color-accent) 58%, var(--x-color-accent-strong) 100%)"
      : "linear-gradient(180deg, var(--x-color-line) 0%, var(--x-color-line-soft) 100%)",
    opacity: active ? 1 : 0.52,
    transformOrigin: "center",
    animation: isPlaying && active ? `x-music-wave-pulse ${0.86 + index * 0.03}s ease-in-out infinite` : "none",
    animationDelay: `${index * 0.04}s`,
    boxShadow: active ? "0 0 14px rgba(45, 212, 191, 0.24)" : "none",
    transition: "background 160ms ease, opacity 160ms ease, box-shadow 180ms ease",
  };
}

function energyRailFillClipStyle(progressRatio: number, hasPlayback: boolean): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    width: hasPlayback ? `${progressRatio * 100}%` : 0,
    borderRadius: "999px",
    overflow: "hidden",
    transition: "width 180ms ease",
  };
}

function energyRailFillStyle(isPlaying: boolean): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    borderRadius: "999px",
    background: isPlaying
      ? "linear-gradient(90deg, rgba(103, 232, 249, 0.84) 0%, rgba(45, 212, 191, 0.98) 52%, var(--x-color-accent) 100%)"
      : "linear-gradient(90deg, rgba(103, 232, 249, 0.48) 0%, rgba(45, 212, 191, 0.72) 54%, rgba(13, 148, 136, 0.82) 100%)",
    boxShadow: "0 0 16px rgba(45, 212, 191, 0.34)",
  };
}

function energyRailSheenStyle(isPlaying: boolean): CSSProperties {
  return {
    position: "absolute",
    inset: "-20% auto -20% -12%",
    width: "30%",
    background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.72), rgba(255,255,255,0))",
    mixBlendMode: "screen",
    opacity: isPlaying ? 1 : 0.5,
    animation: isPlaying ? "x-music-energy-flow 2.2s linear infinite" : "none",
  };
}

function energyParticleStyle(
  particle: (typeof ENERGY_PARTICLES)[number],
  isPlaying: boolean,
  hasPlayback: boolean,
): CSSProperties {
  return {
    position: "absolute",
    left: `${particle.left}%`,
    top: `${particle.top}%`,
    width: `${particle.size}px`,
    height: `${particle.size}px`,
    borderRadius: "999px",
    background: "rgba(255,255,255,0.88)",
    boxShadow: "0 0 10px rgba(103, 232, 249, 0.92), 0 0 16px rgba(45, 212, 191, 0.42)",
    opacity: hasPlayback ? (isPlaying ? 1 : 0.38) : 0,
    animation: isPlaying ? `x-music-particle-drift ${particle.duration}s ease-in-out infinite` : "none",
    animationDelay: `${particle.delay}s`,
  };
}

function playheadPosition(progressRatio: number) {
  if (progressRatio <= 0) {
    return { left: "0%", transform: "translate(0, -50%)" };
  }
  if (progressRatio >= 1) {
    return { left: "100%", transform: "translate(-100%, -50%)" };
  }
  return { left: `${progressRatio * 100}%`, transform: "translate(-50%, -50%)" };
}

function playheadHaloStyle(progressRatio: number, isPlaying: boolean, hasPlayback: boolean): CSSProperties {
  const position = playheadPosition(progressRatio);
  return {
    position: "absolute",
    top: "50%",
    left: position.left,
    transform: position.transform,
    width: hasPlayback ? "18px" : "12px",
    height: hasPlayback ? "18px" : "12px",
    borderRadius: "999px",
    background: "radial-gradient(circle, rgba(165, 243, 252, 0.52) 0%, rgba(45, 212, 191, 0.2) 52%, rgba(45, 212, 191, 0) 76%)",
    opacity: hasPlayback ? 1 : 0.45,
    animation: isPlaying && hasPlayback ? "x-music-playhead-pulse 1.5s ease-in-out infinite" : "none",
  };
}

function playheadCoreStyle(progressRatio: number, hasPlayback: boolean): CSSProperties {
  const position = playheadPosition(progressRatio);
  return {
    position: "absolute",
    top: "50%",
    left: position.left,
    transform: position.transform,
    width: hasPlayback ? "10px" : "8px",
    height: hasPlayback ? "10px" : "8px",
    borderRadius: "999px",
    border: "2px solid rgba(255,255,255,0.72)",
    background: "linear-gradient(180deg, #a5f3fc 0%, #2dd4bf 100%)",
    boxShadow: "0 0 0 1px rgba(13, 148, 136, 0.24), 0 0 14px rgba(45, 212, 191, 0.46)",
  };
}

const waveKeyframes = `
@keyframes x-music-wave-pulse {
  0%, 100% { transform: scaleY(0.72); opacity: 0.82; }
  50% { transform: scaleY(1.12); opacity: 1; }
}

@keyframes x-music-energy-flow {
  0% { transform: translateX(-42%) skewX(-18deg); opacity: 0; }
  20% { opacity: 0.58; }
  60% { opacity: 0.88; }
  100% { transform: translateX(176%) skewX(-18deg); opacity: 0; }
}

@keyframes x-music-particle-drift {
  0% { transform: translate3d(-10px, 7px, 0) scale(0.45); opacity: 0; }
  22% { opacity: 0.7; }
  54% { opacity: 1; }
  100% { transform: translate3d(12px, -9px, 0) scale(1.05); opacity: 0; }
}

@keyframes x-music-playhead-pulse {
  0%, 100% { transform: translate(-50%, -50%) scale(0.92); opacity: 0.4; }
  50% { transform: translate(-50%, -50%) scale(1.14); opacity: 0.95; }
}
`;

const timelineShellStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const timelineTrackStyle: CSSProperties = {
  position: "relative",
  minHeight: "62px",
  padding: "2px 0 8px",
};

const waveRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "end",
  justifyContent: "space-between",
  gap: "4px",
  width: "100%",
  paddingBottom: "14px",
};

const energyRailShellStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: "2px",
  height: "8px",
  pointerEvents: "none",
};

const energyRailBaseStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  borderRadius: "999px",
  background: "linear-gradient(90deg, rgba(148, 163, 184, 0.18), rgba(148, 163, 184, 0.28))",
};

const energyParticleLayerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
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
