import { useEffect, useRef } from "react";

import { useUserState } from "../../app/UserState";
import { API_BASE, IS_APK } from "../../js/apiBase";
import { fetchAlbums, fetchMusicList } from "./api";
import { useMusicPlayback } from "./MusicPlaybackContext";
import { resolveTrackAlbumName, resolveTrackCoverUrl } from "./musicCoverUtils";
import { NativeMusic } from "./nativeMusicPlugin";
import type { MusicRecord } from "./types";

export function ApkMusicRuntime() {
  const { isAuthenticated, loadingUser } = useUserState();
  const {
    albums,
    currentMusic,
    currentMusicId,
    isPlaying,
    libraryMusics,
    orderedQueue,
    hasPlaybackSession,
    repeatMode,
    autoplayKey,
    handleTrackEnded,
    setAlbums,
    setCurrentMusicId,
    setIsPlayingState,
    setLibraryMusics,
  } = useMusicPlayback();

  // Keep latest callbacks in a ref so event listeners never hold stale closures.
  const callbacksRef = useRef({
    handleTrackEnded,
    setCurrentMusicId,
    setIsPlayingState,
    isPlaying,
  });
  useEffect(() => {
    callbacksRef.current = { handleTrackEnded, setCurrentMusicId, setIsPlayingState, isPlaying };
  }, [handleTrackEnded, setCurrentMusicId, setIsPlayingState, isPlaying]);

  // Refs to avoid stale closure issues inside effects.
  const orderedQueueRef = useRef<MusicRecord[]>([]);
  const currentMusicIdRef = useRef<number | null>(null);
  const repeatModeRef = useRef(repeatMode);
  useEffect(() => { orderedQueueRef.current = orderedQueue; }, [orderedQueue]);
  useEffect(() => { currentMusicIdRef.current = currentMusicId; }, [currentMusicId]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);

  // Refs for session tracking.
  const lastSentAutoplayKeyRef = useRef(0);
  const hasSeenPlaybackSessionRef = useRef(false);
  const loadedLibraryForSessionRef = useRef(false);

  // ── One-time: wire native event listeners ──────────────────────────────────
  useEffect(() => {
    if (!IS_APK) return;

    void NativeMusic.ready().catch((e) => console.error("NativeMusic.ready failed", e));

    let active = true;
    const handles: Array<{ remove: () => Promise<void> | void }> = [];

    void (async () => {
      try {
        const registered = await Promise.all([
          // trackChanged: native auto-advanced or user pressed prev/next in notification.
          // Update JS current music WITHOUT calling selectMusic, so autoplayKey
          // does not change and we do not re-send the playlist back to native.
          NativeMusic.addListener("trackChanged", ({ id }) => {
            if (!active) return;
            callbacksRef.current.setCurrentMusicId(id);
          }),

          // trackEnded: whole playlist finished (repeat=off).
          NativeMusic.addListener("trackEnded", () => {
            if (!active) return;
            callbacksRef.current.handleTrackEnded();
          }),

          // playStateChanged: native paused/resumed (e.g. audio focus loss, headphone unplug).
          NativeMusic.addListener("playStateChanged", ({ isPlaying }) => {
            if (!active) return;
            callbacksRef.current.setIsPlayingState(isPlaying);
          }),
        ]);

        if (!active) {
          await Promise.all(registered.map((h) => h.remove()));
          return;
        }
        handles.push(...registered);
      } catch (e) {
        console.error("NativeMusic listener setup failed", e);
      }
    })();

    return () => {
      active = false;
      void Promise.all(handles.map((h) => h.remove()));
    };
  }, []);

  // ── Send full playlist to native when user explicitly starts playback ───────
  //
  // This is the KEY change: instead of calling play() for one track and relying
  // on JS to handle trackEnded → next, we load the ENTIRE ordered queue into
  // ExoPlayer.  ExoPlayer then auto-advances, handles notification controls,
  // and fires trackChanged events back to JS for UI sync.
  //
  // Fires when autoplayKey bumps (user picked a track) or repeatMode changes.
  useEffect(() => {
    if (!IS_APK || !currentMusic || autoplayKey <= 0) return;
    if (autoplayKey === lastSentAutoplayKeyRef.current) return;

    lastSentAutoplayKeyRef.current = autoplayKey;

    const queue = orderedQueueRef.current;
    const curId = currentMusicIdRef.current;
    const tracks = queue.length > 0 ? queue : [currentMusic];
    const startIndex = Math.max(0, tracks.findIndex((m) => m.id === curId));

    void NativeMusic.ready()
      .then(() =>
        NativeMusic.setPlaylist({
          tracks: tracks.map((m) => ({
            id: m.id,
            url: `${API_BASE}/api/music/download/${m.id}`,
            title: m.title,
            album: resolveTrackAlbumName(m.id, libraryMusics, albums),
            coverUrl: resolveTrackCoverUrl(m.id, libraryMusics, albums),
          })),
          startIndex,
          repeatMode: repeatModeRef.current,
        }),
      )
      .then(() => callbacksRef.current.setIsPlayingState(true))
      .catch((e) => {
        callbacksRef.current.setIsPlayingState(false);
        console.error("NativeMusic.setPlaylist failed", e);
      });
  }, [albums, autoplayKey, currentMusic, libraryMusics]);

  // ── Sync repeat mode change to running native player ───────────────────────
  useEffect(() => {
    if (!IS_APK || !hasPlaybackSession) return;
    void NativeMusic.setRepeat({ mode: repeatMode }).catch(() => {});
  }, [repeatMode, hasPlaybackSession]);

  // ── On screen unlock, sync isPlaying state ────────────────────────────────
  //
  // If a trackChanged event was queued while JS was suspended, it will fire
  // automatically when the WebView resumes.  This handler just keeps isPlaying
  // in sync so the UI shows the correct state on resume.
  useEffect(() => {
    if (!IS_APK) return;

    function onVisible() {
      if (document.visibilityState !== "visible") return;
      void NativeMusic.getProgress()
        .then(({ isPlaying: native }) => {
          callbacksRef.current.setIsPlayingState(native);
        })
        .catch(() => {});
    }

    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // ── Stop native service when session is dismissed ─────────────────────────
  useEffect(() => {
    if (!IS_APK) return;
    if (hasPlaybackSession && currentMusic) { hasSeenPlaybackSessionRef.current = true; return; }
    if (!hasSeenPlaybackSessionRef.current) return;
    void NativeMusic.stop().catch((e) => console.error("NativeMusic.stop failed", e));
  }, [currentMusic, hasPlaybackSession]);

  // ── Load music library once after login ───────────────────────────────────
  useEffect(() => {
    if (!IS_APK || loadingUser || !isAuthenticated || loadedLibraryForSessionRef.current) return;
    let cancelled = false;
    void Promise.all([fetchMusicList(), fetchAlbums()])
      .then(([{ musics }, albumList]) => {
        if (!cancelled) {
          setLibraryMusics(musics);
          setAlbums(albumList);
          loadedLibraryForSessionRef.current = true;
        }
      })
      .catch((e) => { if (!cancelled) console.error("APK music library bootstrap failed", e); });
    return () => { cancelled = true; };
  }, [isAuthenticated, loadingUser, setAlbums, setLibraryMusics]);

  useEffect(() => {
    if (!IS_APK || loadingUser) return;
    if (!isAuthenticated) loadedLibraryForSessionRef.current = false;
  }, [isAuthenticated, loadingUser]);

  return null;
}
