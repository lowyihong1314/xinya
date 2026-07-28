import type { CSSProperties } from "react";

export const rootStyle = (isMobile: boolean): CSSProperties => ({
  position: "relative",
  display: "flex",
  flexDirection: "column",
  height: isMobile ? "calc(100vh - 64px)" : "calc(100vh - 76px)",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  borderRadius: "var(--x-radius-md)",
  overflow: "hidden",
  fontFamily: "var(--x-font-sans)",
  color: "var(--x-color-ink)",
});

export const topBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 14px",
  borderBottom: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  flexWrap: "wrap",
};

export const iconButtonStyle = (active = false): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  borderRadius: 8,
  border: "1px solid var(--x-color-line)",
  background: active ? "var(--x-color-accent-soft)" : "var(--x-color-panel)",
  color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)",
  cursor: "pointer",
  fontSize: 13,
});

export const breadcrumbStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 2,
  flex: 1,
  minWidth: 160,
  overflow: "hidden",
  whiteSpace: "nowrap",
};

export const breadcrumbLinkStyle = (isCurrent: boolean): CSSProperties => ({
  border: "none",
  background: "transparent",
  padding: "4px 6px",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: isCurrent ? 700 : 500,
  color: isCurrent ? "var(--x-color-ink)" : "var(--x-color-ink-muted)",
  cursor: isCurrent ? "default" : "pointer",
  maxWidth: 180,
  overflow: "hidden",
  textOverflow: "ellipsis",
});

export const breadcrumbSeparatorStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: 11,
};

export const searchBoxStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid var(--x-color-line)",
  borderRadius: 999,
  padding: "5px 12px",
  background: "var(--x-color-panel-alt)",
  minWidth: 200,
};

export const searchInputStyle: CSSProperties = {
  border: "none",
  outline: "none",
  background: "transparent",
  fontSize: 13,
  width: 170,
  color: "var(--x-color-ink)",
};

export const toolbarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 14px",
  borderBottom: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
  flexWrap: "wrap",
  minHeight: 46,
};

export const primaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "none",
  borderRadius: 8,
  padding: "7px 14px",
  background: "var(--x-color-accent)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

export const softButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  borderRadius: 8,
  padding: "7px 12px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

export const dangerButtonStyle: CSSProperties = {
  ...softButtonStyle,
  color: "var(--x-color-danger)",
  border: "1px solid var(--x-color-danger-border)",
};

export const selectionBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  width: "100%",
};

export const selectionCountStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "var(--x-color-accent-strong)",
  marginRight: 4,
};

export const bodyStyle: CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
};

export const treeSidebarStyle = (collapsed: boolean): CSSProperties => ({
  width: collapsed ? 0 : 220,
  minWidth: collapsed ? 0 : 220,
  overflowY: "auto",
  overflowX: "hidden",
  borderRight: collapsed ? "none" : "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  padding: collapsed ? 0 : "10px 8px",
  transition: "width 0.15s ease",
});

export const treeNodeStyle = (active: boolean, depth: number, dropTarget: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  border: dropTarget ? "1px dashed var(--x-color-accent)" : "1px solid transparent",
  borderRadius: 8,
  padding: "5px 8px",
  paddingLeft: 8 + depth * 14,
  background: active ? "var(--x-color-accent-soft)" : dropTarget ? "var(--x-color-accent-tint)" : "transparent",
  color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink)",
  fontSize: 13,
  fontWeight: active ? 700 : 500,
  cursor: "pointer",
  textAlign: "left",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
});

export const treeToggleStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--x-color-ink-muted)",
  cursor: "pointer",
  width: 18,
  fontSize: 11,
  flexShrink: 0,
};

export const mainStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  background: "var(--x-color-panel)",
};

export const listHeaderStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(200px, 1fr) 110px 150px 120px 40px",
  gap: 8,
  padding: "8px 16px",
  borderBottom: "1px solid var(--x-color-line-soft)",
  position: "sticky",
  top: 0,
  background: "var(--x-color-panel)",
  zIndex: 2,
};

