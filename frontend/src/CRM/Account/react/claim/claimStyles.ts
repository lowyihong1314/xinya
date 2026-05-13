import type { CSSProperties } from "react";

export const toolbarStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto auto auto",
  gap: "6px",
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
  minHeight: "32px",
  padding: "6px 8px",
  boxSizing: "border-box",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  outline: "none",
  fontSize: "13px",
};

export const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  minHeight: "32px",
  padding: "6px 8px",
  boxSizing: "border-box",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  outline: "none",
  fontSize: "13px",
};

export const textareaStyle: CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  minHeight: "84px",
};

export const buttonPrimaryStyle: CSSProperties = {
  border: "none",
  borderRadius: "6px",
  padding: "7px 10px",
  background: "var(--x-color-accent)",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: "13px",
};

export const buttonSecondaryStyle: CSSProperties = {
  border: "1px solid var(--x-color-line-soft)",
  borderRadius: "6px",
  padding: "7px 10px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: "13px",
};

export const buttonGhostStyle: CSSProperties = {
  border: "1px dashed var(--x-color-line-soft)",
  borderRadius: "6px",
  padding: "7px 10px",
  background: "transparent",
  color: "var(--x-color-ink-muted)",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: "13px",
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
  padding: "4px 7px",
  borderRadius: "999px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
  fontSize: "11px",
  color: "var(--x-color-ink-muted)",
};

const noticeBaseStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  padding: "8px 10px",
  borderRadius: "6px",
  border: "1px solid transparent",
  boxShadow: "none",
  marginBottom: "8px",
};

export const noticeSuccessStyle: CSSProperties = {
  ...noticeBaseStyle,
  background: "var(--x-color-success-soft)",
  borderColor: "rgba(21,128,61,0.18)",
  color: "var(--x-color-success)",
};

export const noticeErrorStyle: CSSProperties = {
  ...noticeBaseStyle,
  background: "var(--x-color-danger-soft)",
  borderColor: "var(--x-color-danger-border)",
  color: "var(--x-color-danger)",
};

export const noticeTitleStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 800,
  lineHeight: 1.3,
};

export const noticeTextStyle: CSSProperties = {
  fontSize: "12px",
  lineHeight: 1.45,
};

export const listStyle: CSSProperties = {
  display: "grid",
  width: "100%",
  minWidth: 0,
  gap: "6px",
};

export const cardButtonStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  border: "1px solid var(--x-color-line-soft)",
  borderRadius: "6px",
  padding: "9px 10px",
  background: "var(--x-color-panel)",
  textAlign: "left",
  cursor: "pointer",
  display: "grid",
  gap: "7px",
};

export const cardTopStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  minWidth: 0,
  gap: "8px",
  alignItems: "start",
};

export const cardTitleStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
};

export const cardMetaStyle: CSSProperties = {
  marginTop: "3px",
  fontSize: "11px",
  color: "var(--x-color-ink-muted)",
};

export const cardBodyStyle: CSSProperties = {
  fontSize: "12px",
  lineHeight: 1.45,
  color: "var(--x-color-ink-muted)",
  whiteSpace: "pre-wrap",
};

export const chipRowStyle: CSSProperties = {
  display: "flex",
  gap: "5px",
  flexWrap: "wrap",
};

export const paginationRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "6px",
  flexWrap: "wrap",
  paddingTop: "6px",
  borderTop: "1px solid var(--x-color-line-soft)",
};

export const paginationRowTopStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "6px",
  flexWrap: "wrap",
};

export const paginationActionsStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  flexWrap: "wrap",
  alignItems: "center",
};

export const resultContainerStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  minHeight: "260px",
  maxHeight: "calc(100dvh - 160px)",
  overflow: "auto",
  resize: "vertical",
  paddingRight: "2px",
};

export const placeholderStyle: CSSProperties = {
  padding: "14px",
  borderRadius: "6px",
  border: "1px dashed var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  textAlign: "center",
};

export const panelHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "8px",
  flexWrap: "wrap",
  paddingBottom: "8px",
  borderBottom: "1px solid var(--x-color-line-soft)",
};

export const panelTitleStyle: CSSProperties = {
  fontSize: "16px",
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
    gap: "8px",
  };
}

export const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

export const wideFieldStyle: CSSProperties = {
  gridColumn: "1 / -1",
};

export const fieldLabelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: "var(--x-color-ink-muted)",
};

export const uploadBoxStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  padding: "8px",
  borderRadius: "6px",
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
  gap: "6px",
  flexWrap: "wrap",
  paddingTop: "8px",
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
    minWidth: "70px",
    padding: "4px 7px",
    borderRadius: "999px",
    border: `1px solid ${palette.border}`,
    background: palette.background,
    color: palette.color,
    fontSize: "11px",
    fontWeight: 700,
  };
}

export const detailGridStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
  gap: "8px",
});

export const detailRowStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
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
  fontSize: "13px",
  lineHeight: 1.45,
  color: "var(--x-color-ink)",
  wordBreak: "break-word",
};

export const purposeBoxStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  minWidth: 0,
  padding: "10px",
  borderRadius: "6px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  color: "var(--x-color-ink-muted)",
};

export const sectionStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

export const sectionTitleStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
};

export const approverRowStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  flexWrap: "wrap",
};

export const approverCardStyle: CSSProperties = {
  display: "grid",
  justifyItems: "center",
  gap: "4px",
  padding: "8px",
  minWidth: "76px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
};

export function approverAvatarStyle(reject: boolean): CSSProperties {
  return {
    width: "36px",
    height: "36px",
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
  gap: "6px",
};

export const attachmentCardStyle: CSSProperties = {
  border: "1px solid var(--x-color-line-soft)",
  borderRadius: "6px",
  padding: "8px 10px",
  background: "var(--x-color-panel-alt)",
  textAlign: "left",
  cursor: "pointer",
  display: "grid",
  gap: "4px",
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
