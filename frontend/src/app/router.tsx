/**
 * 路由表。
 *
 * 路由模式由 shared/config/env.ts 的 ROUTER_MODE 决定：
 *   网页版 browser —— 真实路径，地址干净、分享链接好看。
 *                     依赖后端兜底：匹配不到 API 的 GET 返回 SPA 外壳。
 *   APK   hash     —— 壳里页面是本地文件加载的，没有服务端做兜底，
 *                     用路径路由的话刷新/深链直接白屏。
 *
 * 代码分割：页面一律 lazy()。旧前端为了分包开了 8 个构建入口，
 * 按路由懒加载能达到同样效果，而且不用维护 8 份入口文件和 8 份模板。
 */
import { lazy, Suspense } from "react";
import {
  createBrowserRouter,
  createHashRouter,
  type RouteObject,
} from "react-router-dom";

import { ROUTER_MODE } from "@/shared/config/env";
import { RequireAuth, RequirePermission } from "@/shared/auth/guards";
import { LoadingState } from "@/shared/ui";
import { AppShell } from "./layouts/AppShell";
import { PublicLayout } from "./layouts/PublicLayout";

const LoginPage = lazy(() =>
  import("@/features/auth/routes/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const HomePage = lazy(() =>
  import("@/features/home/routes/HomePage").then((m) => ({ default: m.HomePage })),
);
const NotFoundPage = lazy(() =>
  import("@/features/system/routes/NotFoundPage").then((m) => ({ default: m.NotFoundPage })),
);
const ForbiddenPage = lazy(() =>
  import("@/features/system/routes/ForbiddenPage").then((m) => ({ default: m.ForbiddenPage })),
);
const AboutPage = lazy(() =>
  import("@/features/about/routes/AboutPage").then((m) => ({ default: m.AboutPage })),
);
const EmailPage = lazy(() =>
  import("@/features/email/routes/EmailPage").then((m) => ({ default: m.EmailPage })),
);
const EventsPage = lazy(() =>
  import("@/features/events/routes/EventsPage").then((m) => ({ default: m.EventsPage })),
);
const EventDetailPage = lazy(() =>
  import("@/features/events/routes/EventDetailPage").then((m) => ({ default: m.EventDetailPage })),
);
const MusicPage = lazy(() =>
  import("@/features/music/routes/MusicPage").then((m) => ({ default: m.MusicPage })),
);
const LedgerPage = lazy(() =>
  import("@/features/ledger/routes/LedgerPage").then((m) => ({ default: m.LedgerPage })),
);
const TrialBalancePage = lazy(() =>
  import("@/features/ledger/routes/TrialBalancePage").then((m) => ({ default: m.TrialBalancePage })),
);
const JournalEntryDetailPage = lazy(() =>
  import("@/features/ledger/routes/JournalEntryDetailPage").then((m) => ({ default: m.JournalEntryDetailPage })),
);
const AccountLedgerPage = lazy(() =>
  import("@/features/ledger/routes/AccountLedgerPage").then((m) => ({ default: m.AccountLedgerPage })),
);
const CctvLivePage = lazy(() =>
  import("@/features/cctv/routes/CctvLivePage").then((m) => ({ default: m.CctvLivePage })),
);
const CctvPlaybackPage = lazy(() =>
  import("@/features/cctv/routes/CctvPlaybackPage").then((m) => ({ default: m.CctvPlaybackPage })),
);
const QuizHostPage = lazy(() =>
  import("@/features/quiz/routes/QuizHostPage").then((m) => ({ default: m.QuizHostPage })),
);
const QuizGuestPage = lazy(() =>
  import("@/features/quiz/routes/QuizGuestPage").then((m) => ({ default: m.QuizGuestPage })),
);
const ChangyouRoomsPage = lazy(() =>
  import("@/features/music/rooms/routes/ChangyouRoomsPage").then((m) => ({ default: m.ChangyouRoomsPage })),
);
const ChangyouRoomPage = lazy(() =>
  import("@/features/music/rooms/routes/ChangyouRoomPage").then((m) => ({ default: m.ChangyouRoomPage })),
);
const ChangyouPlayerPage = lazy(() =>
  import("@/features/music/rooms/routes/ChangyouPlayerPage").then((m) => ({ default: m.ChangyouPlayerPage })),
);
const AppDownloadPage = lazy(() =>
  import("@/features/app-releases/routes/AppDownloadPage").then((m) => ({ default: m.AppDownloadPage })),
);
const ClaimsPage = lazy(() =>
  import("@/features/claims/routes/ClaimsPage").then((m) => ({ default: m.ClaimsPage })),
);
const UsersPage = lazy(() =>
  import("@/features/users/routes/UsersPage").then((m) => ({ default: m.UsersPage })),
);
const ProfilePage = lazy(() =>
  import("@/features/profile/routes/ProfilePage").then((m) => ({ default: m.ProfilePage })),
);
const SongbookPage = lazy(() =>
  import("@/features/music/songbook/routes/SongbookPage").then((m) => ({ default: m.SongbookPage })),
);
const SongDetailPage = lazy(() =>
  import("@/features/music/songbook/routes/SongDetailPage").then((m) => ({ default: m.SongDetailPage })),
);

/** 懒加载的分块在下载期间要有占位，否则切页面会闪一下空白。 */
function lazyBoundary(node: React.ReactNode) {
  return <Suspense fallback={<LoadingState className="min-h-[50svh]" />}>{node}</Suspense>;
}

const routes: RouteObject[] = [
  {
    // 公开区：不需要登录。
    element: <PublicLayout />,
    children: [
      { path: "/login", element: lazyBoundary(<LoginPage />) },
      { path: "/forbidden", element: lazyBoundary(<ForbiddenPage />) },
      // 关于我们是公开页：后端那两条接口没挂 login_required
      { path: "/about", element: lazyBoundary(<AboutPage />) },
      // APK 下载是给外部链接/二维码用的，不要求登录
      { path: "/app-download", element: lazyBoundary(<AppDownloadPage />) },
      // 抢答参与者从大屏二维码扫进来，多数是没账号的访客
      { path: "/quiz/:token", element: lazyBoundary(<QuizGuestPage />) },
    ],
  },
  {
    // 应用区：整块要求登录。守卫放在路由层，页面组件里不再各自判断。
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: lazyBoundary(<HomePage />) },
      { path: "/profile", element: lazyBoundary(<ProfilePage />) },
      { path: "/events", element: lazyBoundary(<EventsPage />) },
      { path: "/events/:eventId", element: lazyBoundary(<EventDetailPage />) },
      {
        path: "/claims",
        element: (
          <RequirePermission anyOf={["account_read", "account_edit", "account_submit_claim"]}>
            {lazyBoundary(<ClaimsPage />)}
          </RequirePermission>
        ),
      },
      {
        // 用户与权限：要部门或权限相关的任一权限才进得去
        path: "/users",
        element: (
          <RequirePermission anyOf={["department", "department_edit", "permission", "permission_edit"]}>
            {lazyBoundary(<UsersPage />)}
          </RequirePermission>
        ),
      },
      { path: "/email", element: lazyBoundary(<EmailPage />) },
      { path: "/music/songbook", element: lazyBoundary(<SongbookPage />) },
      { path: "/music", element: lazyBoundary(<MusicPage />) },
      // 唱游房间（music 域）
      { path: "/music/rooms", element: lazyBoundary(<ChangyouRoomsPage />) },
      { path: "/music/rooms/:roomId", element: lazyBoundary(<ChangyouRoomPage />) },
      { path: "/music/rooms/:roomId/player", element: lazyBoundary(<ChangyouPlayerPage />) },
      // 抢答主持台
      { path: "/quiz", element: lazyBoundary(<QuizHostPage />) },
      {
        path: "/ledger",
        element: (
          <RequirePermission anyOf={["account_read", "account_edit"]}>
            {lazyBoundary(<LedgerPage />)}
          </RequirePermission>
        ),
      },
      {
        path: "/ledger/trial-balance",
        element: (
          <RequirePermission anyOf={["account_read", "account_edit"]}>
            {lazyBoundary(<TrialBalancePage />)}
          </RequirePermission>
        ),
      },
      {
        path: "/ledger/entries/:entryId",
        element: (
          <RequirePermission anyOf={["account_read", "account_edit"]}>
            {lazyBoundary(<JournalEntryDetailPage />)}
          </RequirePermission>
        ),
      },
      {
        path: "/ledger/accounts/:accountId",
        element: (
          <RequirePermission anyOf={["account_read", "account_edit"]}>
            {lazyBoundary(<AccountLedgerPage />)}
          </RequirePermission>
        ),
      },
      {
        path: "/cctv",
        element: <RequirePermission anyOf={["cctv"]}>{lazyBoundary(<CctvLivePage />)}</RequirePermission>,
      },
      {
        path: "/cctv/playback",
        element: <RequirePermission anyOf={["cctv"]}>{lazyBoundary(<CctvPlaybackPage />)}</RequirePermission>,
      },
      { path: "/music/songbook/:songId", element: lazyBoundary(<SongDetailPage />) },
    ],
  },
  {
    // 兜底 404 —— 放在最后，否则会吃掉后面所有路由。
    element: <PublicLayout />,
    children: [{ path: "*", element: lazyBoundary(<NotFoundPage />) }],
  },
];

export const router =
  ROUTER_MODE === "hash" ? createHashRouter(routes) : createBrowserRouter(routes);
