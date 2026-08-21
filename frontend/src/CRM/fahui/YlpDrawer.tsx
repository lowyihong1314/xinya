import type { CSSProperties, ReactNode } from "react";

// 法会工作区那只右侧抽屉（原 ylp-intake-drawer）：牌位填写页预览、牌位打印预览都用它，
// 原始文档页的订单摘要也共用同一份，保证滑入动画与外观一致。
export const INTAKE_DRAWER_CSS = `
@keyframes ylpIntakeSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
.ylp-intake-drawer { animation: ylpIntakeSlideIn 0.28s cubic-bezier(0.22, 1, 0.36, 1); }
`;

export function YlpDrawer({
  isMobile,
  navbarHeight,
  title,
  hint,
  actions,
  children,
}: {
  isMobile: boolean;
  navbarHeight: number;
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside style={drawerStyles.panel(isMobile, navbarHeight)} className="ylp-intake-drawer">
      <style>{INTAKE_DRAWER_CSS}</style>
      <header style={drawerStyles.header}>
        <div>
          <p style={drawerStyles.eyebrow}>{title}</p>
          {hint ? <p style={drawerStyles.hint}>{hint}</p> : null}
        </div>
        {actions ? <div style={drawerStyles.actions}>{actions}</div> : null}
      </header>
      {children}
    </aside>
  );
}

export const drawerStyles = {
  panel: (isMobile: boolean, navbarHeight: number): CSSProperties => ({
    width: isMobile ? "100%" : "min(400px, 42vw)",
    flexShrink: 0,
    position: isMobile ? "static" : "sticky",
    top: `${navbarHeight + 12}px`,
    alignSelf: "flex-start",
    maxHeight: isMobile ? "none" : `calc(100vh - ${navbarHeight + 24}px)`,
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
  }),
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
