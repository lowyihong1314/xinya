import { Maximize, Minimize } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui";

/**
 * 播放器外壳：16:9 黑底 + 顶部覆盖条 + 全屏。直播和回放共用。
 *
 * ⚠️ 这里出现 bg-black / text-white 是**故意的**，不算违反「不写具体色值」：
 *    画面比例和容器不一致时 letterbox 区必须是黑的（用 bg-card 会在画面边上
 *    露出一圈灰），覆盖条压在画面上也不能跟着主题变色 —— 深色模式下它照样要白字。
 *    AppShell 的顶栏是同样的处理。
 *
 * 覆盖条的淡出用 CSS（group-hover / group-focus-within）而不是定时器：
 * 定时器版要在每个交互点手动 poke 一次，漏一个就是「按着方向键它自己淡掉」，
 * 而且键盘用户永远看不到它亮起来。
 */
export function PlayerFrame({
  badge,
  actions,
  children,
  className,
}: {
  /** 左上角的状态标签。 */
  badge?: ReactNode;
  /** 右上角的操作（全屏按钮由本组件自己补在最后）。 */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 用户按 Esc 退出全屏时不会经过我们的 toggle，只能听事件。
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapRef.current?.requestFullscreen();
  }, []);

  // iPhone 上 Safari 不支持「元素全屏」（只有 <video> 自己那套），按钮点了没反应。
  // 不支持就干脆不渲染 —— 一个点不动的按钮比没有按钮更让人困惑。
  const canFullscreen = typeof document !== "undefined" && document.fullscreenEnabled;

  return (
    <div
      ref={wrapRef}
      className={cn(
        "group relative aspect-video w-full overflow-hidden rounded-[var(--radius-md)] bg-black",
        className,
      )}
    >
      {children}

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5",
          "bg-linear-to-b from-black/60 to-transparent",
          "opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        {/* 覆盖条整条不吃点击（免得挡住画面上的操作），只有里面的控件吃。 */}
        <div className="pointer-events-auto">{badge}</div>
        <div className="pointer-events-auto flex items-center gap-1.5">
          {actions}
          {canFullscreen ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/15 hover:text-white"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "退出全屏" : "全屏"}
            >
              {isFullscreen ? <Minimize /> : <Maximize />}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
