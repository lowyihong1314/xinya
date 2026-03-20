import type { CSSProperties } from "react";

import type { Toast } from "./types";

export function shellStyle(embedded = false): CSSProperties {
  return {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "280px minmax(0, 1fr)",
    minHeight: embedded ? "720px" : "calc(100vh - 60px)",
    fontFamily: "var(--x-font-sans)",
    color: "var(--x-color-ink)",
    borderRadius: embedded ? "var(--x-radius-lg)" : undefined,
    overflow: "hidden",
    background: embedded
      ? "linear-gradient(180deg, var(--x-color-panel), var(--x-color-panel-alt))"
      : "radial-gradient(circle at top left, rgba(15,118,110,0.16), transparent 28%), linear-gradient(180deg, var(--x-color-canvas), #f8fbff)",
    border: embedded ? "1px solid var(--x-color-line-soft)" : undefined,
    boxShadow: embedded ? "0 12px 28px var(--x-color-shadow-soft)" : undefined,
  };
}

export const backdropStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background:
    "linear-gradient(120deg, rgba(15,118,110,0.08), rgba(29,78,216,0.06) 52%, rgba(255,255,255,0) 82%)",
  pointerEvents: "none",
};

export const sidebarStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  borderRight: "1px solid var(--x-color-line)",
  padding: "24px 18px",
  background: "rgba(255,255,255,0.76)",
  backdropFilter: "blur(18px)",
  display: "flex",
  flexDirection: "column",
  gap: "14px",
};

export const brandStyle: CSSProperties = {
  borderRadius: "var(--x-radius-lg)",
  background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
  color: "white",
  padding: "18px",
  boxShadow: "0 18px 40px rgba(15, 118, 110, 0.18)",
};

export const brandLabelStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  opacity: 0.76,
};

export const brandPathStyle: CSSProperties = {
  marginTop: "10px",
  fontSize: "15px",
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
  gap: "8px",
};

export const mainStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  padding: "20px",
  display: "flex",
  flexDirection: "column",
  gap: "18px",
};

export const heroStyle: CSSProperties = {
  borderRadius: "var(--x-radius-lg)",
  background: "rgba(255,255,255,0.84)",
  border: "1px solid rgba(255,255,255,0.68)",
  boxShadow: "0 24px 60px var(--x-color-shadow)",
  padding: "28px 30px",
  display: "flex",
  justifyContent: "space-between",
  gap: "18px",
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
  margin: "10px 0 8px",
  fontSize: "34px",
  lineHeight: 1,
};

export const heroCopyStyle: CSSProperties = {
  margin: 0,
  maxWidth: "60ch",
  color: "var(--x-color-ink-muted)",
};

export const heroActionsStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  alignSelf: "flex-start",
};

export const toolbarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "center",
};

export const breadcrumbStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

export const toolbarRightStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  alignItems: "center",
};

export const searchInputStyle: CSSProperties = {
  width: "260px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line)",
  background: "rgba(255,255,255,0.82)",
  padding: "12px 16px",
  color: "var(--x-color-ink)",
  outline: "none",
};

export const workspaceStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 340px",
  gap: "18px",
  alignItems: "start",
};

export const contentStyle: CSSProperties = {
  borderRadius: "var(--x-radius-lg)",
  background: "rgba(255,255,255,0.88)",
  boxShadow: "0 24px 60px var(--x-color-shadow)",
  border: "1px solid rgba(255,255,255,0.72)",
  overflow: "hidden",
};

export const detailPanelStyle: CSSProperties = {
  borderRadius: "var(--x-radius-lg)",
  background: "rgba(255,255,255,0.88)",
  boxShadow: "0 24px 60px var(--x-color-shadow)",
  border: "1px solid rgba(255,255,255,0.72)",
  padding: "20px",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  position: "sticky",
  top: "84px",
};

export const actionBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  padding: "18px",
  borderBottom: "1px solid var(--x-color-line)",
  background: "linear-gradient(180deg, rgba(15,118,110,0.05), rgba(255,255,255,0.9))",
};

export const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
  gap: "14px",
  padding: "18px",
};

