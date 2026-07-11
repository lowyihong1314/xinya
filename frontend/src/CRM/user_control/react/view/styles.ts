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
  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
  gap: "8px",
};

// 名片：宽 4 高 2 的横向卡片，头像在左，内容在右。
export const userCardStyle: CSSProperties = {
  position: "relative",
  aspectRatio: "4 / 2",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  overflow: "hidden",
  boxShadow: "none",
};

const userCardBodyBaseStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  padding: "12px",
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  gap: "12px",
  textAlign: "left",
  boxSizing: "border-box",
};

export const userOpenStyle: CSSProperties = {
  ...userCardBodyBaseStyle,
  border: "none",
  background: "transparent",
  cursor: "pointer",
};

export const readOnlyUserCardBodyStyle: CSSProperties = {
  ...userCardBodyBaseStyle,
};

export const avatarStyle: CSSProperties = {
  width: "64px",
  height: "64px",
  flex: "0 0 auto",
  borderRadius: "50%",
  objectFit: "cover",
  border: "3px solid var(--x-color-panel-strong)",
};

export const userInfoStyle: CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
  display: "flex",
  flexDirection: "column",
  gap: "5px",
  overflow: "hidden",
};

export const userNameRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  flexWrap: "wrap",
};

export const userNameStyle: CSSProperties = {
  fontWeight: 700,
  color: "var(--x-color-ink)",
  fontSize: "14px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: "100%",
};

export const userMetaStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: "100%",
};

export const departmentChipsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "4px",
  justifyContent: "flex-start",
  overflow: "hidden",
  maxHeight: "44px",
};

export const departmentChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 7px",
  borderRadius: "999px",
  fontSize: "11px",
  fontWeight: 700,
  background: "var(--x-color-accent-tint)",
  color: "var(--x-color-accent-strong)",
  border: "1px solid var(--x-color-accent-border)",
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

export const xinYaBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "24px",
  padding: "3px 7px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 800,
  background: "var(--x-color-accent-tint)",
  color: "var(--x-color-accent-strong)",
  border: "1px solid var(--x-color-accent-border)",
};

// 未通过（非生效青少年）时的心芽标签：灰色。
export const xinYaBadgeMutedStyle: CSSProperties = {
  ...xinYaBadgeStyle,
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  border: "1px solid var(--x-color-line-soft)",
};

export const ageBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "24px",
  padding: "3px 9px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 800,
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  border: "1px solid var(--x-color-line-soft)",
};

export const detailBadgeRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  flexWrap: "wrap",
  marginTop: "8px",
};

export function actionButtonStyle(danger = false): CSSProperties {
  return {
    position: "absolute",
    top: "8px",
    right: "8px",
    padding: "3px 9px",
    borderRadius: "999px",
    border: danger
      ? "1px solid var(--x-color-danger-border)"
      : "1px solid var(--x-color-accent-border)",
    background: danger
      ? "var(--x-color-danger-soft)"
      : "var(--x-color-accent-tint)",
    color: danger ? "var(--x-color-danger)" : "var(--x-color-accent-strong)",
    fontSize: "12px",
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
