import { useEffect, useState } from "react";

import { Z_DRAWER } from "./zLayers";
import type { CSSProperties, ReactNode } from "react";

// 法会工作区那只右侧抽屉（原 ylp-intake-drawer）：牌位填写页预览、牌位打印预览都用它，
// 原始文档页的订单摘要也共用同一份，保证滑入动画与外观一致。
export const INTAKE_DRAWER_CSS = `
/* 原本有个 translateX(100%) → 0 的滑入动画，去掉了：手机版抽屉是 position: fixed，
   而 transform 会让元素变成 fixed 后代的包含块 —— Safari 在动画那 0.28 秒里
   会把整只抽屉的定位算错，正是「一进去画面就跑」的来源之一。 */
/* 手机上抽屉是盖住整屏的一「页」，标题栏跟着钉住，划到多下面都点得到返回 */
.ylp-intake-drawer-sheet > .ylp-drawer-header {
  position: sticky;
  top: -16px;
  z-index: 1;
  margin: -16px -16px 0;
  padding: 16px;
  background: var(--x-color-panel);
  border-bottom: 1px solid var(--x-color-line-soft, var(--x-color-line));
}
`;

type SheetRect = { top: number; height: number };

/** iOS Safari 键盘一弹，只有「视觉视口」缩小，布局视口纹丝不动；
 *  position: fixed 是钉在布局视口上的，于是抽屉整块被留在人眼看到的范围之外
 *  —— 表现就是一打字画面整个往下跑。
 *
 *  visualViewport 报的就是人此刻真正看得到的那块矩形，抽屉跟着它走才不会跑。
 *  老浏览器没有这个 API，回退到 inset:0，跟以前一样。 */
function useVisualViewportRect(active: boolean): SheetRect | null {
  const [rect, setRect] = useState<SheetRect | null>(null);

  useEffect(() => {
    if (!active) {
      setRect(null);
      return;
    }
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }
    const sync = () => setRect({ top: viewport.offsetTop, height: viewport.height });
    sync();
    // resize = 键盘弹起/收起；scroll = Safari 自己把视觉视口挪去露出输入框
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
    };
  }, [active]);

  return rect;
}

export function YlpDrawer({
  isMobile,
  navbarHeight,
  className,
  title,
  hint,
  actions,
  children,
}: {
  isMobile: boolean;
  navbarHeight: number;
  // 每个调用方再挂一个自己的名字，方便按抽屉单独写样式 / 指位置：
  // ylp-intake-preview-drawer、ylp-print-preview-drawer、ylp-order-summary-drawer
  className?: string;
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  // 手机上抽屉是盖住整屏的，底下那张列表不该还能跟着滚 —— 不锁的话
  // 在抽屉里滑到底会把下面的列表带着走，退出来发现位置全变了。
  useEffect(() => {
    if (!isMobile) {
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isMobile]);

  const sheetRect = useVisualViewportRect(isMobile);

  return (
    <aside
      style={drawerStyles.panel(isMobile, navbarHeight, sheetRect)}
      className={[
        "ylp-intake-drawer",
        // 手机版才是整屏的「页」，桌面仍是右侧那条常驻栏
        isMobile ? "ylp-intake-drawer-sheet" : "",
        className || "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <style>{INTAKE_DRAWER_CSS}</style>
      <header style={drawerStyles.header} className="ylp-drawer-header">
        <div className="ylp-drawer-heading">
          <p style={drawerStyles.eyebrow}>{title}</p>
          {hint ? <p style={drawerStyles.hint}>{hint}</p> : null}
        </div>
        {actions ? <div style={drawerStyles.actions} className="ylp-drawer-actions">{actions}</div> : null}
      </header>
      {children}
    </aside>
  );
}

export const drawerStyles = {
  // 手机和桌面是两种东西，别硬塞进一套三元里：
  //   桌面 —— 右侧一条常驻栏，跟列表并排，sticky 跟着滚
  //   手机 —— 点卡片后盖住整屏的一「页」，退出靠标题栏那颗返回
  //
  // 手机端连顶部导航一起盖：导航是 sticky（钉在文档顶），键盘一弹视觉视口
  // 挪走它就跟着不见了，再给它留一条 navbarHeight 的空隙，那空隙里会露出
  // 底下的列表。盖满反而是稳的 —— 这本来就是一整页，返回按钮在标题栏里。
  panel: (isMobile: boolean, navbarHeight: number, sheet: SheetRect | null): CSSProperties =>
    isMobile
      ? {
          position: "fixed",
          top: sheet ? `${sheet.top}px` : 0,
          left: 0,
          right: 0,
          // 拿得到视觉视口就用它的高度（键盘占掉的部分自动让开）；
          // 拿不到就退回 bottom:0，和改动前一样
          height: sheet ? `${sheet.height}px` : undefined,
          bottom: sheet ? undefined : 0,
          // 要压过导航栏的 z-index: 1000
          zIndex: Z_DRAWER,
          width: "100%",
          overflowY: "auto",
          // 抽屉滑到底不要把底下的页面也带着滚
          overscrollBehavior: "contain",
          display: "grid",
          gridTemplateRows: "auto 1fr",
          alignContent: "start",
          gap: "12px",
          padding: "16px",
          paddingBottom: "max(16px, env(safe-area-inset-bottom))",
          boxSizing: "border-box",
          background: "var(--x-color-panel)",
          border: "none",
          borderRadius: 0,
        }
      : {
          width: "min(400px, 42vw)",
          flexShrink: 0,
          position: "sticky",
          top: `${navbarHeight + 12}px`,
          alignSelf: "flex-start",
          maxHeight: `calc(100vh - ${navbarHeight + 24}px)`,
          overflowY: "auto",
          display: "grid",
          gridTemplateRows: "auto auto",
          gap: "12px",
          padding: "16px",
          boxSizing: "border-box",
          background: "var(--x-color-panel)",
          border: "1px solid var(--x-color-line)",
          borderRadius: "16px",
          boxShadow: "0 24px 60px var(--x-color-shadow)",
        },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
  } as CSSProperties,
  eyebrow: {
    margin: 0,
    fontSize: "14px",
    fontWeight: 800,
    color: "var(--x-color-ink)",
  } as CSSProperties,
  hint: {
    margin: "4px 0 0",
    fontSize: "12px",
    color: "var(--x-color-ink-muted)",
  } as CSSProperties,
  actions: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
  } as CSSProperties,
  button: {
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontWeight: 700,
    fontSize: "12px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  } as CSSProperties,
  buttonMuted: {
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink-muted)",
    fontWeight: 700,
    fontSize: "12px",
    cursor: "pointer",
  } as CSSProperties,
};
