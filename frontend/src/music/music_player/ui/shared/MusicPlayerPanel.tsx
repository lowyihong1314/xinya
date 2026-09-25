import type { CSSProperties, RefObject } from "react";

import { buildMusicCoverCacheKey } from "../../logic/musicCoverUtils";
import type { PlaybackDeviceRecord } from "../../logic/types";
import { MusicCoverImage } from "./MusicCoverImage";
import { PlaybackWaveTimeline } from "./PlaybackWaveTimeline";

type RepeatMode = "off" | "all" | "one";

type PlayerMusicRecord = {
  id: number;
  title: string;
  cover_url?: string | null;
  has_accompaniment?: boolean;
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
  /** 撑满父容器高度（手机端播放器整页不滚动）。 */
  fill?: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  hasQueue: boolean;
  /** 伴奏模式开关；当前曲有伴奏才显示。 */
  accompanimentMode?: boolean;
  hasAccompaniment?: boolean;
  onToggleAccompaniment?: () => void;
  /** 管理员：当前曲没有伴奏时显示「上传伴奏」。 */
  onUploadAccompaniment?: () => void;
  /** 传了就显示「加入歌单」。 */
  onAddToPlaylist?: () => void;
  /** 其他设备正在出声时的设备名。 */
  remoteDeviceName?: string | null;
  onTakeOver?: () => void;
  /** 设备选择器：在线设备、当前出声设备、本机 id。 */
  devices?: PlaybackDeviceRecord[];
  activeDeviceId?: string | null;
  thisDeviceId?: string | null;
  onSelectDevice?: (deviceId: string) => void;
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
  fill = false,
  shuffleEnabled,
  repeatMode,
  hasQueue,
  accompanimentMode = false,
  hasAccompaniment = false,
  onToggleAccompaniment,
  onUploadAccompaniment,
  onAddToPlaylist,
  remoteDeviceName = null,
  devices = [],
  activeDeviceId = null,
  thisDeviceId = null,
  onSelectDevice,
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
    : "从「找歌」里选一首歌开始播放";
  const playbackStateLabel = currentMusic ? (isPlaying ? "播放中" : "已暂停") : "待命";
  const canControl = Boolean(currentMusic);
  const showAccompanimentToggle = typeof onToggleAccompaniment === "function" && canControl && hasAccompaniment;
  const showAccompanimentUpload = typeof onUploadAccompaniment === "function" && canControl && !hasAccompaniment;
  const accompanimentActive = accompanimentMode && hasAccompaniment;
  const showDeviceSelect = typeof onSelectDevice === "function" && (devices.length > 1 || Boolean(remoteDeviceName));

  const coverNode = currentMusic ? (
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
  );

  const headerRow = (
    <div style={headerRowStyle}>
      <div style={eyebrowStyle}>播放器</div>
      <div style={headerActionsStyle}>
        {onAddToPlaylist ? (
          <button type="button" style={smallPillStyle(false, !canControl)} onClick={onAddToPlaylist} disabled={!canControl} title="把这首歌加入我的歌单">
            <i className="fas fa-list-music" />
            <span>歌单</span>
          </button>
        ) : null}
        {showAccompanimentUpload ? (
          <button type="button" style={smallPillStyle(false, false)} onClick={onUploadAccompaniment} title="这首歌还没有伴奏，点击上传">
            <i className="fas fa-upload" />
            <span>上传伴奏</span>
          </button>
        ) : null}
        <span style={statePillStyle(canControl, isPlaying)}>{playbackStateLabel}</span>
      </div>
    </div>
  );

  const infoRows = (
    <>
      <h2 style={titleStyle(compact, isMobile)} title={currentMusic?.title || ""}>
        {currentMusic?.title || "选择一首歌曲开始播放"}
      </h2>
      <div style={subtitleRowStyle}>
        <span style={subtitleTextStyle} title={resolvedAlbumName}>
          {remoteDeviceName ? <i className="fas fa-tower-broadcast" style={{ marginRight: "6px", color: "var(--x-color-accent-strong)" }} /> : null}
          {resolvedAlbumName}
        </span>
        {showDeviceSelect ? (
          <select
            style={deviceSelectStyle}
            value={activeDeviceId ?? thisDeviceId ?? ""}
            onChange={(event) => {
              if (event.target.value) onSelectDevice?.(event.target.value);
            }}
            title={remoteDeviceName ? `正在遥控「${remoteDeviceName}」，可切换出声设备` : "选择出声的设备"}
          >
            {devices.map((device) => (
              <option key={device.device_id} value={device.device_id}>
                {device.device_id === thisDeviceId ? "本机 · " : ""}
                {device.device_name}
                {device.is_active ? " ♪" : ""}
              </option>
            ))}
            {thisDeviceId && !devices.some((device) => device.device_id === thisDeviceId) ? (
              <option value={thisDeviceId}>本机</option>
            ) : null}
          </select>
        ) : null}
      </div>
    </>
  );

  const controls = (
    <>
      {audioRef ? <audio ref={audioRef} preload="metadata" onEnded={onTrackEnded} style={hiddenAudioStyle} /> : null}

      <PlaybackWaveTimeline currentTime={currentTime} duration={duration} isPlaying={isPlaying} onSeek={onSeek} />

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
          aria-label={repeatLabel(repeatMode)}
          title={repeatLabel(repeatMode)}
        >
          <RepeatModeGlyph repeatMode={repeatMode} />
        </button>
        {showAccompanimentToggle ? (
          <button
            type="button"
            style={transportIconButtonStyle(isMobile, accompanimentActive, false)}
            onClick={onToggleAccompaniment}
            aria-pressed={accompanimentMode}
            aria-label={accompanimentActive ? "切回原唱" : "切换到伴奏"}
            title={accompanimentActive ? "正在播放伴奏版，点击切回原唱" : "切换到伴奏版"}
          >
            <i className="fas fa-guitar" />
          </button>
        ) : null}
      </div>
    </>
  );

  if (isMobile) {
    // 手机：一整页不滚动，封面吃掉剩余高度。
    return (
      <section style={mobilePanelStyle(fill)}>
        {headerRow}
        <div style={mobileCoverAreaStyle}>
          <div style={mobileCoverBoxStyle}>{coverNode}</div>
        </div>
        <div style={mobileBodyStyle}>
          {infoRows}
          {controls}
        </div>
      </section>
    );
  }

  return (
    <section style={desktopPanelStyle(compact)}>
      <div style={desktopLayoutStyle}>
        <div style={desktopCoverShellStyle}>{coverNode}</div>
        <div style={desktopBodyStyle}>
          {headerRow}
          {infoRows}
          {controls}
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

function RepeatModeGlyph({ repeatMode }: { repeatMode: RepeatMode }) {
  return (
    <span style={repeatGlyphShellStyle}>
      <i className="fas fa-repeat" />
      {repeatMode === "one" ? <span style={repeatSingleBadgeStyle}>1</span> : null}
    </span>
  );
}

// ---------- layout ----------

function mobilePanelStyle(fill: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    height: fill ? "100%" : "auto",
    minHeight: 0,
    overflow: "hidden",
    padding: 0,
    background: "transparent",
  };
}

const mobileCoverAreaStyle: CSSProperties = {
  flex: "1 1 auto",
  minHeight: "120px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
};

const mobileCoverBoxStyle: CSSProperties = {
  height: "100%",
  maxHeight: "100%",
  maxWidth: "100%",
  aspectRatio: "1 / 1",
  borderRadius: "18px",
  overflow: "hidden",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
};

const mobileBodyStyle: CSSProperties = {
  flex: "0 0 auto",
  display: "grid",
  gap: "8px",
};

function desktopPanelStyle(compact: boolean): CSSProperties {
  return {
    display: "grid",
    gap: compact ? "14px" : "18px",
    padding: compact ? "18px" : "22px",
    borderRadius: "24px",
    background: "var(--x-color-panel-strongest)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 14px 32px var(--x-color-shadow-soft)",
    alignContent: "start",
  };
}

const desktopLayoutStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "220px minmax(0, 1fr)",
  gap: "24px",
  alignItems: "start",
};

