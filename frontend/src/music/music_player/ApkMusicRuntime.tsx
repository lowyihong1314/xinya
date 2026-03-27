import { useEffect, useRef } from "react";

import { useUserState } from "../../app/UserState";
import { API_BASE, IS_APK } from "../../js/apiBase";
import { fetchMusicList } from "./api";
import { useMusicPlayback } from "./MusicPlaybackContext";
import { NativeMusic } from "./nativeMusicPlugin";
import type { MusicRecord } from "./types";

export function ApkMusicRuntime() {
  const { isAuthenticated, loadingUser } = useUserState();
  const {
    currentMusic,
    currentMusicId,
    isPlaying,
    orderedQueue,
    hasPlaybackSession,
    repeatMode,
    autoplayKey,
    handleTrackEnded,
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
  // Flag to suppress setPlaylist when native itself changed the track.
  const nativeChangedTrackRef = useRef(false);

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
          // Update JS current music WITHOUT calling selectMusic (which would re-trigger setPlaylist).
          NativeMusic.addListener("trackChanged", ({ id }) => {
            if (!active) return;
            nativeChangedTrackRef.current = true;
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

    // If native itself triggered the track change (via trackChanged event), the
    // nativeChangedTrackRef will be true.  Skip re-sending the playlist in that
    // case to avoid interrupting playback.
    if (nativeChangedTrackRef.current) {
      nativeChangedTrackRef.current = false;
      lastSentAutoplayKeyRef.current = autoplayKey;
      return;
    }

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
            album: m.album?.name ?? "",
            coverUrl: resolveAssetUrl(m.cover_url),
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
  }, [autoplayKey, currentMusic]);

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
    void fetchMusicList()
      .then(({ musics }) => {
        if (!cancelled) { setLibraryMusics(musics); loadedLibraryForSessionRef.current = true; }
      })
      .catch((e) => { if (!cancelled) console.error("APK music library bootstrap failed", e); });
    return () => { cancelled = true; };
  }, [isAuthenticated, loadingUser, setLibraryMusics]);

  useEffect(() => {
    if (!IS_APK || loadingUser) return;
    if (!isAuthenticated) loadedLibraryForSessionRef.current = false;
  }, [isAuthenticated, loadingUser]);

  return null;
}

function resolveAssetUrl(path?: string | null) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}
