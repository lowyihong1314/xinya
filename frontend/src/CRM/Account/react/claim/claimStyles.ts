import type { CSSProperties } from "react";

export const shellStyle: CSSProperties = {
  display: "grid",
  width: "100%",
  height: "100%",
  maxHeight: "100%",
  minHeight: 0,
  padding: "18px",
  borderRadius: "var(--x-radius-lg)",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-strong)",
  boxShadow: "0 16px 36px var(--x-color-shadow-soft)",
  overflow: "hidden",
  boxSizing: "border-box",
};

export const scrollPanelStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  maxHeight: "100%",
  minHeight: 0,
  boxSizing: "border-box",
  overflow: "auto",
  paddingRight: "4px",
};

export const toolbarStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto auto",
  gap: "10px",
  alignItems: "center",
};

export const statsRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  alignItems: "center",
};

export const searchInputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "12px 14px",
  boxSizing: "border-box",
  borderRadius: "14px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  outline: "none",
};

export const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "11px 12px",
  boxSizing: "border-box",
  borderRadius: "12px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  outline: "none",
};

export const textareaStyle: CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  minHeight: "120px",
};

export const buttonPrimaryStyle: CSSProperties = {
  border: "none",
  borderRadius: "12px",
  padding: "11px 16px",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 700,
};

export const buttonSecondaryStyle: CSSProperties = {
  border: "1px solid var(--x-color-line-soft)",
  borderRadius: "12px",
  padding: "11px 16px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
  fontWeight: 600,
};

export const buttonGhostStyle: CSSProperties = {
  border: "1px dashed var(--x-color-line-soft)",
  borderRadius: "12px",
  padding: "11px 16px",
  background: "transparent",
  color: "var(--x-color-ink-muted)",
  cursor: "pointer",
  fontWeight: 600,
};

export const buttonApproveStyle: CSSProperties = {
  ...buttonPrimaryStyle,
  background: "linear-gradient(135deg, var(--x-color-success), var(--x-color-accent))",
};

export const buttonRejectStyle: CSSProperties = {
  ...buttonSecondaryStyle,
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-danger-tint)",
  color: "var(--x-color-danger)",
};

export const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "7px 10px",
  borderRadius: "999px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

export const listStyle: CSSProperties = {
  display: "grid",
  width: "100%",
  minWidth: 0,
  gap: "12px",
};

export const cardButtonStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  border: "1px solid var(--x-color-line-soft)",
  borderRadius: "18px",
  padding: "16px",
  background: "linear-gradient(145deg, var(--x-color-panel-strong), var(--x-color-panel-alt))",
  textAlign: "left",
  cursor: "pointer",
  display: "grid",
  gap: "12px",
};

export const cardTopStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  minWidth: 0,
  gap: "12px",
  alignItems: "start",
};

export const cardTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
};

export const cardMetaStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

export const cardBodyStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.6,
  color: "var(--x-color-ink-muted)",
  whiteSpace: "pre-wrap",
};

export const chipRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

export const paginationRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  flexWrap: "wrap",
  paddingTop: "8px",
  borderTop: "1px solid var(--x-color-line-soft)",
};

export const paginationRowTopStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  flexWrap: "wrap",
};

export const paginationActionsStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  alignItems: "center",
};

export const resultContainerStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  minHeight: "260px",
  maxHeight: "620px",
  overflow: "auto",
  resize: "vertical",
  paddingRight: "4px",
};

export const placeholderStyle: CSSProperties = {
  padding: "26px",
  borderRadius: "16px",
  border: "1px dashed var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  textAlign: "center",
};

export const panelHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
  paddingBottom: "12px",
  borderBottom: "1px solid var(--x-color-line-soft)",
};

export const panelTitleStyle: CSSProperties = {
  fontSize: "20px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
};

export const summaryRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

export function formGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: "14px",
  };
}

export const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

export const wideFieldStyle: CSSProperties = {
  gridColumn: "1 / -1",
};

export const fieldLabelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 600,
  color: "var(--x-color-ink-muted)",
};

export const uploadBoxStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  padding: "12px",
  borderRadius: "12px",
  border: "1px dashed var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
};

export const fileListStyle: CSSProperties = {
  fontSize: "12px",
  lineHeight: 1.6,
  color: "var(--x-color-ink-muted)",
};

export const footerActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "10px",
  flexWrap: "wrap",
  paddingTop: "12px",
  borderTop: "1px solid var(--x-color-line-soft)",
};

export function statusBadgeStyle(status?: string): CSSProperties {
  const palette =
    status === "approved"
      ? {
          background: "var(--x-color-success-tint)",
          border: "var(--x-color-success-border)",
          color: "var(--x-color-success)",
        }
      : status === "rejected"
        ? {
            background: "var(--x-color-danger-tint)",
            border: "var(--x-color-danger-border)",
            color: "var(--x-color-danger)",
          }
        : {
            background: "var(--x-color-warning-tint)",
            border: "var(--x-color-warning-border)",
            color: "var(--x-color-warning)",
          };
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "84px",
    padding: "8px 10px",
    borderRadius: "999px",
    border: `1px solid ${palette.border}`,
    background: palette.background,
    color: palette.color,
    fontSize: "12px",
    fontWeight: 700,
  };
}

export const detailGridStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
  gap: "12px",
});

export const detailRowStyle: CSSProperties = {
  padding: "14px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
  display: "grid",
  gap: "4px",
};

export const detailLabelStyle: CSSProperties = {
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--x-color-ink-muted)",
};

export const detailValueStyle: CSSProperties = {
  fontSize: "14px",
  lineHeight: 1.6,
  color: "var(--x-color-ink)",
  wordBreak: "break-word",
};

export const purposeBoxStyle: CSSProperties = {
  padding: "16px",
  borderRadius: "16px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
  lineHeight: 1.7,
  whiteSpace: "pre-wrap",
  color: "var(--x-color-ink-muted)",
};

export const sectionStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

export const sectionTitleStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
};

export const approverRowStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

export const approverCardStyle: CSSProperties = {
  display: "grid",
  justifyItems: "center",
  gap: "6px",
  padding: "10px",
  minWidth: "88px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
};

export function approverAvatarStyle(reject: boolean): CSSProperties {
  return {
    width: "46px",
    height: "46px",
    borderRadius: "50%",
    objectFit: "cover",
    border: reject ? "2px solid var(--x-color-danger)" : "2px solid var(--x-color-success)",
  };
}

export const approverTimeStyle: CSSProperties = {
  fontSize: "11px",
  color: "var(--x-color-ink-muted)",
  textAlign: "center",
};

export const approverMeStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  color: "var(--x-color-accent)",
};

export const attachmentGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "10px",
};

export const attachmentCardStyle: CSSProperties = {
  border: "1px solid var(--x-color-line-soft)",
  borderRadius: "14px",
  padding: "14px",
  background: "var(--x-color-panel-alt)",
  textAlign: "left",
  cursor: "pointer",
  display: "grid",
  gap: "6px",
};

export const attachmentNameStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
  wordBreak: "break-word",
};

export const attachmentMetaStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};