export const listTableStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  padding: "18px",
};

export const paginationStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  justifyContent: "center",
  padding: "18px",
  borderTop: "1px solid var(--x-color-line)",
};

export const trashPanelStyle: CSSProperties = {
  borderRadius: "var(--x-radius-lg)",
  background: "rgba(255,255,255,0.92)",
  boxShadow: "0 24px 60px var(--x-color-shadow)",
  border: "1px solid rgba(255,255,255,0.72)",
  padding: "18px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
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
  padding: "14px",
  borderRadius: "var(--x-radius-md)",
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
  fontSize: "22px",
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
  gap: "10px",
};

export const detailMetaCardStyle: CSSProperties = {
  padding: "12px",
  borderRadius: "var(--x-radius-md)",
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
  marginTop: "6px",
  fontWeight: 600,
};

export const detailBlockStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
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
  gap: "12px",
  alignItems: "center",
  padding: "12px",
  borderRadius: "var(--x-radius-md)",
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
  padding: "18px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
};

export const emptyStateStyle: CSSProperties = {
  padding: "40px 18px",
  color: "var(--x-color-ink-muted)",
};

export const loadingBadgeStyle: CSSProperties = {
  position: "fixed",
  right: "24px",
  bottom: "24px",
  padding: "12px 16px",
  borderRadius: "999px",
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
    padding: "12px 18px",
    borderRadius: "999px",
    background: bg,
    color: "white",
    boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
    zIndex: 30,
  };
}

export const primaryButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "999px",
  padding: "11px 16px",
  background: "var(--x-color-accent)",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

export const secondaryButtonStyle: CSSProperties = {
  border: "1px solid var(--x-color-line)",
  borderRadius: "999px",
  padding: "11px 16px",
  background: "white",
  color: "var(--x-color-ink)",
  fontWeight: 600,
  cursor: "pointer",
};

export const ghostButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  background: "var(--x-color-panel-alt)",
};

export const dangerButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "999px",
  padding: "11px 16px",
  background: "var(--x-color-danger)",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

export const tinyDangerButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "999px",
  padding: "8px 12px",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 700,
  cursor: "pointer",
};

export const crumbButtonStyle: CSSProperties = {
  border: "1px solid var(--x-color-line)",
  borderRadius: "999px",
  padding: "8px 12px",
  background: "rgba(255,255,255,0.84)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
};

export function cardStyle(selected: boolean): CSSProperties {
  return {
    borderRadius: "var(--x-radius-md)",
    border: `1px solid ${selected ? "var(--x-color-accent)" : "var(--x-color-line)"}`,
    background: selected ? "var(--x-color-accent-soft)" : "white",
    minHeight: "154px",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    cursor: "pointer",
    boxShadow: selected ? "0 14px 28px rgba(15,118,110,0.12)" : "none",
  };
}

export function cardIconStyle(isDir: boolean): CSSProperties {
  return {
    fontSize: "30px",
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
    gridTemplateColumns: "minmax(0, 220px) minmax(0, 1fr) 120px",
    gap: "16px",
    alignItems: "center",
    padding: "14px 16px",
    borderRadius: "var(--x-radius-md)",
    background: selected ? "var(--x-color-accent-soft)" : "white",
    border: `1px solid ${selected ? "var(--x-color-accent)" : "var(--x-color-line)"}`,
    cursor: "pointer",
  };
}

export const listNameStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
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
    height: "34px",
    borderRadius: "999px",
    border: "1px solid var(--x-color-line)",
    background: active ? "var(--x-color-accent)" : "white",
    color: active ? "white" : "var(--x-color-ink)",
    cursor: "pointer",
  };
}

export function treeButtonStyle(active: boolean): CSSProperties {
  return {
    border: "1px solid transparent",
    borderRadius: "var(--x-radius-sm)",
    padding: "10px 12px",
    textAlign: "left",
    background: active ? "var(--x-color-accent-soft)" : "transparent",
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink)",
    cursor: "pointer",
    fontFamily: "var(--x-font-mono)",
    fontSize: "13px",
  };
}
