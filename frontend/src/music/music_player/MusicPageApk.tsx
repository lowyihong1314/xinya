import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { hasUserPermission } from "../../app/permissions";
import { useUserState } from "../../app/UserState";
import { CachedImage } from "../../components/CachedMedia";
import { fetchAlbums, fetchMinuteLogs, fetchMusicList } from "./api";
import {
  AlbumCard,
  AlbumHero,
  AlbumListRow,
  AllSongsCard,
  AllSongsHero,
  TrackRow,
} from "./ApkAlbumComponents";
import { FullPlayer } from "./ApkFullPlayer";
import {
  groupMinuteLogsIntoSessions,
} from "./listeningActivity";
import { ListeningActivityChart } from "./ListeningActivityChart";
import { useMusicPlayback } from "./MusicPlaybackContext";
import { resolveTrackAlbumName, resolveTrackCoverUrl } from "./musicCoverUtils";
import { NativeMusic } from "./nativeMusicPlugin";
import type { AlbumRecord, MinuteLogRecord, MusicRecord } from "./types";

type ApkScreen = "albums" | "tracks";

// ─── Main page ───────────────────────────────────────────────────────────────

export function MusicPageApk() {
  const { user, loadingUser } = useUserState();
  const {
    albums,
    libraryMusics,
    currentMusic,
    isPlaying,
    hasPlaybackSession,
    shuffleEnabled,
    repeatMode,
    autoplayKey,
    queue,
    selectMusic,
    setQueue,
    playRelative,
    toggleShuffle,
    cycleRepeatMode,
    appendToQueue,
    removeFromQueue,
    clearQueue,
    playFromQueue,
    setAlbums,
    setIsPlayingState,
    setLibraryMusics,
  } = useMusicPlayback();

  const [screen, setScreen] = useState<ApkScreen>("albums");
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumRecord | null>(null);
  const [showAllSongs, setShowAllSongs] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listeningLoading, setListeningLoading] = useState(false);
  const [minuteLogs, setMinuteLogs] = useState<MinuteLogRecord[]>([]);
  const [listeningTimezone, setListeningTimezone] = useState("Asia/Kuala_Lumpur");
  const [showFullPlayer, setShowFullPlayer] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const savedScrollRef = useRef(0);
  const pendingScrollRestoreRef = useRef(false);
  const shouldInspectNative = hasPlaybackSession || autoplayKey > 0 || Boolean(currentMusic);
  const canViewListening = hasUserPermission(user, "music_edit");

  useEffect(() => {
    Promise.all([fetchAlbums(), fetchMusicList()])
      .then(([albumList, { musics }]) => {
        setAlbums(albumList);
        setLibraryMusics(musics);
      })
      .finally(() => setLoading(false));
  }, [setAlbums, setLibraryMusics]);

  useEffect(() => {
    if (loadingUser) return;
    if (!canViewListening) {
      setMinuteLogs([]);
      setListeningLoading(false);
      return;
    }

    let cancelled = false;
    setListeningLoading(true);

    void fetchMinuteLogs({ perPage: 240 })
      .then((payload) => {
        if (cancelled) return;
        setMinuteLogs(payload.items || []);
        setListeningTimezone(payload.timezone || "Asia/Kuala_Lumpur");
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("APK minute logs bootstrap failed", error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setListeningLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canViewListening, loadingUser]);

  useEffect(() => {
    if (currentMusic) { setDuration(currentMusic.duration ?? 0); return; }
    setProgress(0); setDuration(0);
  }, [currentMusic]);

  useEffect(() => {
    if (!shouldInspectNative) { setProgress(0); setDuration(0); return; }
    async function syncProgress() {
      try {
        const { positionMs, durationMs, isPlaying: nativePlaying } = await NativeMusic.getProgress();
        setProgress(positionMs / 1000);
        setDuration(durationMs > 0 ? durationMs / 1000 : currentMusic?.duration ?? 0);
        setIsPlayingState(nativePlaying);
      } catch (error) { console.error("NativeMusic.getProgress failed", error); }
    }
    void syncProgress();
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    if (!isPlaying) return;
    progressIntervalRef.current = setInterval(() => void syncProgress(), 500);
    return () => { if (progressIntervalRef.current) clearInterval(progressIntervalRef.current); };
  }, [autoplayKey, currentMusic, isPlaying, setIsPlayingState, shouldInspectNative]);

  useEffect(() => { setProgress(0); setDuration(0); }, [autoplayKey]);

  // Restore scroll position after returning to albums screen
  useLayoutEffect(() => {
    if (screen === "albums" && pendingScrollRestoreRef.current) {
      pendingScrollRestoreRef.current = false;
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = savedScrollRef.current;
      }
    }
  });

  function openAlbum(album: AlbumRecord | null) {
    savedScrollRef.current = scrollContainerRef.current?.scrollTop ?? 0;
    setSelectedAlbum(album);
    setShowAllSongs(album == null);
    setScreen("tracks");
  }

  function goBack() {
    pendingScrollRestoreRef.current = true;
    setScreen("albums");
  }

  const allMusics = libraryMusics;
  const allMusicsSorted = useMemo(
    () => [...allMusics].sort((a, b) => (b.play_minutes ?? 0) - (a.play_minutes ?? 0)),
    [allMusics],
  );
  const albumTracks = showAllSongs
    ? allMusicsSorted
    : selectedAlbum
      ? allMusics.filter((m) => m.album_id === selectedAlbum.id)
      : [];
  const listeningSessions = useMemo(
    () => groupMinuteLogsIntoSessions(minuteLogs),
    [minuteLogs],
  );
  const totalAlbumMinutes = useMemo(
    () =>
      albums.reduce(
        (sum, album) => sum + Number(album.album_total_minutes ?? 0),
        0,
      ),
    [albums],
  );
  const albumNameByMusicId = useMemo(() => {
    const albumById = new Map(albums.map((album) => [album.id, album.name]));
    return new Map(
      allMusics.map((music) => [music.id, music.album_id != null ? (albumById.get(music.album_id) ?? "") : ""]),
    );
  }, [allMusics, albums]);

  const lq = searchQuery.trim().toLowerCase();
  const hasSearch = lq.length > 0;
  const searchAlbums = hasSearch ? albums.filter((a) => a.name.toLowerCase().includes(lq)) : [];
  const searchTracks = hasSearch
    ? allMusics.filter((m) => {
        const albumName = albumNameByMusicId.get(m.id)?.toLowerCase() ?? "";
        return m.title.toLowerCase().includes(lq) || albumName.includes(lq);
      })
    : [];

  return (
    <div style={pageStyle}>
      {/* Header */}
      <div style={headerStyle}>
        {screen === "tracks" ? (
          <button style={iconBtnStyle} onClick={goBack}>
            <i className="fas fa-chevron-left" />
          </button>
        ) : (
          <div style={{ width: 44 }} />
        )}
        <span style={headerTitleStyle} title={screen === "tracks" ? (selectedAlbum?.name ?? "") : ""}>
          {screen === "tracks" ? (showAllSongs ? "全部歌曲" : selectedAlbum?.name ?? "专辑") : "音乐"}
        </span>
        <div style={{ width: 44 }} />
      </div>

      {/* Search bar — albums screen only */}
      {screen === "albums" && (
        <div style={searchBarWrapStyle}>
          <i className="fas fa-magnifying-glass" style={searchIconStyle} />
          <input
            type="search"
            placeholder="搜索歌曲、专辑…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={searchInputStyle}
          />
          {searchQuery ? (
            <button style={searchClearBtnStyle} onClick={() => setSearchQuery("")}>
              <i className="fas fa-xmark-circle" />
            </button>
          ) : null}
        </div>
      )}

      {/* Scrollable content */}
      <div ref={scrollContainerRef} style={contentStyle(hasPlaybackSession)}>
        {loading ? (
          <div style={emptyStyle}>加载中…</div>

        ) : screen === "tracks" ? (
          albumTracks.length === 0 ? (
            <div style={emptyStyle}>{showAllSongs ? "当前列表暂无歌曲" : "此专辑暂无歌曲"}</div>
          ) : (
            <>
              {showAllSongs ? (
                <AllSongsHero
                  trackCount={albumTracks.length}
                  totalMinutes={totalAlbumMinutes}
                />
              ) : (
                <AlbumHero album={selectedAlbum!} trackCount={albumTracks.length} />
              )}
              <div style={trackListStyle}>
                {albumTracks.map((track, index) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    index={index + 1}
                    isActive={currentMusic?.id === track.id}
                    isPlaying={isPlaying && currentMusic?.id === track.id}
                    inQueue={queue.some((q) => q.id === track.id)}
                    showAlbum={showAllSongs}
                    albumName={albumNameByMusicId.get(track.id) ?? "全部歌曲"}
                    onSelect={() => handleSelectTrack(track, albumTracks, setQueue, selectMusic, setDuration)}
                    onAddToQueue={() => appendToQueue(track.id)}
                  />
                ))}
              </div>
            </>
          )

        ) : hasSearch ? (
          /* Search results */
          searchAlbums.length === 0 && searchTracks.length === 0 ? (
            <div style={emptyStyle}>没有找到「{searchQuery}」相关内容</div>
          ) : (
            <div style={searchResultsStyle}>
              {searchAlbums.length > 0 && (
                <>
                  <div style={sectionHeaderStyle}>
                    <span style={sectionHeaderTitleStyle}>专辑</span>
                    <span style={sectionHeaderCountStyle}>{searchAlbums.length}</span>
                  </div>
                  {searchAlbums.map((album) => (
                    <AlbumListRow
                      key={album.id}
                      album={album}
                      trackCount={allMusics.filter((m) => m.album_id === album.id).length}
                      onSelect={() => { setSearchQuery(""); openAlbum(album); }}
                    />
                  ))}
                </>
              )}
              {searchTracks.length > 0 && (
                <>
                  <div style={{ ...sectionHeaderStyle, marginTop: searchAlbums.length > 0 ? 12 : 0 }}>
                    <span style={sectionHeaderTitleStyle}>歌曲</span>
                    <span style={sectionHeaderCountStyle}>{searchTracks.length}</span>
                  </div>
                  {searchTracks.map((track, index) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      index={index + 1}
                      isActive={currentMusic?.id === track.id}
                      isPlaying={isPlaying && currentMusic?.id === track.id}
                    inQueue={queue.some((q) => q.id === track.id)}
                    showAlbum
                    albumName={albumNameByMusicId.get(track.id) ?? ""}
                    onSelect={() => handleSelectTrack(track, searchTracks, setQueue, selectMusic, setDuration)}
                    onAddToQueue={() => appendToQueue(track.id)}
                  />
                  ))}
                </>
              )}
            </div>
          )

        ) : (
          /* Albums grid */
          albums.length === 0 && allMusics.length === 0 ? (
            <div style={emptyStyle}>暂无专辑</div>
          ) : (
            <>
              {canViewListening ? (
                <div style={listeningChartWrapStyle}>
                  <ListeningActivityChart
                    isMobile
                    title="最近听歌记录"
                    subtitle="默认收起，展开后按歌曲总分钟看 bar chart；点到 bar 时会显示谁听了几分钟。"
                    timezone={listeningTimezone}
                    loading={listeningLoading}
                    sessions={listeningSessions}
                    emptyText="暂时还没有可显示的收听记录。"
                  />
                </div>
              ) : null}
              <div style={albumGridStyle}>
                <AllSongsCard
                  trackCount={allMusics.length}
                  totalMinutes={totalAlbumMinutes}
                  onSelect={() => openAlbum(null)}
                />
                {albums.map((album) => (
                  <AlbumCard
                    key={album.id}
                    album={album}
                    trackCount={allMusics.filter((m) => m.album_id === album.id).length}
                    onSelect={() => openAlbum(album)}
                  />
                ))}
              </div>
            </>
          )
        )}
      </div>

      {/* Mini player bar */}
      {hasPlaybackSession && currentMusic && (
        <button style={miniBarStyle} onClick={() => setShowFullPlayer(true)}>
          <div style={miniArtStyle}>
            <CachedImage
              src={resolveTrackCoverUrl(currentMusic.id, allMusics, albums)}
              cacheKey={`music-cover:apk-page:${currentMusic.id}`}
              alt={currentMusic.title}
              style={miniArtImgStyle}
            />
          </div>
          <div style={miniInfoStyle}>
            <span style={miniTitleStyle}>{currentMusic.title}</span>
            <span style={miniSubStyle}>{resolveTrackAlbumName(currentMusic.id, allMusics, albums) || "全部歌曲"}</span>
          </div>
          <div style={miniControlsStyle} onClick={(e) => e.stopPropagation()}>
            <button style={miniIconBtnStyle} onClick={() => playRelative(-1)}>
              <i className="fas fa-backward-step" />
            </button>
            <button style={miniPlayBtnStyle} onClick={() => void handleTogglePlay(isPlaying, currentMusic, setIsPlayingState, selectMusic)}>
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
          onTogglePlay={() => void handleTogglePlay(isPlaying, currentMusic, setIsPlayingState, selectMusic)}
          onToggleShuffle={toggleShuffle}
          onCycleRepeat={cycleRepeatMode}
          onSeek={(t) => void handleSeek(t, setProgress)}
          onPlayFromQueue={playFromQueue}
          onRemoveFromQueue={removeFromQueue}
          onClearQueue={clearQueue}
        />
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function handleTogglePlay(
  isPlaying: boolean,
  currentMusic: MusicRecord | null,
  setIsPlayingState: (playing: boolean) => void,
  selectMusic?: (musicId: number) => void,
) {
  try {
    if (isPlaying) { await NativeMusic.pause(); setIsPlayingState(false); return; }
    if (!currentMusic) return;
    const { durationMs } = await NativeMusic.getProgress().catch(() => ({ positionMs: 0, durationMs: 0, isPlaying: false }));
    if (durationMs > 0) {
      // Native player is paused — just resume.
      await NativeMusic.resume();
      setIsPlayingState(true);
    } else if (selectMusic) {
      // No active native session (cold start or after stop).
      // Delegate to ApkMusicRuntime which loads the full queue and sets
      // isPlaying only after ExoPlayer confirms it started — no race condition.
      selectMusic(currentMusic.id);
    }
  } catch (error) { console.error("NativeMusic toggle failed", error); }
}

async function handleSeek(nextTime: number, setProgress: (value: number) => void) {
  try {
    await NativeMusic.seekTo({ positionMs: Math.max(nextTime, 0) * 1000 });
    setProgress(nextTime);
  } catch (error) { console.error("NativeMusic.seekTo failed", error); }
}

function handleSelectTrack(
  track: MusicRecord,
  tracks: MusicRecord[],
  setQueue: (musics: MusicRecord[]) => void,
  selectMusic: (musicId: number) => void,
  setDuration: (value: number) => void,
) {
  setQueue(tracks);
  selectMusic(track.id);
  setDuration(track.duration ?? 0);
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const pageStyle: CSSProperties = {
  display: "flex", flexDirection: "column",
  height: "calc(100vh - 60px)",
  background: "var(--x-color-canvas)",
  overflow: "hidden", maxWidth: "100vw",
};

const headerStyle: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "10px 8px 6px", flexShrink: 0,
};

const iconBtnStyle: CSSProperties = {
  width: 44, height: 44, flexShrink: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
  border: "none", background: "transparent",
  fontSize: 18, color: "var(--x-color-ink)", cursor: "pointer", borderRadius: 12,
};

const headerTitleStyle: CSSProperties = {
  fontSize: 17, fontWeight: 700, color: "var(--x-color-ink)",
  flex: 1, textAlign: "center", minWidth: 0,
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  padding: "0 4px",
};

const searchBarWrapStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  margin: "0 14px 10px",
  padding: "0 12px",
  background: "var(--x-color-input-bg, rgba(120,120,128,0.12))",
  borderRadius: 12, flexShrink: 0, height: 38,
};

const searchIconStyle: CSSProperties = {
  fontSize: 13, color: "var(--x-color-ink-muted)", flexShrink: 0,
};

const searchInputStyle: CSSProperties = {
  flex: 1, border: "none", background: "transparent", outline: "none",
  fontSize: 14, color: "var(--x-color-ink)", minWidth: 0,
};

const searchClearBtnStyle: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center",
  border: "none", background: "transparent", cursor: "pointer", padding: 0, flexShrink: 0,
  fontSize: 16, color: "var(--x-color-ink-muted)",
};

function contentStyle(hasMiniPlayer: boolean): CSSProperties {
  return { flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: hasMiniPlayer ? 0 : 16 };
}

const emptyStyle: CSSProperties = {
  padding: "48px 24px", textAlign: "center",
  color: "var(--x-color-ink-muted)", fontSize: 15,
};

const albumGridStyle: CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(2, 1fr)",
  gap: 14, padding: "4px 14px 16px",
};

