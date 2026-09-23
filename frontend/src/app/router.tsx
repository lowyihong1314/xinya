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
import { RequireAuth } from "@/shared/auth/guards";
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
const ProfilePage = lazy(() =>
  import("@/features/profile/routes/ProfilePage").then((m) => ({ default: m.ProfilePage })),
);
const SongbookPage = lazy(() =>
  import("@/features/songbook/routes/SongbookPage").then((m) => ({ default: m.SongbookPage })),
);
const SongDetailPage = lazy(() =>
  import("@/features/songbook/routes/SongDetailPage").then((m) => ({ default: m.SongDetailPage })),
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
      { path: "/email", element: lazyBoundary(<EmailPage />) },
      { path: "/songbook", element: lazyBoundary(<SongbookPage />) },
      { path: "/songbook/:songId", element: lazyBoundary(<SongDetailPage />) },
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
