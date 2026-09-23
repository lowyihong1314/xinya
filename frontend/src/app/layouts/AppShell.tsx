/**
 * 登录后的应用外壳：顶栏 + 内容区。
 *
 * UI 分区约定（整个应用只有这三层，别再发明新的）：
 *   ① 外壳 AppShell —— 顶栏、导航、全局提示。只出现一次。
 *   ② 页面 route     —— 一条路由一个页面，负责取数和编排分区。
 *   ③ 分区 Section   —— 页面内的内容块，一律用 <Card> 包。
 */
import { LogOut } from "lucide-react";
import { Link, Outlet } from "react-router-dom";

import { useAuth } from "@/shared/auth/AuthProvider";
import { Button } from "@/shared/ui";

export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-[linear-gradient(90deg,var(--color-nav-start),var(--color-nav-end))] text-white">
        {/* pt-[env(safe-area-inset-top)]：APK 全屏时顶栏会被刘海/状态栏盖住 */}
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 pt-[env(safe-area-inset-top)]">
          <Link to="/" className="font-serif text-lg tracking-wide">
            心芽
          </Link>
          <div className="flex-1" />
          {user ? (
            <>
              <span className="hidden text-sm opacity-90 sm:inline">
                {user.display_name || user.username}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/15 hover:text-white"
                onClick={() => void logout()}
                aria-label="退出登录"
              >
                <LogOut />
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {/* pb-[env(safe-area-inset-bottom)]：iPhone 底部横条会盖住最后一行内容 */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
    </div>
  );
}
