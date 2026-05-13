import type { CSSProperties } from "react";

import type { Toast } from "./types";

export function shellStyle(embedded = false): CSSProperties {
  return {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "220px minmax(0, 1fr)",
    height: embedded ? "calc(100vh - 76px)" : "calc(100vh - 60px)",
    minHeight: embedded ? "calc(100vh - 76px)" : "calc(100vh - 60px)",
    fontFamily: "var(--x-font-sans)",
    color: "var(--x-color-ink)",
    borderRadius: embedded ? "8px" : undefined,
    overflow: "hidden",
    boxSizing: "border-box",
    background: embedded
      ? "var(--x-color-panel)"
      : "linear-gradient(180deg, var(--x-color-canvas), #f8fbff)",
    border: embedded ? "1px solid var(--x-color-line-soft)" : undefined,
    boxShadow: embedded ? "0 1px 2px var(--x-color-shadow-soft)" : undefined,
  };
}

export const backdropStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "transparent",
  pointerEvents: "none",
};

export const sidebarStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  borderRight: "1px solid var(--x-color-line)",
  padding: "10px",
  background: "var(--x-color-panel)",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  minHeight: 0,
};

export const brandStyle: CSSProperties = {
  borderRadius: "6px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  padding: "8px 10px",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "none",
};

export const brandLabelStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  opacity: 0.76,
};

export const brandPathStyle: CSSProperties = {
  marginTop: "4px",
  fontSize: "12px",
  fontWeight: 600,
  wordBreak: "break-all",
};

export const sidebarSectionTitle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

export const treeScrollStyle: CSSProperties = {
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  minHeight: 0,
  flex: "1 1 auto",
};

export const mainStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  padding: "10px",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  minHeight: 0,
  overflow: "auto",
};

export const heroStyle: CSSProperties = {
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "none",
  padding: "10px 12px",
  display: "flex",
  justifyContent: "space-between",
  gap: "10px",
  alignItems: "center",
};

export const heroEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--x-color-accent)",
};

export const heroTitleStyle: CSSProperties = {
  margin: "4px 0 2px",
  fontSize: "20px",
  lineHeight: 1,
};

export const heroCopyStyle: CSSProperties = {
  margin: 0,
  maxWidth: "60ch",
  color: "var(--x-color-ink-muted)",
};

export const heroActionsStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  alignSelf: "flex-start",
};

export const toolbarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
  alignItems: "center",
};

export const breadcrumbStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

export const toolbarRightStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  alignItems: "center",
};

export const searchInputStyle: CSSProperties = {
  width: "220px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  padding: "6px 8px",
  color: "var(--x-color-ink)",
  outline: "none",
  minHeight: "32px",
  fontSize: "13px",
};

export const workspaceStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 300px",
  gap: "10px",
  alignItems: "start",
};

export const contentStyle: CSSProperties = {
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  boxShadow: "none",
  border: "1px solid var(--x-color-line-soft)",
  overflow: "hidden",
};

export const detailPanelStyle: CSSProperties = {
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  boxShadow: "none",
  border: "1px solid var(--x-color-line-soft)",
  padding: "10px",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  position: "sticky",
  top: "68px",
};

export const actionBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
  padding: "8px 10px",
  borderBottom: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
};

export const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(136px, 1fr))",
  gap: "8px",
  padding: "10px",
};

export const listTableStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  padding: "10px",
};

export const paginationStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  justifyContent: "center",
  padding: "10px",
  borderTop: "1px solid var(--x-color-line)",
};

export const trashPanelStyle: CSSProperties = {
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  boxShadow: "none",
  border: "1px solid var(--x-color-line-soft)",
  padding: "10px",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};

export const trashHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

export const trashSubStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
};

export const trashRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  padding: "8px 10px",
  borderRadius: "6px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line)",
};

export const trashPathStyle: CSSProperties = {
  fontWeight: 600,
  wordBreak: "break-all",
};

export const trashMetaStyle: CSSProperties = {
  marginTop: "4px",
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
};

export const detailTitleStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
};

export const detailNameStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 700,
};

export const detailPathStyle: CSSProperties = {
  fontFamily: "var(--x-font-mono)",
  color: "var(--x-color-ink-muted)",
  wordBreak: "break-all",
};

export const detailMetaGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "6px",
};

export const detailMetaCardStyle: CSSProperties = {
  padding: "8px",
  borderRadius: "6px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line)",
};