export const listHeaderCellStyle = (sortable: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 5,
  border: "none",
  background: "transparent",
  padding: 0,
  fontSize: 12,
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
  cursor: sortable ? "pointer" : "default",
  textAlign: "left",
});

export const listRowStyle = (selected: boolean, dropTarget: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: "minmax(200px, 1fr) 110px 150px 120px 40px",
  gap: 8,
  alignItems: "center",
  padding: "7px 16px",
  borderBottom: "1px solid var(--x-color-line-soft)",
  background: selected
    ? "var(--x-color-accent-soft)"
    : dropTarget
      ? "var(--x-color-accent-tint)"
      : "transparent",
  outline: dropTarget ? "1px dashed var(--x-color-accent)" : "none",
  outlineOffset: -1,
  cursor: "default",
  userSelect: "none",
  fontSize: 13,
});

export const listNameCellStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
};

export const itemIconStyle = (isDir: boolean): CSSProperties => ({
  color: isDir ? "var(--x-color-warning)" : "var(--x-color-ink-muted)",
  fontSize: 15,
  width: 18,
  textAlign: "center",
  flexShrink: 0,
});

export const listMetaCellStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--x-color-ink-muted)",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
};

export const gridContainerStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
  gap: 12,
  padding: 16,
};

export const gridCardStyle = (selected: boolean, dropTarget: boolean): CSSProperties => ({
  position: "relative",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
  padding: "18px 10px 12px",
  borderRadius: "var(--x-radius-sm)",
  border: selected
    ? "1px solid var(--x-color-accent-border)"
    : dropTarget
      ? "1px dashed var(--x-color-accent)"
      : "1px solid var(--x-color-line-soft)",
  background: selected ? "var(--x-color-accent-soft)" : dropTarget ? "var(--x-color-accent-tint)" : "var(--x-color-panel)",
  cursor: "default",
  userSelect: "none",
  textAlign: "center",
  overflow: "hidden",
});

export const gridIconStyle = (isDir: boolean): CSSProperties => ({
  fontSize: 34,
  color: isDir ? "var(--x-color-warning)" : "var(--x-color-ink-muted)",
});

export const gridNameStyle: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  width: "100%",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
};

export const gridMetaStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--x-color-ink-muted)",
};

export const statusBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "7px 16px",
  borderTop: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
  fontSize: 12,
  color: "var(--x-color-ink-muted)",
};

export const emptyStateStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: "60px 20px",
  color: "var(--x-color-ink-muted)",
  fontSize: 13,
};

export const contextMenuStyle = (x: number, y: number): CSSProperties => ({
  position: "fixed",
  left: x,
  top: y,
  zIndex: 1200,
  minWidth: 180,
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  borderRadius: "var(--x-radius-sm)",
  boxShadow: "0 12px 32px var(--x-color-shadow)",
  padding: 6,
});

export const contextMenuItemStyle = (danger = false): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  border: "none",
  background: "transparent",
  padding: "8px 10px",
  borderRadius: 6,
  fontSize: 13,
  color: danger ? "var(--x-color-danger)" : "var(--x-color-ink)",
  cursor: "pointer",
  textAlign: "left",
});

export const contextMenuDividerStyle: CSSProperties = {
  height: 1,
  background: "var(--x-color-line-soft)",
  margin: "4px 0",
};

export const drawerStyle = (open: boolean, isMobile: boolean): CSSProperties => ({
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  width: isMobile ? "100%" : 340,
  background: "var(--x-color-panel)",
  borderLeft: "1px solid var(--x-color-line)",
  boxShadow: open ? "-12px 0 32px var(--x-color-shadow-soft)" : "none",
  transform: open ? "translateX(0)" : "translateX(105%)",
  transition: "transform 0.18s ease",
  zIndex: 30,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
});

export const drawerHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "12px 16px",
  borderBottom: "1px solid var(--x-color-line-soft)",
};

export const drawerBodyStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "12px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

export const drawerSectionTitleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  marginBottom: 6,
};

