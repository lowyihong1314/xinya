import { useEffect, useRef } from "react";

import { useUserState } from "../../app/UserState";
import { API_BASE, IS_APK } from "../../js/apiBase";
import { fetchMusicList } from "./api";
import { useMusicPlayback } from "./MusicPlaybackContext";
import { NativeMusic } from "./nativeMusicPlugin";

export function ApkMusicRuntime() {
  const { isAuthenticated, loadingUser } = useUserState();
  const {
    currentMusic,
    autoplayKey,
    hasPlaybackSession,
    handleTrackEnded,
    playRelative,
    setIsPlayingState,
    setLibraryMusics,
  } = useMusicPlayback();
  const callbacksRef = useRef({
    handleTrackEnded,
    playRelative,
    setIsPlayingState,
  });
  const lastNativeAutoplayKeyRef = useRef(0);
  const hasSeenPlaybackSessionRef = useRef(false);
  const loadedLibraryForSessionRef = useRef(false);

  useEffect(() => {
    callbacksRef.current = {
      handleTrackEnded,
      playRelative,
      setIsPlayingState,
    };
  }, [handleTrackEnded, playRelative, setIsPlayingState]);

  useEffect(() => {
    if (!IS_APK) {
      return;
    }

    void NativeMusic.ready().catch((error) => {
      console.error("NativeMusic.ready failed", error);
    });

    let active = true;
    const handles: Array<{ remove: () => Promise<void> | void }> = [];

    void (async () => {
      try {
        const nextHandles = await Promise.all([
          NativeMusic.addListener("trackEnded", () => callbacksRef.current.handleTrackEnded()),
          NativeMusic.addListener("next", () => callbacksRef.current.playRelative(1)),
          NativeMusic.addListener("prev", () => callbacksRef.current.playRelative(-1)),
          NativeMusic.addListener("playStateChanged", ({ isPlaying }) => {
            callbacksRef.current.setIsPlayingState(isPlaying);
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
  }, []);

  useEffect(() => {
    if (!IS_APK || loadingUser || !isAuthenticated || loadedLibraryForSessionRef.current) {
      return;
    }

    let cancelled = false;

    void fetchMusicList()
      .then(({ musics }) => {
        if (!cancelled) {
          setLibraryMusics(musics);
          loadedLibraryForSessionRef.current = true;
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("APK music library bootstrap failed", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, loadingUser, setLibraryMusics]);

  useEffect(() => {
    if (!IS_APK || loadingUser) {
      return;
    }
    if (!isAuthenticated) {
      loadedLibraryForSessionRef.current = false;
    }
  }, [isAuthenticated, loadingUser]);

  useEffect(() => {
    if (!IS_APK || !currentMusic || autoplayKey <= 0 || autoplayKey === lastNativeAutoplayKeyRef.current) {
      return;
    }

    lastNativeAutoplayKeyRef.current = autoplayKey;

    void NativeMusic.ready()
      .then(() =>
        NativeMusic.play({
          url: `${API_BASE}/api/music/download/${currentMusic.id}`,
          title: currentMusic.title,
          album: currentMusic.album?.name ?? "",
          coverUrl: resolveAssetUrl(currentMusic.cover_url),
        }),
      )
      .then(() => {
        setIsPlayingState(true);
      })
      .catch((error) => {
        setIsPlayingState(false);
        console.error("NativeMusic.play failed", error);
      });
  }, [autoplayKey, currentMusic, setIsPlayingState]);

  useEffect(() => {
    if (!IS_APK) {
      return;
    }
    if (hasPlaybackSession && currentMusic) {
      hasSeenPlaybackSessionRef.current = true;
      return;
    }
    if (!hasSeenPlaybackSessionRef.current) {
      return;
    }

    void NativeMusic.stop().catch((error) => {
      console.error("NativeMusic.stop failed", error);
    });
  }, [currentMusic, hasPlaybackSession]);

  return null;
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
