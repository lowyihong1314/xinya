import type { ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { createHashRouter, Navigate, useLocation, useParams, useRouteError } from "react-router-dom";

import { LoginPage } from "../../../app/LoginPage";
import { useUserState } from "../../../app/UserState";
import { MusicPortalLayout } from "../layout/MusicPortalLayout";
import {
  CHANGYOU_PATH,
  CHANGYOU_ROOM_PATH,
  MUSIC_PLAYER_PATH,
  getChangyouDetailPath,
  getChangyouRoomPath,
} from "../../router/paths";
import { musicRoute } from "../../router/routes";

function PortalErrorPage({ message }: { message: string }) {
  return (
    <div style={errorPageStyle}>
      <div style={errorCardStyle}>{message}</div>
    </div>
  );
}

// 路由渲染出错时兜底，避免整页空白。
function PortalRouteErrorPage() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : "页面载入失败";
  console.error("Music portal route error", error);
  return (
    <div style={errorPageStyle}>
      <div style={errorCardStyle}>
        <div style={{ fontWeight: 700, marginBottom: "8px" }}>页面出错了</div>
        <div style={{ fontSize: "13px", opacity: 0.8 }}>{message}</div>
        <button type="button" style={errorButtonStyle} onClick={() => window.location.reload()}>
          重新载入
        </button>
      </div>
    </div>
  );
}

function RequirePortalAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { isAuthenticated, loadingUser } = useUserState();

  if (loadingUser) {
    return (
      <div style={errorPageStyle}>
        <div style={errorCardStyle}>正在读取登录状态…</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?from=${encodeURIComponent(from || MUSIC_PLAYER_PATH)}`} replace />;
  }

  return <>{children}</>;
}

function LegacyChangyouDetailRedirect() {
  const { entryId } = useParams();
  return <Navigate to={entryId ? getChangyouDetailPath(entryId) : CHANGYOU_PATH} replace />;
}

function LegacyChangyouRoomRedirect() {
  const { roomId } = useParams();
  return <Navigate to={roomId ? getChangyouRoomPath(roomId) : CHANGYOU_ROOM_PATH} replace />;
}

function wrapPortalMusicRoute(route: RouteObject): RouteObject {
  if (route.index || !route.element || route.path === "changyou/room/player/:roomId") {
    return route;
  }

  return {
    ...route,
    element: <RequirePortalAuth>{route.element}</RequirePortalAuth>,
  };
}

const portalMusicRoute = {
  path: musicRoute.path ?? "music",
  element: musicRoute.element,
  children: (musicRoute.children ?? []).map(wrapPortalMusicRoute),
} satisfies RouteObject;

export const musicPortalRouter = createHashRouter([
  {
    path: "/",
    element: <MusicPortalLayout />,
    errorElement: <PortalRouteErrorPage />,
    children: [
      { index: true, element: <Navigate to={MUSIC_PLAYER_PATH} replace /> },
      { path: "login", element: <LoginPage /> },
      portalMusicRoute,
      { path: "not-found", element: <PortalErrorPage message="页面不存在" /> },
      { path: "*", element: <Navigate to={MUSIC_PLAYER_PATH} replace /> },
    ],
  },
  { path: "/changyou", element: <Navigate to={CHANGYOU_PATH} replace /> },
  { path: "/changyou/:entryId", element: <LegacyChangyouDetailRedirect /> },
  { path: "/changyou-room", element: <Navigate to={CHANGYOU_ROOM_PATH} replace /> },
  { path: "/changyou-room/:roomId", element: <LegacyChangyouRoomRedirect /> },
  { path: "*", element: <Navigate to={MUSIC_PLAYER_PATH} replace /> },
]);

const errorPageStyle = {
  minHeight: "calc(100dvh - var(--x-navbar-height, 60px))",
  display: "grid",
  placeItems: "center",
  padding: "24px",
  boxSizing: "border-box" as const,
};

const errorCardStyle = {
  padding: "20px 24px",
  borderRadius: "20px",
  background: "rgba(255,255,255,0.84)",
  color: "var(--x-color-ink)",
  boxShadow: "0 18px 36px var(--x-color-shadow-soft)",
};

const errorButtonStyle = {
  marginTop: "14px",
  minHeight: "38px",
  padding: "0 16px",
  borderRadius: "12px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
};
