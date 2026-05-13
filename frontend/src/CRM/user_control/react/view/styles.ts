import type { CSSProperties } from "react";

export const pageStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

export const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "10px",
  alignItems: "center",
  flexWrap: "wrap",
  paddingBottom: "8px",
  borderBottom: "1px solid var(--x-color-line-soft)",
};

export const eyebrowStyle: CSSProperties = {
  fontSize: "11px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

export const titleStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: "20px",
  lineHeight: 1.1,
  color: "var(--x-color-ink)",
};

export function toolbarStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
    alignItems: "center",
    width: isMobile ? "100%" : undefined,
  };
}

export function layoutStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    alignItems: "stretch",
    gap: "10px",
  };
}

const panelFrameBaseStyle: CSSProperties = {
  padding: "10px",
  borderRadius: "8px",
  background: "var(--x-color-panel-strong)",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "none",
};

export const panelStyle: CSSProperties = {
  ...panelFrameBaseStyle,
  display: "grid",
  gap: "10px",
};

export function departmentPanelStyle(isMobile: boolean): CSSProperties {
  return {
    ...panelFrameBaseStyle,
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    flex: isMobile ? "1 1 auto" : "0 0 300px",
    minWidth: 0,
    maxHeight: isMobile ? undefined : "calc(100vh - 220px)",
    overflow: "hidden",
  };
}

export const departmentUsersPanelStyle: CSSProperties = {
  ...panelFrameBaseStyle,
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  flex: "1 1 0",
  minWidth: 0,
};

export const panelHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
  alignItems: "center",
  flexWrap: "wrap",
};

export const sectionEyebrowStyle: CSSProperties = eyebrowStyle;

export const sectionTitleStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: "16px",
  color: "var(--x-color-ink)",
};

export function createRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    alignItems: "stretch",
    gap: "6px",
  };
}

export const departmentListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  paddingRight: "4px",
};

export function departmentCardStyle(active: boolean): CSSProperties {
  return {
    textAlign: "left",
    padding: "8px 10px",
    borderRadius: "6px",
    border: active
      ? "1px solid var(--x-color-accent-border)"
      : "1px solid var(--x-color-line-soft)",
    background: active
      ? "var(--x-color-accent-tint-strong)"
      : "var(--x-color-panel)",
    cursor: "pointer",
  };
}

export const departmentTitleStyle: CSSProperties = {
  fontWeight: 700,
  color: "var(--x-color-ink)",
};

export const departmentMetaStyle: CSSProperties = {
  marginTop: "2px",
  fontSize: "11px",
  color: "var(--x-color-ink-muted)",
};

export const cardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: "8px",
};

export const userCardStyle: CSSProperties = {
  borderRadius: "6px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  overflow: "hidden",
  boxShadow: "none",
};

export const userOpenStyle: CSSProperties = {
  width: "100%",
  padding: "10px",
  display: "grid",
  justifyItems: "center",
  gap: "6px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
};

export const readOnlyUserCardBodyStyle: CSSProperties = {
  padding: "10px",
  display: "grid",
  justifyItems: "center",
  gap: "6px",
  textAlign: "center",
};

export const avatarStyle: CSSProperties = {
  width: "56px",
  height: "56px",
  borderRadius: "50%",
  objectFit: "cover",
  border: "3px solid var(--x-color-panel-strong)",
};

export const userNameStyle: CSSProperties = {
  fontWeight: 700,
  color: "var(--x-color-ink)",
  textAlign: "center",
  fontSize: "13px",
};

export const userMetaStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
  textAlign: "center",
  wordBreak: "break-word",
};

export function memberBadgeStyle(active: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "24px",
    padding: "3px 7px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 800,
    background: active
      ? "var(--x-color-success-soft)"
      : "var(--x-color-panel-alt)",
    color: active
      ? "var(--x-color-success)"
      : "var(--x-color-ink-muted)",
    border: active
      ? "1px solid rgba(21,128,61,0.16)"
      : "1px solid var(--x-color-line-soft)",
  };
}