const trackListStyle: CSSProperties = { display: "flex", flexDirection: "column" };

const searchResultsStyle: CSSProperties = { padding: "4px 0 16px" };

const listeningChartWrapStyle: CSSProperties = {
  padding: "6px 14px 16px",
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "6px 14px 4px",
};

const sectionHeaderTitleStyle: CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "var(--x-color-ink-muted)",
  textTransform: "uppercase", letterSpacing: "0.08em",
};

const sectionHeaderCountStyle: CSSProperties = {
  fontSize: 11, color: "var(--x-color-ink-muted)",
  background: "var(--x-color-input-bg, rgba(120,120,128,0.12))",
  borderRadius: 99, padding: "1px 6px",
};

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
  flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0, textAlign: "left",
};

const miniTitleStyle: CSSProperties = {
  fontSize: 13, fontWeight: 600, color: "white",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const miniSubStyle: CSSProperties = {
  fontSize: 11, color: "rgba(255,255,255,0.7)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const miniControlsStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 2, flexShrink: 0 };

const miniIconBtnStyle: CSSProperties = {
  width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
  border: "none", background: "transparent", color: "rgba(255,255,255,0.85)", fontSize: 15, cursor: "pointer", borderRadius: 8,
};

const miniPlayBtnStyle: CSSProperties = {
  ...miniIconBtnStyle, width: 38, height: 38,
  background: "rgba(255,255,255,0.2)", color: "white", borderRadius: 19, fontSize: 16,
};