const desktopCoverShellStyle: CSSProperties = {
  width: "220px",
  aspectRatio: "1 / 1",
  borderRadius: "22px",
  overflow: "hidden",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
};

const desktopBodyStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  alignContent: "start",
  minWidth: 0,
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
  background: "linear-gradient(135deg, var(--x-color-panel-alt), var(--x-color-accent-soft))",
  color: "var(--x-color-accent-strong)",
};

const coverPlaceholderGlyphStyle: CSSProperties = {
  fontSize: "54px",
  lineHeight: 1,
};

// ---------- header ----------

const headerRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "8px",
  minWidth: 0,
};

const headerActionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-accent)",
  whiteSpace: "nowrap",
};

function statePillStyle(hasMusic: boolean, isPlaying: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "26px",
    padding: "0 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 700,
    color: hasMusic ? (isPlaying ? "var(--x-color-accent-strong)" : "var(--x-color-ink)") : "var(--x-color-ink-muted)",
    background: hasMusic && isPlaying ? "var(--x-color-accent-soft)" : "var(--x-color-panel-alt)",
    border: "1px solid var(--x-color-line)",
    whiteSpace: "nowrap",
  };
}

function smallPillStyle(active: boolean, disabled: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    minHeight: "26px",
    padding: "0 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    color: active ? "#fff" : "var(--x-color-ink)",
    background: active ? "var(--x-color-accent)" : "var(--x-color-panel)",
    border: "1px solid var(--x-color-line)",
    whiteSpace: "nowrap",
  };
}

