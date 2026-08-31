import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";

// 法会工作区那只右侧抽屉（原 ylp-intake-drawer）：牌位填写页预览、牌位打印预览都用它，
// 原始文档页的订单摘要也共用同一份，保证滑入动画与外观一致。
export const INTAKE_DRAWER_CSS = `
@keyframes ylpIntakeSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
.ylp-intake-drawer { animation: ylpIntakeSlideIn 0.28s cubic-bezier(0.22, 1, 0.36, 1); }
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

  return (
    <aside
      style={drawerStyles.panel(isMobile, navbarHeight)}
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
  //   手机 —— 点卡片后盖住整屏的一「页」，只让开顶部导航，退出靠标题栏那颗返回
  panel: (isMobile: boolean, navbarHeight: number): CSSProperties =>
    isMobile
      ? {
          position: "fixed",
          top: `${navbarHeight}px`,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 60,
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
