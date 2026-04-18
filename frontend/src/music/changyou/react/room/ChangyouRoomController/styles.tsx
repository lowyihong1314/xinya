import type { CSSProperties } from "react";

export const pageStyle = (hideNav: boolean): CSSProperties => ({
  minHeight: hideNav ? "100vh" : "calc(100vh - 60px)",
  padding: "20px",
  background:
    "radial-gradient(circle at top left, rgba(15,118,110,0.12), transparent 24%), linear-gradient(180deg, var(--x-color-canvas), var(--x-color-canvas-alt))",
  boxSizing: "border-box",
  overflowX: "hidden",
});

export const pageInnerStyle: CSSProperties = {
  width: "100%",
  maxWidth: "1600px",
  margin: "0 auto",
  display: "grid",
  gap: "16px",
};

export const topBarStyle = (isMobile: boolean): CSSProperties => ({
  display: "flex",
  justifyContent: "space-between",
  alignItems: isMobile ? "stretch" : "center",
  flexDirection: isMobile ? "column" : "row",
  gap: "12px",
});

export const topBarActionsStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

export const backButtonStyle = (isMobile: boolean): CSSProperties => ({
  alignSelf: "flex-start",
  padding: "12px 16px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
  width: isMobile ? "100%" : undefined,
});

export const ghostButtonStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-strongest)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
};

export const togglePillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "10px 14px",
  borderRadius: "999px",
  background: "var(--x-color-panel-strongest)",
  border: "1px solid var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
};

export const layoutStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.8fr) minmax(320px, 0.9fr)",
  gap: "18px",
  alignItems: "start",
});

export const mainColumnStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
};

export const heroCardStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "28px",
  background: "linear-gradient(145deg, rgba(255,255,255,0.9), rgba(240,248,255,0.82))",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 20px 40px var(--x-color-shadow-soft)",
  display: "grid",
  gap: "18px",
};

export const workflowSwitchStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
  gap: "12px",
});

export const workflowTabStyle = (active: boolean): CSSProperties => ({
  padding: "16px 18px",
  borderRadius: "20px",
  border: active ? "1px solid rgba(15,118,110,0.26)" : "1px solid var(--x-color-line-soft)",
  background: active
    ? "linear-gradient(180deg, rgba(15,118,110,0.14), rgba(255,255,255,0.94))"
    : "rgba(255,255,255,0.78)",
  color: "var(--x-color-ink)",
  fontWeight: 900,
  cursor: "pointer",
  boxShadow: active ? "0 16px 30px rgba(15,118,110,0.1)" : "none",
});

export const heroHeaderStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.4fr) minmax(260px, 1fr)",
  gap: "18px",
};

export const heroTitleWrapStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

export const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};

export const heroTitleStyle = (isMobile: boolean): CSSProperties => ({
  margin: 0,
  fontSize: isMobile ? "34px" : "44px",
  lineHeight: 1.05,
  color: "var(--x-color-ink)",
});

export const heroCopyStyle: CSSProperties = {
  margin: 0,
  fontSize: "14px",
  lineHeight: 1.8,
  color: "var(--x-color-ink-muted)",
};

export const heroStatGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "10px",
};

export const metaWrapStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
};

export const metaPillStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.76)",
  border: "1px solid var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 800,
};

export const projectionHubStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
};

export const projectionTopStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 170px",
  gap: "14px",
  padding: "18px",
  borderRadius: "24px",
  background: "linear-gradient(180deg, var(--x-color-panel-strongest), var(--x-color-panel))",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 18px 34px var(--x-color-shadow-soft)",
});

export const roomSummaryStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

export const roomSummaryLineStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

export const roomSummaryHintStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

export const roomActionRowStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

export const qrCardStyle: CSSProperties = {
  borderRadius: "22px",
  border: "1px solid var(--x-color-line-soft)",
  background: "rgba(255,255,255,0.86)",
  display: "grid",
  placeItems: "center",
  alignContent: "center",
  gap: "8px",
  padding: "12px",
};

export const qrStyle: CSSProperties = {
  width: "100%",
  maxWidth: "124px",
  borderRadius: "16px",
  background: "white",
};