// ---------- info ----------

function titleStyle(compact: boolean, isMobile: boolean): CSSProperties {
  return {
    margin: 0,
    fontSize: compact ? "20px" : isMobile ? "22px" : "28px",
    lineHeight: 1.15,
    color: "var(--x-color-ink)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0,
  };
}

const subtitleRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
  minWidth: 0,
};

const subtitleTextStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const deviceSelectStyle: CSSProperties = {
  flex: "0 1 auto",
  minWidth: 0,
  maxWidth: "52%",
  minHeight: "26px",
  padding: "0 8px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-accent-border)",
  background: "var(--x-color-accent-soft)",
  color: "var(--x-color-accent-strong)",
  fontSize: "11px",
  fontWeight: 700,
  textOverflow: "ellipsis",
};

const hiddenAudioStyle: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  opacity: 0,
  pointerEvents: "none",
};

// ---------- transport ----------

function transportRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: isMobile ? "space-between" : "center",
    gap: isMobile ? "6px" : "10px",
    width: "100%",
  };
}

function transportIconButtonStyle(isMobile: boolean, active: boolean, disabled: boolean): CSSProperties {
  return {
    width: isMobile ? "42px" : "46px",
    height: isMobile ? "42px" : "46px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "14px",
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line)",
    background: active ? "var(--x-color-accent-soft)" : "var(--x-color-panel)",
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.46 : 1,
  };
}

function playPauseButtonStyle(isMobile: boolean, disabled: boolean): CSSProperties {
  return {
    width: isMobile ? "56px" : "60px",
    height: isMobile ? "56px" : "60px",
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
    boxShadow: "0 12px 26px rgba(15,118,110,0.24)",
  };
}

function playPauseIconStyle(isPlaying: boolean): CSSProperties {
  return {
    fontSize: isPlaying ? "20px" : "22px",
    marginLeft: isPlaying ? 0 : "3px",
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
