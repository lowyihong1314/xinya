import type { CSSProperties } from "react";

import type { GLAccountType } from "./types";

export const ACCOUNT_TYPE_LABELS: Record<GLAccountType, string> = {
  asset: "资产",
  liability: "负债",
  equity: "权益",
  income: "收入",
  expense: "支出",
};

export const GL_TABLE_CSS = `
.gl-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.gl-table thead th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; padding: 9px 12px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--x-color-ink-muted); background: var(--x-color-canvas-alt);
  border-bottom: 1px solid var(--x-color-line); white-space: nowrap;
}
.gl-table tbody td { padding: 10px 12px; border-bottom: 1px solid var(--x-color-line-soft); vertical-align: middle; color: var(--x-color-ink); }
.gl-table tbody tr.gl-row-click { cursor: pointer; }
.gl-table tbody tr.gl-row-click:hover td { background: var(--x-color-accent-tint); }
.gl-table tfoot td { padding: 10px 12px; border-top: 2px solid var(--x-color-line); font-weight: 800; color: var(--x-color-ink); background: var(--x-color-panel-alt); }
.gl-num { text-align: right; font-family: var(--x-font-mono); font-size: 12.5px; white-space: nowrap; }
`;

export function money(value?: number | null) {
  const amount = Number(value ?? 0);
  return amount.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function moneyOrDash(value?: number | null) {
  const amount = Number(value ?? 0);
  return amount === 0 ? "—" : money(amount);
}

export const panelStyle: CSSProperties = {
  borderRadius: "12px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 1px 2px var(--x-color-shadow-soft)",
  overflow: "hidden",
};

export const toolbarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "12px",
  flexWrap: "wrap",
  padding: "16px 18px",
  borderBottom: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
};

export const eyebrowStyle: CSSProperties = { fontSize: "11px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--x-color-ink-muted)", fontWeight: 700 };
export const titleStyle: CSSProperties = { margin: "2px 0", fontSize: "18px", fontWeight: 800, color: "var(--x-color-ink)" };
export const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", lineHeight: 1.5 };
export const rowStyle: CSSProperties = { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" };

export const btnStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 600,
  fontSize: "13px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const primaryButtonStyle: CSSProperties = {
  padding: "8px 16px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-accent-strong)",
  background: "var(--x-color-accent)",
  color: "white",
  fontWeight: 700,
  fontSize: "13px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const ghostButtonStyle: CSSProperties = {
  padding: "6px 10px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  fontWeight: 600,
  fontSize: "12px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const dangerButtonStyle: CSSProperties = {
  ...ghostButtonStyle,
  border: "1px solid var(--x-color-danger-border)",
  color: "var(--x-color-danger)",
  background: "var(--x-color-danger-soft)",
};

export const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "34px",
  padding: "7px 10px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontSize: "13px",
  boxSizing: "border-box",
};

export const searchInputStyle: CSSProperties = {
  ...inputStyle,
  flex: "1 1 220px",
};

export const filterBarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap",
  alignItems: "center",
  padding: "10px 14px",
  borderBottom: "1px solid var(--x-color-line-soft)",
};

export const tabBarStyle: CSSProperties = { display: "flex", gap: "6px", flexWrap: "wrap" };

export function subTabStyle(active: boolean): CSSProperties {
  return {
    padding: "7px 13px",
    borderRadius: "8px",
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid transparent",
    background: active ? "var(--x-color-panel)" : "transparent",
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)",
    fontWeight: active ? 700 : 600,
    fontSize: "13px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: active ? "0 1px 2px var(--x-color-shadow-soft)" : "none",
  };
}

export const tableWrapStyle: CSSProperties = { width: "100%", overflowX: "auto", padding: "12px 14px 14px" };
export const monoCellStyle: CSSProperties = { fontFamily: "var(--x-font-mono)", fontSize: "12.5px", whiteSpace: "nowrap" };
export const cellStrongStyle: CSSProperties = { fontWeight: 700, lineHeight: 1.4 };

export const emptyStyle: CSSProperties = {
  margin: "16px",
  padding: "28px",
  borderRadius: "10px",
  border: "1px dashed var(--x-color-line)",
  textAlign: "center",
  color: "var(--x-color-ink-muted)",
};

export const noticeSuccessStyle: CSSProperties = {
  margin: "12px 14px 0",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-success-strong)",
  background: "var(--x-color-success-soft)",
  color: "var(--x-color-success)",
  fontWeight: 700,
  fontSize: "13px",
};

export const noticeErrorStyle: CSSProperties = {
  margin: "12px 14px 0",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-warning-border)",
  background: "var(--x-color-warning-soft)",
  color: "var(--x-color-warning)",
  fontWeight: 700,
  fontSize: "13px",
};

export const cardStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  padding: "12px 14px",
  borderRadius: "10px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
};

export const labelStyle: CSSProperties = { fontSize: "12px", fontWeight: 700, color: "var(--x-color-ink-muted)" };

export function typeChipStyle(type?: GLAccountType | null): CSSProperties {
  const map: Record<string, { bg: string; fg: string }> = {
    asset: { bg: "var(--x-color-info-soft)", fg: "var(--x-color-info)" },
    liability: { bg: "var(--x-color-warning-soft)", fg: "var(--x-color-warning)" },
    equity: { bg: "var(--x-color-accent-tint)", fg: "var(--x-color-accent-strong)" },
    income: { bg: "var(--x-color-success-soft)", fg: "var(--x-color-success)" },
    expense: { bg: "var(--x-color-danger-soft)", fg: "var(--x-color-danger)" },
  };
  const palette = (type && map[type]) || { bg: "var(--x-color-panel-alt)", fg: "var(--x-color-ink-muted)" };
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 9px",
    borderRadius: "6px",
    fontSize: "11px",
    fontWeight: 700,
    whiteSpace: "nowrap",
    background: palette.bg,
    color: palette.fg,
  };
}

export function statusChipStyle(status: string): CSSProperties {
  const palette =
    status === "posted"
      ? { bg: "var(--x-color-success-soft)", fg: "var(--x-color-success)" }
      : status === "void"
        ? { bg: "var(--x-color-danger-soft)", fg: "var(--x-color-danger)" }
        : { bg: "var(--x-color-warning-soft)", fg: "var(--x-color-warning)" };
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 700,
    whiteSpace: "nowrap",
    background: palette.bg,
    color: palette.fg,
  };
}

export function statusText(status: string) {
  if (status === "posted") return "已过账";
  if (status === "void") return "已作废";
  return "草稿";
}