export const qrPlaceholderStyle: CSSProperties = {
  width: "124px",
  height: "124px",
  borderRadius: "18px",
  display: "grid",
  placeItems: "center",
  background: "var(--x-color-panel-glass)",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};

export const qrCaptionStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  color: "var(--x-color-ink-muted)",
};

export const collapseCardStyle: CSSProperties = {
  borderRadius: "24px",
  background: "linear-gradient(180deg, var(--x-color-panel-strongest), var(--x-color-panel))",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 18px 34px var(--x-color-shadow-soft)",
  overflow: "hidden",
};

export const collapseHeaderStyle: CSSProperties = {
  width: "100%",
  padding: "18px",
  border: "none",
  background: "transparent",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  textAlign: "left",
  cursor: "pointer",
};

export const collapseSubtitleStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "13px",
  lineHeight: 1.6,
  color: "var(--x-color-ink-muted)",
};

export const collapseArrowStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  color: "var(--x-color-ink-muted)",
};

export const collapseBodyStyle: CSSProperties = {
  padding: "0 18px 18px",
  display: "grid",
  gap: "14px",
};

export const controlCardStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "20px",
  background: "linear-gradient(135deg, rgba(8,47,73,0.96), rgba(15,118,110,0.92))",
  border: "1px solid rgba(125,211,252,0.14)",
  boxShadow: "0 14px 28px rgba(8,47,73,0.18)",
  display: "grid",
  gap: "10px",
};

export const sectionTitleStyle: CSSProperties = {
  fontSize: "20px",
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

export const sectionLabelStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};

export const roomCardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};

export const roomCardStyle = (active: boolean): CSSProperties => ({
  padding: "16px",
  borderRadius: "18px",
  border: active ? "1px solid rgba(15,118,110,0.28)" : "1px solid var(--x-color-line-soft)",
  background: active ? "rgba(15,118,110,0.12)" : "rgba(255,255,255,0.78)",
  display: "grid",
  gap: "6px",
  textAlign: "left",
  cursor: "pointer",
});

export const roomCardTitleStyle: CSSProperties = {
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

export const roomCardMetaStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

export const versionCardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};

export const versionCardStyle = (active: boolean): CSSProperties => ({
  padding: "16px",
  borderRadius: "18px",
  border: active ? "1px solid rgba(59,130,246,0.28)" : "1px solid var(--x-color-line-soft)",
  background: active ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.78)",
  display: "grid",
  gap: "6px",
  textAlign: "left",
  cursor: "pointer",
});

export const versionCardTitleStyle: CSSProperties = {
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

export const versionCardMetaStyle: CSSProperties = {
  fontSize: "12px",
  lineHeight: 1.6,
  color: "var(--x-color-ink-muted)",
};

export const setupSummaryStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "20px",
  border: "1px solid var(--x-color-line-soft)",
  background: "rgba(255,255,255,0.78)",
  display: "grid",
  gap: "8px",
};

export const setupSummaryTitleStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

export const setupSummaryMetaStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

export const pageToolbarStyle = (isMobile: boolean): CSSProperties => ({
  display: "flex",
  justifyContent: "space-between",
  alignItems: isMobile ? "stretch" : "center",
  flexDirection: isMobile ? "column" : "row",
  gap: "10px",
});

export const pageBatchInfoStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  color: "var(--x-color-ink-muted)",
};

export const pageToolbarActionsStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

export const pageGridStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
  gap: "12px",
});

export const pageCardStyle = (active: boolean): CSSProperties => ({
  padding: "16px",
  borderRadius: "20px",
  border: active ? "1px solid rgba(245,158,11,0.3)" : "1px solid var(--x-color-line-soft)",
  background: active ? "linear-gradient(180deg, rgba(251,191,36,0.14), rgba(255,255,255,0.92))" : "rgba(255,255,255,0.82)",
  display: "grid",
  gap: "10px",
  textAlign: "left",
  cursor: "pointer",
});

export const pageCardTopStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
};

export const pageCardTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

export const pageCardSnippetStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

