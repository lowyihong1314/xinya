import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useUserState } from "../app/UserState";
import { CHANGYOU_PATH, MUSIC_PLAYER_PATH, MUSIC_ROOT_PATH } from "../music/router/paths";
import { ensureDesignTokens } from "../theme/designTokens";
import { NAV_ITEMS, pageKeyFromPath, resolveLegacyPath } from "./routeConfig";

const MUSIC_NAV_ITEMS = [
  {
    key: "music_player",
    title: "音乐",
    icon: "fas fa-music",
    path: MUSIC_PLAYER_PATH,
  },
  {
    key: "changyou",
    title: "唱游",
    icon: "fas fa-microphone-lines",
    path: CHANGYOU_PATH,
  },
] as const;

export function AppLayout() {
  ensureDesignTokens();

  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useUserState();
  const lastPrimaryPathRef = useRef("/");
  const isInsideMusicRouter = location.pathname.startsWith(MUSIC_ROOT_PATH);

  useEffect(() => {
    if (!isInsideMusicRouter) {
      lastPrimaryPathRef.current = location.pathname + location.search + location.hash;
    }
  }, [isInsideMusicRouter, location.hash, location.pathname, location.search]);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const legacyPage = searchParams.get("page");
    if (!legacyPage) {
      return;
    }

    navigate(resolveLegacyPath(legacyPage, searchParams), { replace: true });
  }, [location.search, navigate]);

  const visibleItems = NAV_ITEMS.filter(
    (item) => (!item.auth || user) && !(user && item.key === "login"),
  );
  const activeKey = pageKeyFromPath(location.pathname);
  const exitTarget = lastPrimaryPathRef.current || visibleItems[0]?.path || "/";

  return (
    <div style={shellStyle}>
      <nav id="base_navbar" style={navbarStyle}>
        {isInsideMusicRouter
          ? MUSIC_NAV_ITEMS.map((item) => {
              const isActive =
                item.key === "changyou"
                  ? location.pathname.startsWith(CHANGYOU_PATH)
                  : location.pathname.startsWith(MUSIC_PLAYER_PATH);

              return (
                <button
                  key={item.key}
                  title={item.title}
                  type="button"
                  onClick={() => navigate(item.path)}
                  style={navButtonStyle(isActive)}
                >
                  <i className={item.icon} />
                </button>
              );
            })
          : visibleItems.map((item) => (
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

        {isInsideMusicRouter ? (
          <button
            key="music-exit"
            title="返回主导航"
            type="button"
            onClick={() => navigate(exitTarget)}
            style={navButtonStyle(false)}
          >
            <i className="fas fa-right-from-bracket" />
          </button>
        ) : null}
      </nav>

      <Outlet />
    </div>
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