export function actionButtonStyle(danger = false): CSSProperties {
  return {
    width: "100%",
    padding: "7px 9px",
    border: "none",
    borderTop: "1px solid var(--x-color-line-soft)",
    background: danger
      ? "var(--x-color-danger-soft)"
      : "var(--x-color-accent-tint)",
    color: danger ? "var(--x-color-danger)" : "var(--x-color-accent-strong)",
    fontWeight: 700,
    cursor: "pointer",
  };
}

export const placeholderStyle: CSSProperties = {
  padding: "14px",
  borderRadius: "6px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
};

export function listSummaryStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    flexDirection: isMobile ? "column" : "row",
  };
}

export const listMetaStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

export const paginationActionsStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  flexWrap: "wrap",
};

export function paginationButtonStyle(disabled: boolean): CSSProperties {
  return {
    ...secondaryButtonStyle,
    padding: "6px 8px",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

export function searchStyle(isMobile: boolean): CSSProperties {
  return {
    minWidth: isMobile ? "0" : "320px",
    maxWidth: isMobile ? "100%" : "420px",
    width: "100%",
    minHeight: "32px",
    padding: "6px 8px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
    boxSizing: "border-box",
  };
}

export const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(9,16,29,0.6)",
  display: "grid",
  placeItems: "center",
  zIndex: 5000,
  padding: "12px",
};

export const modalStyle: CSSProperties = {
  width: "min(820px, 100%)",
  maxHeight: "90vh",
  overflow: "auto",
  padding: "12px",
  borderRadius: "8px",
  background: "var(--x-color-panel-strongest)",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 12px 28px var(--x-color-shadow-medium)",
  display: "grid",
  gap: "10px",
};

export const modalHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
  alignItems: "center",
  flexWrap: "wrap",
};

export const modalTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "18px",
  color: "var(--x-color-ink)",
};

export const editorPageShellStyle: CSSProperties = {
  padding: "10px",
  borderRadius: "8px",
  background: "var(--x-color-panel-strong)",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "none",
};

export const editorPageStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

export const editorPageHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
  alignItems: "center",
  flexWrap: "wrap",
};

export const editorPageTitleStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: "20px",
  color: "var(--x-color-ink)",
};

export const editorPageMetaStyle: CSSProperties = {
  marginTop: "8px",
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

export const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "8px",
};

export const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

export const fieldLabelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
};

export const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "32px",
  padding: "6px 8px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  boxSizing: "border-box",
  fontSize: "13px",
};

export const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "84px",
  resize: "vertical",
};

export const modalFooterStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "6px",
  flexWrap: "wrap",
};

export const checkboxRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  minHeight: "32px",
  color: "var(--x-color-ink)",
};

export const permissionGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: "6px",
};

export const renewalSectionStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  paddingTop: "8px",
  borderTop: "1px solid var(--x-color-line-soft)",
};

export const renewalSectionHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

export const renewalFormStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "8px",
};

export const renewalActionWrapStyle: CSSProperties = {
  display: "flex",
  alignItems: "end",
};

export const renewalListStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

export const renewalCardStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "8px",
  flexWrap: "wrap",
  padding: "8px 10px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
};

export const renewalMetaStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

export const renewalDateStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

export const renewalInfoStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

export const attachmentActionRowStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  flexWrap: "wrap",
};

export function permissionItemStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "7px 9px",
    borderRadius: "6px",
    border: active
      ? "1px solid var(--x-color-accent-border)"
      : "1px solid var(--x-color-line-soft)",
    background: active
      ? "var(--x-color-accent-tint-strong)"
      : "var(--x-color-panel)",
  };
}

export const primaryButtonStyle: CSSProperties = {
  padding: "7px 10px",
  borderRadius: "6px",
  border: "none",
  background: "var(--x-color-accent)",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "13px",
};

export const secondaryButtonStyle: CSSProperties = {
  padding: "7px 10px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "13px",
};

export const dangerButtonStyle: CSSProperties = {
  padding: "7px 10px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "13px",
};

export const successBannerStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
  background: "var(--x-color-success-soft)",
  color: "var(--x-color-success)",
};

export const errorBannerStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
};
