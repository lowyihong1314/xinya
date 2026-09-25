import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useUserState } from "../../../app/UserState";
import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { AppChromeProvider } from "../../../router/AppChromeContext";
import { useRegisterRouterNavigation } from "../../../router/navigationBridge";
import { DesktopMusicPortalHeader } from "./DesktopMusicPortalHeader";
import { MobileMusicPortalHeader } from "./MobileMusicPortalHeader";
import { PORTAL_ITEMS } from "./portalNavItems";

export function MusicPortalLayout() {
  useEnsureDesignTokens();

  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, isMobile, loadingUser, logout, openLogin } = useUserState();
  const [loggingOut, setLoggingOut] = useState(false);
  // 门户没有主站的 AppLayout，这里自己提供 AppChromeProvider：
  // 子页面（音乐播放器等）会用 navbarHeight 计算布局，转盘活动会用 setNavbarVisible 隐藏顶栏。
  const [navbarVisible, setNavbarVisible] = useState(true);
  const [navbarHeight, setNavbarHeight] = useState(60);
  const headerRef = useRef<HTMLDivElement | null>(null);

  useRegisterRouterNavigation();

  useLayoutEffect(() => {
    const element = headerRef.current;
    if (!element) {
      return;
    }
    const measure = () => {
      setNavbarHeight(navbarVisible ? element.getBoundingClientRect().height : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [navbarVisible, isMobile]);

  const chromeValue = useMemo(
    () => ({ navbarHeight, navbarVisible, setNavbarVisible }),
    [navbarHeight, navbarVisible],
  );

  // 给纯 CSS 的地方用：calc(100dvh - var(--x-navbar-height))。
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--x-navbar-height", `${navbarVisible ? navbarHeight : 0}px`);
  }, [navbarHeight, navbarVisible]);

  const activeKey = useMemo(() => {
    const matched = PORTAL_ITEMS.find((item) => location.pathname.startsWith(item.path));
    return matched?.key ?? null;
  }, [location.pathname]);

  const loginRedirectPath = `${location.pathname}${location.search}`;
  const userLabel = typeof user?.username === "string" && user.username.trim() ? user.username.trim() : "当前用户";

  async function handleAccountClick() {
    if (loadingUser || loggingOut) {
      return;
    }

    if (!isAuthenticated) {
      openLogin(loginRedirectPath || PORTAL_ITEMS[0].path);
      return;
    }

    setLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("Music portal logout failed", error);
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <AppChromeProvider value={chromeValue}>
    <div style={shellStyle}>
      <div id="base_navbar" ref={headerRef} style={navbarVisible ? undefined : hiddenHeaderStyle}>
      {isMobile ? (
        <MobileMusicPortalHeader
          portalItems={PORTAL_ITEMS}
          activeKey={activeKey}
          isAuthenticated={Boolean(isAuthenticated)}
          userLabel={userLabel}
          loadingUser={loadingUser}
          loggingOut={loggingOut}
          onNavigate={navigate}
          onAccountClick={handleAccountClick}
        />
      ) : (
        <DesktopMusicPortalHeader
          portalItems={PORTAL_ITEMS}
          activeKey={activeKey}
          isAuthenticated={Boolean(isAuthenticated)}
          userLabel={userLabel}
          loadingUser={loadingUser}
          loggingOut={loggingOut}
          onNavigate={navigate}
          onAccountClick={handleAccountClick}
        />
      )}
      </div>

      <Outlet />
    </div>
    </AppChromeProvider>
  );
}

const hiddenHeaderStyle: CSSProperties = {
  display: "none",
};

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top left, rgba(15,118,110,0.12), transparent 24%), linear-gradient(180deg, var(--x-color-canvas), var(--x-color-canvas-alt))",
};