export const detailMetaLabelStyle: CSSProperties = {
  fontSize: "11px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

export const detailMetaValueStyle: CSSProperties = {
  marginTop: "3px",
  fontWeight: 600,
};

export const detailBlockStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

export const sectionLabelStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
};

export const permissionRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
  padding: "8px",
  borderRadius: "6px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line)",
};

export const permissionMainStyle: CSSProperties = {
  fontWeight: 600,
};

export const permissionSubStyle: CSSProperties = {
  marginTop: "4px",
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
};

export const historyRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  padding: "10px 0",
  borderBottom: "1px solid var(--x-color-line)",
};

export const historyActionStyle: CSSProperties = {
  textTransform: "capitalize",
  fontWeight: 600,
};

export const historyTimeStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
};

export const emptyPanelStyle: CSSProperties = {
  padding: "10px",
  borderRadius: "6px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
};

export const emptyStateStyle: CSSProperties = {
  padding: "24px 10px",
  color: "var(--x-color-ink-muted)",
};

export const loadingBadgeStyle: CSSProperties = {
  position: "fixed",
  right: "24px",
  bottom: "24px",
  padding: "8px 10px",
  borderRadius: "6px",
  background: "var(--x-color-ink)",
  color: "white",
  boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
};

export function toastStyle(tone: Toast["tone"]): CSSProperties {
  const bg =
    tone === "success"
      ? "var(--x-color-success)"
      : tone === "error"
        ? "var(--x-color-danger)"
        : "var(--x-color-info)";
  return {
    position: "fixed",
    left: "50%",
    bottom: "24px",
    transform: "translateX(-50%)",
    padding: "8px 10px",
    borderRadius: "6px",
    background: bg,
    color: "white",
    boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
    zIndex: 30,
  };
}

export const primaryButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "6px",
  padding: "7px 10px",
  background: "var(--x-color-accent)",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "13px",
};

export const secondaryButtonStyle: CSSProperties = {
  border: "1px solid var(--x-color-line)",
  borderRadius: "6px",
  padding: "7px 10px",
  background: "white",
  color: "var(--x-color-ink)",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: "13px",
};

export const ghostButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  background: "var(--x-color-panel-alt)",
};

export const dangerButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "6px",
  padding: "7px 10px",
  background: "var(--x-color-danger)",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "13px",
};

export const tinyDangerButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "6px",
  padding: "6px 8px",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 700,
  cursor: "pointer",
};

export const crumbButtonStyle: CSSProperties = {
  border: "1px solid var(--x-color-line)",
  borderRadius: "6px",
  padding: "6px 8px",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
};

export function cardStyle(selected: boolean): CSSProperties {
  return {
    borderRadius: "6px",
    border: `1px solid ${selected ? "var(--x-color-accent)" : "var(--x-color-line)"}`,
    background: selected ? "var(--x-color-accent-soft)" : "white",
    minHeight: "112px",
    padding: "10px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    cursor: "pointer",
    boxShadow: "none",
  };
}

export function cardIconStyle(isDir: boolean): CSSProperties {
  return {
    fontSize: "22px",
    color: isDir ? "var(--x-color-warning)" : "var(--x-color-info)",
  };
}

export const cardNameStyle: CSSProperties = {
  fontWeight: 700,
  lineHeight: 1.3,
  wordBreak: "break-word",
};

export const cardMetaStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
};

export function listRowStyle(selected: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "minmax(0, 200px) minmax(0, 1fr) 100px",
    gap: "8px",
    alignItems: "center",
    padding: "8px 10px",
    borderRadius: "6px",
    background: selected ? "var(--x-color-accent-soft)" : "white",
    border: `1px solid ${selected ? "var(--x-color-accent)" : "var(--x-color-line)"}`,
    cursor: "pointer",
  };
}

export const listNameStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  alignItems: "center",
  fontWeight: 700,
};

export const listMetaStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
  wordBreak: "break-all",
};

export function pageButtonStyle(active: boolean): CSSProperties {
  return {
    width: "34px",
    height: "30px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: active ? "var(--x-color-accent)" : "white",
    color: active ? "white" : "var(--x-color-ink)",
    cursor: "pointer",
  };
}

export function treeButtonStyle(active: boolean): CSSProperties {
  return {
    border: "1px solid transparent",
    borderRadius: "6px",
    padding: "6px 8px",
    textAlign: "left",
    background: active ? "var(--x-color-accent-soft)" : "transparent",
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink)",
    cursor: "pointer",
    fontFamily: "var(--x-font-mono)",
    fontSize: "13px",
  };
}
