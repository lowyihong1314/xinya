import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { API_BASE } from "../../js/apiBase";
import { fetchAlbums, fetchMusicList } from "./api";
import { useMusicPlayback } from "./MusicPlaybackContext";
import { NativeMusic } from "./nativeMusicPlugin";
import type { AlbumRecord, MusicRecord } from "./types";

type ApkScreen = "albums" | "tracks";

// ─── Main page ─────────────────────────────────────────────────────────────

export function MusicPageApk() {
  const {
    currentMusic,
    isPlaying,
    hasPlaybackSession,
    shuffleEnabled,
    repeatMode,
    autoplayKey,
    queue,
    selectMusic,
    setQueue,
    setLibraryMusics,
    playRelative,
    handleTrackEnded,
    toggleShuffle,
    cycleRepeatMode,
    appendToQueue,
    removeFromQueue,
    clearQueue,
    playFromQueue,
    setIsPlayingState,
  } = useMusicPlayback();

  const [screen, setScreen] = useState<ApkScreen>("albums");
  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [allMusics, setAllMusics] = useState<MusicRecord[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFullPlayer, setShowFullPlayer] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastNativeAutoplayKeyRef = useRef(0);
  const hasSeenPlaybackSessionRef = useRef(false);

  useEffect(() => {
    Promise.all([fetchAlbums(), fetchMusicList()])
      .then(([albumList, { musics }]) => {
        setAlbums(albumList);
        setAllMusics(musics);
        setLibraryMusics(musics);
      })
      .finally(() => setLoading(false));
  }, [setLibraryMusics]);

  useEffect(() => {
    void NativeMusic.ready().catch((error) => {
      console.error("NativeMusic.ready failed", error);
    });
  }, []);

  useEffect(() => {
    let active = true;
    const handles: Array<{ remove: () => Promise<void> | void }> = [];

    void (async () => {
      try {
        const nextHandles = await Promise.all([
          NativeMusic.addListener("trackEnded", () => handleTrackEnded()),
          NativeMusic.addListener("next", () => playRelative(1)),
          NativeMusic.addListener("prev", () => playRelative(-1)),
          NativeMusic.addListener("playStateChanged", ({ isPlaying: nextPlaying }) => {
            setIsPlayingState(nextPlaying);
          }),
        ]);

        if (!active) {
          await Promise.all(nextHandles.map((handle) => handle.remove()));
          return;
        }

        handles.push(...nextHandles);
      } catch (error) {
        console.error("NativeMusic listener setup failed", error);
      }
    })();

    return () => {
      active = false;
      void Promise.all(handles.map((handle) => handle.remove()));
    };
  }, [handleTrackEnded, playRelative, setIsPlayingState]);

  useEffect(() => {
    if (!currentMusic || autoplayKey <= 0 || autoplayKey === lastNativeAutoplayKeyRef.current) {
      return;
    }

    lastNativeAutoplayKeyRef.current = autoplayKey;

    void NativeMusic.play({
      url: `${API_BASE}/api/music/download/${currentMusic.id}`,
      title: currentMusic.title,
      album: currentMusic.album?.name ?? "",
      coverUrl: resolveAssetUrl(currentMusic.cover_url),
    })
      .then(() => {
        setIsPlayingState(true);
        setDuration(currentMusic.duration ?? 0);
      })
      .catch((error) => {
        console.error("NativeMusic.play failed", error);
      });
  }, [autoplayKey, currentMusic, setIsPlayingState]);

  useEffect(() => {
    if (hasPlaybackSession && currentMusic) {
      hasSeenPlaybackSessionRef.current = true;
      return;
    }

    if (!hasSeenPlaybackSessionRef.current) {
      return;
    }

    setProgress(0);
    setDuration(0);
    void NativeMusic.stop().catch(() => undefined);
  }, [currentMusic, hasPlaybackSession]);

  useEffect(() => {
    async function syncProgress() {
      try {
        const { positionMs, durationMs, isPlaying: nativePlaying } = await NativeMusic.getProgress();
        setProgress(positionMs / 1000);
        setDuration(durationMs > 0 ? durationMs / 1000 : 0);
        setIsPlayingState(nativePlaying);
      } catch (error) {
        console.error("NativeMusic.getProgress failed", error);
      }
    }

    void syncProgress();

    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    if (!isPlaying) return;
    progressIntervalRef.current = setInterval(() => {
      void syncProgress();
    }, 500);
    return () => { if (progressIntervalRef.current) clearInterval(progressIntervalRef.current); };
  }, [autoplayKey, currentMusic, isPlaying, setIsPlayingState]);

  useEffect(() => { setProgress(0); setDuration(0); }, [autoplayKey]);

  const albumTracks = selectedAlbum
    ? allMusics.filter((m) => m.album_id === selectedAlbum.id)
    : [];

  return (
    <div style={pageStyle}>
      {/* Header */}
      <div style={headerStyle}>
        {screen === "tracks" ? (
          <button style={iconBtnBaseStyle} onClick={() => setScreen("albums")}>
            <i className="fas fa-chevron-left" />
          </button>
        ) : (
          <div style={{ width: 40 }} />
        )}
        <span style={headerTitleStyle} title={screen === "tracks" ? (selectedAlbum?.name ?? "") : ""}>
          {screen === "tracks" ? (selectedAlbum?.name ?? "专辑") : "音乐"}
        </span>
        <div style={{ width: 40 }} />
      </div>

      {/* Scrollable content */}
      <div style={contentStyle(hasPlaybackSession)}>
        {loading ? (
          <div style={emptyStyle}>加载中…</div>
        ) : screen === "albums" ? (
          albums.length === 0 ? (
            <div style={emptyStyle}>暂无专辑</div>
          ) : (
            <div style={albumGridStyle}>
              {albums.map((album) => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  trackCount={allMusics.filter((m) => m.album_id === album.id).length}
                  onSelect={() => { setSelectedAlbum(album); setScreen("tracks"); }}
                />
              ))}
            </div>
          )
        ) : albumTracks.length === 0 ? (
          <div style={emptyStyle}>此专辑暂无歌曲</div>
        ) : (
          <div style={trackListStyle}>
            {albumTracks.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                index={index + 1}
                isActive={currentMusic?.id === track.id}
                isPlaying={isPlaying && currentMusic?.id === track.id}
                inQueue={queue.some((q) => q.id === track.id)}
                onSelect={() => { setQueue(albumTracks); selectMusic(track.id); }}
                onAddToQueue={() => appendToQueue(track.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Mini player bar */}
      {hasPlaybackSession && currentMusic && (
        <button style={miniBarStyle} onClick={() => setShowFullPlayer(true)}>
          <div style={miniArtStyle}>
            {currentMusic.cover_url ? (
              <img src={resolveAssetUrl(currentMusic.cover_url)} alt={currentMusic.title} style={miniArtImgStyle} />
            ) : (
              <i className="fas fa-music" style={{ color: "white", fontSize: 18 }} />
            )}
          </div>
          <div style={miniInfoStyle}>
            <span style={miniTitleStyle}>{currentMusic.title}</span>
            <span style={miniSubStyle}>{currentMusic.album?.name ?? ""}</span>
          </div>
          <div style={miniControlsStyle} onClick={(e) => e.stopPropagation()}>
            <button style={miniIconBtnStyle} onClick={() => playRelative(-1)}>
              <i className="fas fa-backward-step" />
            </button>
            <button style={miniPlayBtnStyle} onClick={() => void handleTogglePlay(isPlaying, currentMusic, setIsPlayingState)}>
              <i className={isPlaying ? "fas fa-pause" : "fas fa-play"} />
            </button>
            <button style={miniIconBtnStyle} onClick={() => playRelative(1)}>
              <i className="fas fa-forward-step" />
            </button>
          </div>
        </button>
      )}

      {/* Full-screen player */}
      {showFullPlayer && currentMusic && (
        <FullPlayer
          music={currentMusic}
          isPlaying={isPlaying}
          progress={progress}
          duration={duration}
          shuffleEnabled={shuffleEnabled}
          repeatMode={repeatMode}
          queue={queue}
          currentMusicId={currentMusic.id}
          onClose={() => setShowFullPlayer(false)}
          onPrev={() => playRelative(-1)}
          onNext={() => playRelative(1)}
          onTogglePlay={() => void handleTogglePlay(isPlaying, currentMusic, setIsPlayingState)}
          onToggleShuffle={toggleShuffle}
          onCycleRepeat={cycleRepeatMode}
          onSeek={(t) => void handleSeek(t, setProgress)}
          onEnded={handleTrackEnded}
          onPlayFromQueue={playFromQueue}
          onRemoveFromQueue={removeFromQueue}
          onClearQueue={clearQueue}
        />
      )}
    </div>
  );
}

// ─── AlbumCard ──────────────────────────────────────────────────────────────

function AlbumCard({ album, trackCount, onSelect }: {
  album: AlbumRecord; trackCount: number; onSelect: () => void;
}) {
  return (
    <button style={albumCardStyle} onClick={onSelect}>
      <div style={albumCoverStyle}>
        {album.cover_url
          ? <img src={`${API_BASE}${album.cover_url}`} alt={album.name} style={albumCoverImgStyle} />
          : <i className="fas fa-music" style={{ fontSize: 28, color: "white", opacity: 0.7 }} />
        }
      </div>
      <div style={albumNameStyle}>{album.name}</div>
      <div style={albumCountStyle}>{trackCount} 首</div>
    </button>
  );
}

// ─── TrackRow ───────────────────────────────────────────────────────────────

function TrackRow({ track, index, isActive, isPlaying, inQueue, onSelect, onAddToQueue }: {
  track: MusicRecord; index: number; isActive: boolean; isPlaying: boolean;
  inQueue: boolean; onSelect: () => void; onAddToQueue: () => void;
}) {
  return (
    <div style={trackRowStyle(isActive)}>
      <button style={trackMainStyle} onClick={onSelect}>
        <div style={trackIndexStyle(isActive)}>
          {isActive && isPlaying
            ? <i className="fas fa-volume-high" style={{ fontSize: 12 }} />
            : <span>{index}</span>
          }
        </div>
        <div style={trackInfoStyle}>
          <span style={trackTitleStyle(isActive)}>{track.title}</span>
          {track.duration != null && <span style={trackDurStyle}>{formatTime(track.duration)}</span>}
        </div>
      </button>
      <button
        style={addQueueBtnStyle(inQueue)}
        onClick={onAddToQueue}
        title={inQueue ? "已在队列" : "添加到队列"}
      >
        <i className={inQueue ? "fas fa-check" : "fas fa-plus"} />
      </button>
    </div>
  );
}

// ─── FullPlayer ─────────────────────────────────────────────────────────────

function FullPlayer({
  music, isPlaying, progress, duration, shuffleEnabled, repeatMode,
  queue, currentMusicId, onClose, onPrev, onNext, onTogglePlay,
  onToggleShuffle, onCycleRepeat, onSeek, onEnded,
  onPlayFromQueue, onRemoveFromQueue, onClearQueue,
}: {
  music: MusicRecord; isPlaying: boolean; progress: number; duration: number;
  shuffleEnabled: boolean; repeatMode: "off" | "all" | "one";
  queue: MusicRecord[]; currentMusicId: number;
  onClose: () => void; onPrev: () => void; onNext: () => void;
  onTogglePlay: () => void; onToggleShuffle: () => void; onCycleRepeat: () => void;
  onSeek: (t: number) => void; onEnded: () => void;
  onPlayFromQueue: (id: number) => void; onRemoveFromQueue: (id: number) => void;
  onClearQueue: () => void;
}) {
  void onEnded;
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
        /* ── Queue panel ── */
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
        /* ── Player panel ── */
        <div style={playerPanelStyle}>
          {/* Cover */}
          <div style={fullCoverStyle}>
            {music.cover_url
              ? <img src={`${API_BASE}${music.cover_url}`} alt={music.title} style={fullCoverImgStyle} />
              : <div style={fullCoverPlaceholderStyle}><i className="fas fa-music" style={{ fontSize: 56, color: "white", opacity: 0.5 }} /></div>
            }
          </div>

          {/* Meta */}
          <div style={fullMetaStyle}>
            <div style={fullTitleStyle}>{music.title}</div>
            <div style={fullAlbumStyle}>{music.album?.name ?? ""}</div>
          </div>

          {/* Progress */}
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

          {/* Transport */}
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(s: number): string {
  if (!s || !isFinite(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function resolveAssetUrl(path?: string | null) {
  if (!path) {
    return "";
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${API_BASE}${path}`;
}

async function handleTogglePlay(
  isPlaying: boolean,
  currentMusic: MusicRecord | null,
  setIsPlayingState: (playing: boolean) => void,
) {
  try {
    if (isPlaying) {
      await NativeMusic.pause();
      setIsPlayingState(false);
      return;
    }

    if (!currentMusic) {
      return;
    }

    await NativeMusic.resume();
    setIsPlayingState(true);
  } catch (error) {
    console.error("NativeMusic toggle failed", error);
  }
}

async function handleSeek(nextTime: number, setProgress: (value: number) => void) {
  try {
    await NativeMusic.seekTo({ positionMs: Math.max(nextTime, 0) * 1000 });
    setProgress(nextTime);
  } catch (error) {
    console.error("NativeMusic.seekTo failed", error);
  }
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const pageStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "calc(100vh - 60px)",
  background: "var(--x-color-canvas)",
  overflow: "hidden",
  maxWidth: "100vw",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 12px",
  flexShrink: 0,
  minWidth: 0,
};

const iconBtnBaseStyle: CSSProperties = {
  width: 40, height: 40, flexShrink: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
  border: "none", background: "transparent",
  fontSize: 18, color: "var(--x-color-ink)", cursor: "pointer", borderRadius: 10,
};

const headerTitleStyle: CSSProperties = {
  fontSize: 17, fontWeight: 700, color: "var(--x-color-ink)",
  flex: 1, textAlign: "center", minWidth: 0,
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  padding: "0 4px",
};

function contentStyle(hasMiniPlayer: boolean): CSSProperties {
  return { flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: hasMiniPlayer ? 0 : 16 };
}

const emptyStyle: CSSProperties = {
  padding: "48px 24px", textAlign: "center",
  color: "var(--x-color-ink-muted)", fontSize: 15,
};

// Album grid
const albumGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: 12,
  padding: "4px 14px 16px",
};

const albumCardStyle: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 6,
  border: "none", background: "transparent",
  padding: 0, cursor: "pointer", textAlign: "left", minWidth: 0,
};

const albumCoverStyle: CSSProperties = {
  width: "100%", aspectRatio: "1", borderRadius: 14,
  background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
  display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
};

const albumCoverImgStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

const albumNameStyle: CSSProperties = {
  fontSize: 13, fontWeight: 600, color: "var(--x-color-ink)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const albumCountStyle: CSSProperties = { fontSize: 12, color: "var(--x-color-ink-muted)" };

// Track list
const trackListStyle: CSSProperties = { display: "flex", flexDirection: "column" };

function trackRowStyle(active: boolean): CSSProperties {
  return {
    display: "flex", alignItems: "center",
    background: active ? "rgba(15,118,110,0.07)" : "transparent",
    borderBottom: "1px solid rgba(0,0,0,0.05)",
  };
}

const trackMainStyle: CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", gap: 10,
  padding: "11px 0 11px 14px",
  border: "none", background: "transparent", cursor: "pointer", textAlign: "left", minWidth: 0,
};

function trackIndexStyle(active: boolean): CSSProperties {
  return {
    width: 24, flexShrink: 0, textAlign: "center", fontSize: 12,
    color: active ? "var(--x-color-accent-strong, #0f766e)" : "var(--x-color-ink-muted)",
  };
}

const trackInfoStyle: CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: 8, minWidth: 0,
};

function trackTitleStyle(active: boolean): CSSProperties {
  return {
    fontSize: 14, fontWeight: active ? 600 : 400,
    color: active ? "var(--x-color-accent-strong, #0f766e)" : "var(--x-color-ink)",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  };
}

const trackDurStyle: CSSProperties = {
  fontSize: 12, color: "var(--x-color-ink-muted)", flexShrink: 0,
};

function addQueueBtnStyle(inQueue: boolean): CSSProperties {
  return {
    width: 36, height: 36, flexShrink: 0, marginRight: 8,
    display: "flex", alignItems: "center", justifyContent: "center",
    border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13,
    background: inQueue ? "rgba(15,118,110,0.12)" : "transparent",
    color: inQueue ? "var(--x-color-accent-strong, #0f766e)" : "var(--x-color-ink-muted)",
  };
}

// Mini player bar
const miniBarStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "9px 10px",
  background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
  border: "none", cursor: "pointer", flexShrink: 0, width: "100%", boxSizing: "border-box",
};

const miniArtStyle: CSSProperties = {
  width: 42, height: 42, flexShrink: 0, borderRadius: 9,
  background: "rgba(255,255,255,0.2)",
  display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
};

const miniArtImgStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

const miniInfoStyle: CSSProperties = {
  flex: 1, display: "flex", flexDirection: "column", gap: 2,
  minWidth: 0, textAlign: "left",
};

const miniTitleStyle: CSSProperties = {
  fontSize: 13, fontWeight: 600, color: "white",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const miniSubStyle: CSSProperties = {
  fontSize: 11, color: "rgba(255,255,255,0.7)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const miniControlsStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 2, flexShrink: 0,
};

const miniIconBtnStyle: CSSProperties = {
  width: 34, height: 34,
  display: "flex", alignItems: "center", justifyContent: "center",
  border: "none", background: "transparent",
  color: "rgba(255,255,255,0.85)", fontSize: 15, cursor: "pointer", borderRadius: 8,
};

const miniPlayBtnStyle: CSSProperties = {
  ...miniIconBtnStyle,
  width: 38, height: 38,
  background: "rgba(255,255,255,0.2)", color: "white", borderRadius: 19, fontSize: 16,
};

// Full-screen player
const fullPlayerStyle: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 2000,
  background: "linear-gradient(180deg, var(--x-color-nav-start) 0%, #0a1628 100%)",
  display: "flex", flexDirection: "column",
  overflow: "hidden", maxWidth: "100vw",
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

// Player panel
const playerPanelStyle: CSSProperties = {
  flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
  padding: "16px 20px 24px", overflow: "hidden", minWidth: 0,
};

const fullCoverStyle: CSSProperties = {
  width: "min(240px, 72vw)", height: "min(240px, 72vw)", flexShrink: 0,
  borderRadius: 20, overflow: "hidden",
  boxShadow: "0 20px 56px rgba(0,0,0,0.55)",
  marginBottom: 24,
};

const fullCoverImgStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

const fullCoverPlaceholderStyle: CSSProperties = {
  width: "100%", height: "100%",
  background: "rgba(255,255,255,0.1)",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const fullMetaStyle: CSSProperties = {
  width: "100%", marginBottom: 20, minWidth: 0,
};

const fullTitleStyle: CSSProperties = {
  fontSize: 20, fontWeight: 700, color: "white", marginBottom: 4,
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const fullAlbumStyle: CSSProperties = {
  fontSize: 14, color: "rgba(255,255,255,0.6)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const fullProgressWrapStyle: CSSProperties = { width: "100%", marginBottom: 24, minWidth: 0 };

const rangeStyle: CSSProperties = {
  width: "100%", accentColor: "white", cursor: "pointer", display: "block",
};

const fullTimesStyle: CSSProperties = {
  display: "flex", justifyContent: "space-between",
  fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4,
};

const fullTransportStyle: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center",
  gap: 12, width: "100%",
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

// Queue panel
const queuePanelStyle: CSSProperties = {
  flex: 1, display: "flex", flexDirection: "column", overflow: "hidden",
};

const queueHeaderStyle: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "14px 16px 10px", flexShrink: 0,
};

const queueHeaderTextStyle: CSSProperties = {
  fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)",
};

const clearQueueBtnStyle: CSSProperties = {
  fontSize: 13, color: "rgba(255,255,255,0.5)",
  background: "transparent", border: "none", cursor: "pointer", padding: "4px 8px",
};

const queueListStyle: CSSProperties = { flex: 1, overflowY: "auto" };

const queueEmptyStyle: CSSProperties = {
  padding: "40px 24px", textAlign: "center",
  fontSize: 14, color: "rgba(255,255,255,0.4)",
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
  return {
    width: 22, flexShrink: 0, textAlign: "center", fontSize: 12,
    color: active ? "white" : "rgba(255,255,255,0.4)",
  };
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
