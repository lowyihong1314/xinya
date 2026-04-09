import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useUserState } from "../../../app/UserState";
import { ensureDesignTokens } from "../../../theme/designTokens";
import { DesktopMusicPortalHeader } from "./DesktopMusicPortalHeader";
import { MobileMusicPortalHeader } from "./MobileMusicPortalHeader";
import { PORTAL_ITEMS } from "./portalNavItems";

export function MusicPortalLayout() {
  ensureDesignTokens();

  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, isMobile, loadingUser, logout, openLogin } = useUserState();
  const [loggingOut, setLoggingOut] = useState(false);

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
    <div style={shellStyle}>
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

      <Outlet />
    </div>
  );
}

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top left, rgba(15,118,110,0.12), transparent 24%), linear-gradient(180deg, var(--x-color-canvas), var(--x-color-canvas-alt))",
};
