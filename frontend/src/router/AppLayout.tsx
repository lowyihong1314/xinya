import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useUserState } from "../app/UserState";
import { API_BASE, IS_APK } from "../js/apiBase";
import { musicPlayerController } from "../music/react/MusicPlayerController";
import { useMusicPlayback } from "../music/react/MusicPlaybackContext";
import { ensureDesignTokens } from "../theme/designTokens";
import { NAV_ITEMS, pageKeyFromPath } from "./routeConfig";

export function AppLayout() {
  ensureDesignTokens();

  const location = useLocation();
  const navigate = useNavigate();
  const { user, isMobile } = useUserState();
  const {
    currentMusic,
    currentMusicId,
    queue,
    isPlaying,
    hasPlaybackSession,
    shuffleEnabled,
    repeatMode,
    autoplayKey,
    toggleShuffle,
    cycleRepeatMode,
    playRelative,
    handleTrackEnded,
    playFromQueue,
    removeFromQueue,
    clearQueue,
    dismissPlayer,
    setIsPlayingState,
  } = useMusicPlayback();
  const [floatingMinimized, setFloatingMinimized] = useState(true);

  useEffect(() => {
    return () => {
      musicPlayerController.destroy();
    };
  }, []);

  useEffect(() => {
    musicPlayerController.sync({
      currentMusic,
      currentMusicId,
      queue,
      audioSrc: currentMusic ? `${API_BASE}/api/music/download/${currentMusic.id}` : null,
      isPlaying,
      hasPlaybackSession,
      hasQueue: queue.length > 0,
      shuffleEnabled,
      repeatMode,
      isMobile,
      minimized: floatingMinimized,
      autoplayKey,
      onToggleShuffle: toggleShuffle,
      onCycleRepeat: cycleRepeatMode,
      onPrev: () => playRelative(-1),
      onNext: () => playRelative(1),
      onDismiss: dismissPlayer,
      onExpand: () => setFloatingMinimized(false),
      onMinimize: () => setFloatingMinimized(true),
      onPlayFromQueue: playFromQueue,
      onRemoveFromQueue: removeFromQueue,
      onClearQueue: clearQueue,
      onEnded: handleTrackEnded,
      onPlayStateChange: setIsPlayingState,
      audioDisabled: IS_APK,
      hidden: IS_APK,
    });
  }, [
    currentMusic,
    currentMusicId,
    isPlaying,
    hasPlaybackSession,
    queue,
    shuffleEnabled,
      repeatMode,
      autoplayKey,
      isMobile,
      floatingMinimized,
      toggleShuffle,
      cycleRepeatMode,
      playRelative,
      playFromQueue,
      removeFromQueue,
      clearQueue,
      dismissPlayer,
      navigate,
      handleTrackEnded,
      setIsPlayingState,
    ]);

  useEffect(() => {
    window.base_navbar = document.getElementById("base_navbar");
  }, []);

  useEffect(() => {
    window.__xinyaNavigate = (nextPage, options = {}) => {
      const resolved = resolveLegacyPath(nextPage, new URL(window.location.href));
      navigate(resolved, { replace: options.replace ?? false });
    };
    return () => {
      delete window.__xinyaNavigate;
    };
  }, [navigate]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const legacyPage = url.searchParams.get("page");
    if (!legacyPage) {
      return;
    }

    navigate(resolveLegacyPath(legacyPage, url), { replace: true });
    url.searchParams.delete("page");
    url.searchParams.delete("event_id");
    url.searchParams.delete("image_id");
    history.replaceState(history.state, "", url.toString());
  }, [navigate]);

  const visibleItems = NAV_ITEMS.filter(
    (item) => (!item.auth || user) && !(user && item.key === "login"),
  );
  const activeKey = pageKeyFromPath(location.pathname);

  return (
    <div style={shellStyle}>
      <nav id="base_navbar" style={navbarStyle}>
        {visibleItems.map((item) => (
          <button
            key={item.key}
            title={item.title}
            type="button"
            onClick={() => navigate(item.path)}
            style={navButtonStyle(activeKey === item.key)}
          >
            <i className={item.icon} />
          </button>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}

export function resolveLegacyPath(page: string, url = new URL(window.location.href)) {
  if (page === "event_detail") {
    const eventId = url.searchParams.get("event_id");
    return eventId ? `/event/${eventId}` : "/not-found?reason=missing-event-id";
  }
  if (page === "image_detail") {
    const imageId = url.searchParams.get("image_id");
    return imageId ? `/image/${imageId}` : "/not-found?reason=missing-image-id";
  }
  if (page === "lamp_registration") {
    return "/lamp-registration";
  }
  return (
    NAV_ITEMS.find((item) => item.key === page)?.path ??
    (page === "login" ? "/login" : "/not-found")
  );
}

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  background: "var(--x-color-canvas)",
};

const navbarStyle: CSSProperties = {
  height: "60px",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: "12px",
  background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
  position: "sticky",
  top: "0",
  zIndex: 1000,
};

function navButtonStyle(active: boolean): CSSProperties {
  return {
    width: "46px",
    height: "46px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    color: "white",
    borderRadius: "10px",
    fontSize: "20px",
    cursor: "pointer",
    userSelect: "none",
    transition: "background 0.2s, transform 0.1s",
    border: "none",
    background: active ? "rgba(255,255,255,0.32)" : "transparent",
  };
}