export const metaRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 13,
  padding: "3px 0",
};

export const metaLabelStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  flexShrink: 0,
};

export const metaValueStyle: CSSProperties = {
  textAlign: "right",
  overflowWrap: "anywhere",
};

export const permissionRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "6px 8px",
  borderRadius: 8,
  background: "var(--x-color-panel-alt)",
  fontSize: 12.5,
  marginBottom: 6,
};

export const permissionBadgeStyle = (permission: string): CSSProperties => ({
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  background:
    permission === "read_write"
      ? "var(--x-color-accent-soft)"
      : permission === "read_public"
        ? "var(--x-color-info-soft)"
        : "var(--x-color-warning-soft)",
  color:
    permission === "read_write"
      ? "var(--x-color-accent-strong)"
      : permission === "read_public"
        ? "var(--x-color-info)"
        : "var(--x-color-warning)",
});

export const dialogOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.42)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1300,
  padding: 16,
};

export const dialogCardStyle: CSSProperties = {
  width: "min(440px, 100%)",
  background: "var(--x-color-panel)",
  borderRadius: "var(--x-radius-md)",
  boxShadow: "0 24px 64px var(--x-color-shadow)",
  padding: 20,
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

export const dialogTitleStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  margin: 0,
};

export const dialogLabelStyle: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--x-color-ink-muted)",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

export const dialogInputStyle: CSSProperties = {
  border: "1px solid var(--x-color-line)",
  borderRadius: 8,
  padding: "9px 12px",
  fontSize: 13.5,
  color: "var(--x-color-ink)",
  background: "var(--x-color-panel)",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

export const dialogFooterStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};

export const moveTreeContainerStyle: CSSProperties = {
  maxHeight: 280,
  overflowY: "auto",
  border: "1px solid var(--x-color-line-soft)",
  borderRadius: 8,
  padding: 6,
};

export const dropOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 10,
  zIndex: 50,
  border: "2px dashed var(--x-color-accent)",
  borderRadius: "var(--x-radius-md)",
  background: "rgba(15, 118, 110, 0.08)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  color: "var(--x-color-accent-strong)",
  fontSize: 15,
  fontWeight: 700,
  pointerEvents: "none",
};

export const toastStyle = (tone: "success" | "error" | "info"): CSSProperties => ({
  position: "absolute",
  bottom: 18,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 1400,
  padding: "10px 18px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  color: "#fff",
  background:
    tone === "success"
      ? "var(--x-color-success)"
      : tone === "error"
        ? "var(--x-color-danger)"
        : "var(--x-color-info)",
  boxShadow: "0 10px 26px var(--x-color-shadow)",
  maxWidth: "90%",
});

export const loadingOverlayStyle: CSSProperties = {
  position: "absolute",
  top: 12,
  right: 16,
  zIndex: 40,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
  borderRadius: 999,
  background: "var(--x-color-panel-strong)",
  border: "1px solid var(--x-color-line-soft)",
  fontSize: 12,
  color: "var(--x-color-ink-muted)",
  boxShadow: "0 6px 18px var(--x-color-shadow-soft)",
};

export const previewOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1350,
  background: "rgba(10, 14, 22, 0.86)",
  display: "flex",
  flexDirection: "column",
};

export const previewHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 18px",
  color: "#fff",
};

export const previewBodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 18px 18px",
};

export const previewTextStyle: CSSProperties = {
  width: "min(860px, 100%)",
  maxHeight: "100%",
  overflow: "auto",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  borderRadius: "var(--x-radius-sm)",
  padding: 18,
  fontFamily: "var(--x-font-mono)",
  fontSize: 12.5,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

export const trashPanelStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 60,
  background: "var(--x-color-panel)",
  display: "flex",
  flexDirection: "column",
};

export const trashRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 16px",
  borderBottom: "1px solid var(--x-color-line-soft)",
  fontSize: 13,
};

export const searchResultPathStyle: CSSProperties = {
  fontSize: 11.5,
  color: "var(--x-color-ink-muted)",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
};