export const pageChipStyle = (active: boolean): CSSProperties => ({
  padding: "6px 10px",
  borderRadius: "999px",
  background: active ? "rgba(245,158,11,0.18)" : "rgba(15,23,42,0.08)",
  color: active ? "#92400e" : "var(--x-color-ink-muted)",
  fontSize: "11px",
  fontWeight: 900,
});

export const pageActiveBadgeStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 900,
  color: "#92400e",
};

export const controlToolbarStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: isMobile ? "1fr" : "auto minmax(0, 1fr)",
  alignItems: "center",
  gap: "10px",
});

export const controlHeadingStyle: CSSProperties = {
  display: "grid",
  gap: "2px",
  alignContent: "center",
};

export const controlTitleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 900,
  color: "#f0fdfa",
};

export const controlHintStyle: CSSProperties = {
  fontSize: "11px",
  lineHeight: 1.5,
  color: "rgba(240,253,250,0.72)",
};

export const controlToolbarRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  alignItems: "center",
  justifyContent: "flex-end",
};

export const primaryButtonStyle: CSSProperties = {
  padding: "13px 18px",
  borderRadius: "14px",
  border: "none",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

export const smallPrimaryButtonStyle: CSSProperties = {
  padding: "9px 12px",
  borderRadius: "12px",
  border: "none",
  background: "linear-gradient(135deg, #f97316, #f59e0b)",
  color: "white",
  fontSize: "12px",
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const secondaryButtonStyle: CSSProperties = {
  padding: "13px 18px",
  borderRadius: "14px",
  border: "1px solid rgba(15,118,110,0.2)",
  background: "rgba(255,255,255,0.88)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
};

export const smallSecondaryButtonStyle: CSSProperties = {
  padding: "9px 12px",
  borderRadius: "12px",
  border: "1px solid rgba(191,219,254,0.24)",
  background: "rgba(255,255,255,0.14)",
  color: "#eff6ff",
  fontSize: "12px",
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const smallGhostButtonStyle: CSSProperties = {
  padding: "9px 12px",
  borderRadius: "12px",
  border: "1px solid rgba(226,232,240,0.16)",
  background: "rgba(15,23,42,0.18)",
  color: "rgba(240,253,250,0.9)",
  fontSize: "12px",
  fontWeight: 800,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const dangerButtonStyle: CSSProperties = {
  padding: "13px 18px",
  borderRadius: "14px",
  border: "1px solid rgba(220,38,38,0.2)",
  background: "rgba(254,226,226,0.92)",
  color: "#991b1b",
  fontWeight: 800,
  cursor: "pointer",
};

export const keyHintStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.7,
  color: "rgba(226,232,240,0.82)",
};

export const notifyRowStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto",
  gap: "10px",
});

export const notifyInputStyle: CSSProperties = {
  width: "100%",
  padding: "13px 16px",
  borderRadius: "14px",
  border: "1px solid rgba(148,163,184,0.24)",
  background: "rgba(255,255,255,0.94)",
  boxSizing: "border-box",
};

export const notifyInputCompactStyle: CSSProperties = {
  flex: "1 1 220px",
  minWidth: "180px",
  padding: "9px 12px",
  borderRadius: "12px",
  border: "1px solid rgba(191,219,254,0.18)",
  background: "rgba(255,255,255,0.94)",
  boxSizing: "border-box",
  fontSize: "12px",
};

export const projectionPreviewCardStyle: CSSProperties = {
  padding: 0,
  borderRadius: 0,
  background: "transparent",
  border: "none",
  boxShadow: "none",
  display: "grid",
  gap: "12px",
};

export const projectionPreviewHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
};

export const currentProjectionMetaStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "13px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

export const projectionStageStyle = (isMobile: boolean, hasRightColumn: boolean): CSSProperties => ({
  minHeight: isMobile ? "auto" : "68vh",
  display: "grid",
  gridTemplateColumns: isMobile || !hasRightColumn ? "1fr" : "repeat(2, minmax(0, 1fr))",
  gap: isMobile ? "16px" : "28px",
  alignItems: "start",
  position: "relative",
});

export const contextMenuLayerStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1200,
};

export const contextMenuStyle = (x: number, y: number): CSSProperties => ({
  position: "fixed",
  top: y,
  left: x,
  minWidth: "168px",
  padding: "8px",
  borderRadius: "16px",
  border: "1px solid rgba(15,118,110,0.16)",
  background: "rgba(255,255,255,0.98)",
  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.18)",
  backdropFilter: "blur(14px)",
});

