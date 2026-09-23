/**
 * 登录后的应用外壳：顶栏 + 侧栏（桌面）/ 抽屉（手机）+ 内容区。
 *
 * UI 分区约定（整个应用只有这三层，别再发明新的）：
 *   ① 外壳 AppShell —— 顶栏、导航、全局提示。只出现一次。
 *   ② 页面 routes/  —— 一条路由一个页面，负责取数和编排分区。
 *   ③ 分区 <Card>   —— 页面内的内容块。
 */
import { LogOut, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "@/shared/auth/AuthProvider";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui";
import { NAV } from "../navigation";

export function AppShell() {
  const { user, logout, hasAny } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // 切页面自动关抽屉。不关的话手机上点完菜单还要再点一次关闭。
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  // 只保留当前账号有权限看的项；整组都没权限就连标题一起隐藏。
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.anyOf || hasAny(i.anyOf)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 bg-[linear-gradient(90deg,var(--color-nav-start),var(--color-nav-end))] text-white">
        <div className="flex h-14 items-center gap-3 px-4 pt-[env(safe-area-inset-top)]">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/15 hover:text-white lg:hidden"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label={drawerOpen ? "关闭菜单" : "打开菜单"}
            aria-expanded={drawerOpen}
          >
            {drawerOpen ? <X /> : <Menu />}
          </Button>
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

      <div className="flex flex-1">
        {/* 桌面侧栏：常驻 */}
        <aside className="hidden w-60 shrink-0 border-r border-border bg-card lg:block">
          <NavTree groups={groups} className="sticky top-14 p-3" />
        </aside>

        {/* 手机抽屉：遮罩 + 滑出。用 fixed 而不是把侧栏挤进流式布局，
            后者会在打开时把内容推走，关掉又推回来，观感很跳。 */}
        {drawerOpen ? (
          <>
            <div
              className="fixed inset-0 z-30 bg-black/40 lg:hidden"
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
            <aside className="fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto border-r border-border bg-card pt-[calc(3.5rem+env(safe-area-inset-top))] lg:hidden">
              <NavTree groups={groups} className="p-3" />
            </aside>
          </>
        ) : null}

        <main className="min-w-0 flex-1 px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function NavTree({
  groups,
  className,
}: {
  groups: { title: string; items: readonly { to: string; label: string; icon: React.ComponentType<{ className?: string }> }[] }[];
  className?: string;
}) {
  return (
    <nav className={cn("space-y-5", className)}>
      {groups.map((group) => (
        <div key={group.title}>
          <p className="px-3 pb-1.5 text-xs font-medium tracking-wide text-muted-foreground">
            {group.title}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-primary-soft font-medium text-primary-strong"
                        : "text-foreground hover:bg-accent hover:text-accent-foreground",
                    )
                  }
                >
                  <item.icon className="size-4 shrink-0" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
