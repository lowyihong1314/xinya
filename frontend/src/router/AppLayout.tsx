import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useUserState } from "../app/UserState";
import { IS_APK } from "../js/apiBase";
import { CHANGYOU_PATH, MUSIC_PLAYER_PATH, MUSIC_ROOT_PATH } from "../music/router/paths";
import { useEnsureDesignTokens } from "../theme/designTokens";
import { AppChromeProvider } from "./AppChromeContext";
import { useRegisterRouterNavigation } from "./navigationBridge";
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
  useEnsureDesignTokens();

  const location = useLocation();
  const navigate = useNavigate();
  const { user, isMobile } = useUserState();
  const lastPrimaryPathRef = useRef("/");
  const navbarRef = useRef<HTMLElement | null>(null);
  const isInsideMusicRouter = location.pathname.startsWith(MUSIC_ROOT_PATH);
  const [navbarVisible, setNavbarVisible] = useState(true);
  const [navbarHeight, setNavbarHeight] = useState(60);

  useRegisterRouterNavigation();

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

  useEffect(() => {
    const navbar = navbarRef.current;
    if (!navbar || typeof window === "undefined") {
      return;
    }

    let frame = 0;
    const measure = () => {
      setNavbarHeight(Math.round(navbar.getBoundingClientRect().height));
    };

    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
    observer?.observe(navbar);
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleMeasure);
      observer?.disconnect();
    };
  }, [navbarVisible]);

  const visibleItems = NAV_ITEMS.filter(
    (item) => (!item.auth || user || (IS_APK && item.key === "music")) && !(user && item.key === "login"),
  );
  const activeKey = pageKeyFromPath(location.pathname);
  const exitTarget = lastPrimaryPathRef.current || visibleItems[0]?.path || "/";
  const chromeValue = useMemo(
    () => ({
      navbarHeight,
      navbarVisible,
      setNavbarVisible,
    }),
    [navbarHeight, navbarVisible],
  );

  return (
    <AppChromeProvider value={chromeValue}>
      <div style={shellStyle}>
        <nav id="base_navbar" ref={navbarRef} style={navbarStyle(navbarVisible)}>
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

        <div style={appContentStyle(isMobile)}>
          <Outlet />
        </div>
      </div>
    </AppChromeProvider>
  );
}

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  background: "var(--x-color-canvas)",
};

function navbarStyle(visible: boolean): CSSProperties {
  return {
    height: "60px",
    display: visible ? "flex" : "none",
    justifyContent: "center",
    alignItems: "center",
    gap: "12px",
    background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
    position: "sticky",
    top: "0",
    zIndex: 1000,
  };
}

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

function appContentStyle(isMobile: boolean): CSSProperties {
  return {
    minWidth: 0,
    padding: isMobile ? "0" : undefined,
  };
}
