/**
 * 应用外壳。**与旧版对齐**：一条 60px 的居中图标导航条，**没有侧栏**。
 *
 * 旧版长这样（src/router/AppLayout.tsx，已删，可在 git 历史里查）：
 *   · 60px 高、`linear-gradient(135deg, nav-start, nav-end)`、position sticky
 *   · 居中排列的 46px 方形按钮，激活态 `rgba(255,255,255,0.32)`
 *   · 进 /music 时整条换成音乐的几项 + 一个「返回主导航」
 *
 * 这里照着做，只把两处换成了新体系：
 *   · 图标从 FontAwesome 换成 lucide（新代码里几十处已经在用，不回头）
 *   · 颜色从 `var(--x-color-nav-*)` 换成令牌层的 `--color-nav-*`（值一样）
 *
 * UI 分区约定（整个应用只有这三层）：
 *   ① 外壳 AppShell —— 导航条、全局提示。只出现一次。
 *   ② 页面 routes/  —— 一条路由一个页面，负责取数和编排。
 *   ③ 分区 <Card>   —— 页面内的内容块。
 */
import { LogOut } from "lucide-react";
import { useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/shared/auth/AuthProvider";
import { cn } from "@/shared/lib/cn";
import { MUSIC_NAV_ITEMS, MUSIC_ROOT, NAV_ITEMS, type NavItem } from "../navigation";

export function AppShell() {
  const { user, logout, hasAny } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const inMusic = location.pathname === MUSIC_ROOT || location.pathname.startsWith(`${MUSIC_ROOT}/`);

  // 进音乐模块之前停在哪 —— 「返回主导航」要跳回去。
  // 用 ref 不用 state：它变化时不需要重渲染，而且放 state 会在
  // 「记录上一个路径」这个 effect 里造成一次多余的渲染。
  const lastOutsideMusic = useRef("/");
  useEffect(() => {
    if (!inMusic) {
      lastOutsideMusic.current = location.pathname + location.search;
    }
  }, [inMusic, location.pathname, location.search]);

  const items = inMusic ? MUSIC_NAV_ITEMS : visibleItems(NAV_ITEMS, Boolean(user), hasAny);

  return (
    <div className="min-h-svh bg-background">
      {/* 60px + 刘海安全区。sticky 让它在长页面上一直可见（与旧版一致）。 */}
      <nav
        className={cn(
          "sticky top-0 z-50 flex h-[60px] items-center justify-center gap-3 px-3",
          "bg-[linear-gradient(135deg,var(--color-nav-start),var(--color-nav-end))]",
          "pt-[env(safe-area-inset-top)]",
        )}
        aria-label="主导航"
      >
        {items.map((item) => (
          <NavButton
            key={item.key}
            item={item}
            active={isActive(item.to, location.pathname)}
            onClick={() => navigate(item.to)}
          />
        ))}

        {inMusic ? (
          <button
            type="button"
            title="返回主导航"
            aria-label="返回主导航"
            onClick={() => navigate(lastOutsideMusic.current)}
            className={navButtonClass(false)}
          >
            <LogOut className="size-5 rotate-180" aria-hidden />
          </button>
        ) : null}

        {/* 退出登录放最右，与导航项拉开距离 —— 它不是"去某个页面"，是个动作。
            旧版没有这个按钮（退出在用户资料页里），但那多一次点击，保留在这里。 */}
        {user ? (
          <button
            type="button"
            title={`退出登录（${user.display_name || user.username}）`}
            aria-label="退出登录"
            onClick={() => void logout()}
            className={cn(navButtonClass(false), "ml-auto")}
          >
            <LogOut className="size-5" aria-hidden />
          </button>
        ) : null}
      </nav>

      {/* 内容区满宽（与旧版一致），页面自己控制最大宽度。
          pb 留出底部安全区 + 音乐播放条的高度。 */}
      <main className="px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
    </div>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      title={item.title}
      // 图标条上没有文字，aria-label 是读屏用户唯一的线索
      aria-label={item.title}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={navButtonClass(active)}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}

/** 46px 方形按钮，激活态半透明白底 —— 数值照抄旧版 navButtonStyle。 */
function navButtonClass(active: boolean): string {
  return cn(
    "flex size-[46px] shrink-0 items-center justify-center rounded-[10px] text-white",
    "transition-colors select-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
    active ? "bg-white/[0.32]" : "hover:bg-white/15",
  );
}

/**
 * 当前路径算不算命中这一项。
 *
 * 首页要精确匹配，其余按前缀 —— 否则 "/" 会命中所有路径，整条导航全亮。
 */
function isActive(to: string, pathname: string): boolean {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** 按登录状态和权限过滤。看得见但点进去 403 是最差的体验。 */
function visibleItems(
  items: readonly NavItem[],
  loggedIn: boolean,
  hasAny: (perms: readonly string[]) => boolean,
): NavItem[] {
  return items.filter((item) => {
    // 登录后不再显示「登录」这一项（旧版同样逻辑）
    if (item.key === "login") return !loggedIn;
    if (item.auth && !loggedIn) return false;
    if (item.anyOf && !hasAny(item.anyOf)) return false;
    return true;
  });
}
