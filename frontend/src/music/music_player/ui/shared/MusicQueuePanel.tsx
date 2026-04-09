import type { CSSProperties } from "react";

import { buildMusicCoverCacheKey } from "../../logic/musicCoverUtils";
import { MusicCoverImage } from "./MusicCoverImage";

type QueueMusicRecord = {
  id: number;
  title: string;
  cover_url?: string | null;
  album?: {
    name?: string | null;
    cover_url?: string | null;
    image?: string | null;
  } | null;
};

export function MusicQueuePanel({
  isMobile,
  queue,
  currentMusic,
  currentMusicId,
  onOpenPlayer,
  onPlayFromQueue,
  onRemoveFromQueue,
  onClearQueue,
}: {
  isMobile: boolean;
  queue: QueueMusicRecord[];
  currentMusic: QueueMusicRecord | null;
  currentMusicId: number | null;
  onOpenPlayer?: () => void;
  onPlayFromQueue: (musicId: number) => void;
  onRemoveFromQueue: (musicId: number) => void;
  onClearQueue: () => void;
}) {
  return (
    <section style={queueShellStyle(isMobile)}>
      <div style={queueHeroStyle(isMobile)}>
        <div>
          <div style={queueHeroEyebrowStyle}>Playback Queue</div>
          <div style={queueHeroTitleStyle}>当前列队</div>
          <div style={queueHeroCopyStyle}>
            {queue.length
              ? `${queue.length} 首歌已经进入待播清单，可以随时点回播放器继续听。`
              : "当前还没有歌曲进入待播清单。"}
          </div>
        </div>
        <div style={queueHeroActionsStyle}>
          {onOpenPlayer ? (
            <button type="button" style={queueSwitchButtonStyle} onClick={onOpenPlayer}>
              <i className="fas fa-circle-play" />
              <span>回播放器</span>
            </button>
          ) : null}
          <button
            type="button"
            style={queueClearButtonStyle}
            disabled={!queue.length}
            onClick={onClearQueue}
          >
            清空列队
          </button>
        </div>
      </div>

      {currentMusic ? (
        <div style={nowPlayingBannerStyle}>
          <div style={nowPlayingCoverStyle}>
            <MusicCoverImage
              source={currentMusic.album || currentMusic.cover_url}
              cacheKey={buildMusicCoverCacheKey("queue-now-playing", currentMusic.id)}
              alt={currentMusic.title}
              style={nowPlayingCoverImgStyle}
            />
          </div>
          <div style={nowPlayingCopyStyle}>
            <span style={nowPlayingLabelStyle}>正在播放</span>
            <span style={nowPlayingTitleStyle}>{currentMusic.title}</span>
          </div>
        </div>
      ) : null}

      {queue.length ? (
        <div style={queueListStyle}>
          {queue.map((music, index) => {
            const active = music.id === currentMusicId;
            return (
              <div key={music.id} style={queueRowStyle(active, isMobile)}>
                <button type="button" style={queuePlayButtonStyle} onClick={() => onPlayFromQueue(music.id)}>
                  <div style={queueCoverStyle}>
                    <MusicCoverImage
                      source={music.album || music.cover_url}
                      cacheKey={buildMusicCoverCacheKey("queue-track", music.id)}
                      alt={music.title}
                      style={queueCoverImgStyle}
                    />
                  </div>
                  <span style={queueIndexStyle(active)}>{String(index + 1).padStart(2, "0")}</span>
                  <span style={queueTextStyle}>
                    <span style={queueNameStyle(active)}>{music.title}</span>
                    <span style={queueSubStyle}>{music.album?.name || "未分配专辑"}</span>
                  </span>
                </button>
                <button type="button" style={queueRemoveButtonStyle} onClick={() => onRemoveFromQueue(music.id)}>
                  移除
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={queueEmptyStyle}>
          先在“找歌”里打开全部歌曲或某张专辑，然后点歌开始播放；歌曲会自动进入这里的列队。
        </div>
      )}
    </section>
  );
}

function queueShellStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: isMobile ? "14px" : "18px",
    padding: isMobile ? "12px 0 0" : "22px",
    borderRadius: isMobile ? 0 : "28px",
    background: isMobile
      ? "transparent"
      : "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(239,245,252,0.96))",
    border: isMobile ? "none" : "1px solid rgba(216, 223, 235, 0.95)",
    boxShadow: isMobile ? "none" : "0 18px 42px rgba(15, 23, 42, 0.08)",
  };
}

function queueHeroStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto",
    gap: "14px",
    alignItems: "center",
  };
}

const queueHeroActionsStyle: CSSProperties = {
  display: "inline-flex",
  gap: "10px",
  flexWrap: "wrap",
};

const queueHeroEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-accent)",
  fontWeight: 700,
};

const queueHeroTitleStyle: CSSProperties = {
  marginTop: "4px",
  fontSize: "28px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const queueHeroCopyStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "14px",
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.7,
};

const queueSwitchButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "999px",
  padding: "10px 14px",
  background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
};

const queueClearButtonStyle: CSSProperties = {
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-danger)",
  borderRadius: "12px",
  padding: "10px 14px",
  fontWeight: 700,
  cursor: "pointer",
};

const nowPlayingBannerStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "72px minmax(0, 1fr)",
  gap: "14px",
  alignItems: "center",
  padding: "14px 16px",
  borderRadius: "18px",
  background: "var(--x-color-accent-soft)",
  border: "1px solid var(--x-color-accent-border)",
};

const nowPlayingCoverStyle: CSSProperties = {
  width: "72px",
  height: "72px",
  borderRadius: "16px",
  overflow: "hidden",
  background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
};

const nowPlayingCoverImgStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const nowPlayingCopyStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: "4px",
};

const nowPlayingLabelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-accent-strong)",
};

const nowPlayingTitleStyle: CSSProperties = {
  minWidth: 0,
  fontSize: "16px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const queueListStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

function queueRowStyle(active: boolean, isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto",
    gap: "10px",
    alignItems: "center",
    padding: "12px 14px",
    borderRadius: "18px",
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)",
    background: active ? "var(--x-color-accent-soft)" : "var(--x-color-panel-strong)",
  };
}

const queuePlayButtonStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "56px auto minmax(0, 1fr)",
  gap: "12px",
  alignItems: "center",
  padding: 0,
  border: "none",
  background: "transparent",
  textAlign: "left",
  cursor: "pointer",
};

const queueCoverStyle: CSSProperties = {
  width: "56px",
  height: "56px",
  borderRadius: "14px",
  overflow: "hidden",
  background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
};

const queueCoverImgStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

function queueIndexStyle(active: boolean): CSSProperties {
  return {
    width: "28px",
    fontSize: "12px",
    fontWeight: 800,
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)",
  };
}

const queueTextStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: "3px",
};

function queueNameStyle(active: boolean): CSSProperties {
  return {
    fontSize: "15px",
    fontWeight: 800,
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

const queueSubStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const queueRemoveButtonStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--x-color-danger)",
  fontSize: "12px",
  fontWeight: 700,
  cursor: "pointer",
  justifySelf: "end",
};

const queueEmptyStyle: CSSProperties = {
  minHeight: "240px",
  display: "grid",
  placeItems: "center",
  textAlign: "center",
  padding: "18px",
  borderRadius: "18px",
  border: "1px dashed var(--x-color-line)",
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.7,
  background: "var(--x-color-panel-alt)",
};