export const contextMenuItemStyle: CSSProperties = {
  width: "100%",
  minHeight: "40px",
  padding: "0 12px",
  border: "none",
  borderRadius: "12px",
  background: "transparent",
  color: "var(--x-color-ink)",
  font: "inherit",
  fontWeight: 800,
  textAlign: "left",
  cursor: "pointer",
};

export const projectionColumnCompactStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  alignContent: "start",
};

export const projectionBlockStyle = (active: boolean, clickable: boolean): CSSProperties => ({
  width: "100%",
  padding: "0",
  borderRadius: "14px",
  border: "none",
  background: active ? "rgba(250,204,21,0.14)" : "transparent",
  boxShadow: "none",
  cursor: clickable ? "pointer" : "default",
  textAlign: "left",
});

export const projectionBlockTextStyle = (fontSize: number): CSSProperties => ({
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: `${fontSize}px`,
  lineHeight: 1.8,
  color: "var(--x-color-ink)",
  tabSize: 8,
  MozTabSize: 8,
  fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  overflowWrap: "anywhere",
  overflowX: "auto",
  boxSizing: "border-box",
});

export const sideCardStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "24px",
  background: "linear-gradient(180deg, var(--x-color-panel-strongest), var(--x-color-panel))",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 16px 34px var(--x-color-shadow-soft)",
  display: "grid",
  gap: "14px",
};

export const settingsBlockStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

export const settingsLabelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

export const chipRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

export const variantChipStyle = (active: boolean): CSSProperties => ({
  padding: "10px 12px",
  borderRadius: "999px",
  border: active ? "1px solid rgba(15,118,110,0.24)" : "1px solid var(--x-color-line)",
  background: active ? "rgba(15,118,110,0.12)" : "var(--x-color-panel-strongest)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
});

export const hintStyle: CSSProperties = {
  fontSize: "12px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

export const fontControlRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  gap: "10px",
  alignItems: "center",
};

export const fontButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-strongest)",
  fontWeight: 800,
  cursor: "pointer",
};

export const fontValueStyle: CSSProperties = {
  textAlign: "center",
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

export const actionStackStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

export const editorWrapStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

export const editorStyle = (fontSize: number): CSSProperties => ({
  width: "100%",
  minHeight: "420px",
  padding: "18px",
  borderRadius: "18px",
  border: "1px solid var(--x-color-line)",
  background: "rgba(255,255,255,0.95)",
  color: "var(--x-color-ink)",
  boxSizing: "border-box",
  fontSize: `${fontSize}px`,
  lineHeight: 1.8,
  fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  tabSize: 8,
  MozTabSize: 8,
});

export const contentStyle = (fontSize: number): CSSProperties => ({
  margin: 0,
  minHeight: "320px",
  maxHeight: "60vh",
  overflow: "auto",
  padding: "18px",
  borderRadius: "20px",
  background: "rgba(255,255,255,0.92)",
  border: "1px solid var(--x-color-line-soft)",
  boxSizing: "border-box",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: `${fontSize}px`,
  lineHeight: 1.8,
  color: "var(--x-color-ink)",
  tabSize: 8,
  MozTabSize: 8,
  fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
});

export const stateStyle: CSSProperties = {
  minHeight: "40vh",
  display: "grid",
  placeItems: "center",
  color: "var(--x-color-ink-muted)",
};

export const errorStyle: CSSProperties = {
  padding: "14px 16px",
  borderRadius: "16px",
  background: "rgba(254,226,226,0.9)",
  border: "1px solid rgba(220,38,38,0.18)",
  color: "#991b1b",
  fontWeight: 700,
};

export const emptyStateStyle: CSSProperties = {
  minHeight: "120px",
  borderRadius: "18px",
  background: "rgba(255,255,255,0.78)",
  border: "1px dashed var(--x-color-line-soft)",
  display: "grid",
  placeItems: "center",
  gap: "10px",
  color: "var(--x-color-ink-muted)",
  padding: "18px",
  textAlign: "center",
};
