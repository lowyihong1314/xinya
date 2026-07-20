import type { CSSProperties, ReactNode } from "react";

export type DocDetailHeaderProps = {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  statusSlot?: ReactNode;
  onBack: () => void;
  backLabel?: string;
  onPrev?: () => void;
  onNext?: () => void;
  positionLabel?: string;
  actions?: ReactNode;
};

/**
 * Unified detail-view header for finance documents (报销 / 收款 / …).
 * Provides: 返回, 上/下一单 navigation, title block, status slot and an action slot.
 */
export function DocDetailHeader({
  eyebrow,
  title,
  subtitle,
  statusSlot,
  onBack,
  backLabel = "返回列表",
  onPrev,
  onNext,
  positionLabel,
  actions,
}: DocDetailHeaderProps) {
  return (
    <div style={wrapStyle}>
      <div style={topRowStyle}>
        <div style={navGroupStyle}>
          <button type="button" style={btnStyle} onClick={onBack}>
            ← {backLabel}
          </button>
          <div style={navPairStyle}>
            <button
              type="button"
              style={onPrev ? navBtnStyle : navBtnDisabledStyle}
              onClick={onPrev}
              disabled={!onPrev}
              title="上一单"
            >
              ‹ 上一单
            </button>
            <button
              type="button"
              style={onNext ? navBtnStyle : navBtnDisabledStyle}
              onClick={onNext}
              disabled={!onNext}
              title="下一单"
            >
              下一单 ›
            </button>
            {positionLabel ? <span style={positionStyle}>{positionLabel}</span> : null}
          </div>
        </div>
        {actions ? <div style={actionsStyle}>{actions}</div> : null}
      </div>

      <div style={titleBlockStyle}>
        <div style={eyebrowStyle}>{eyebrow}</div>
        <h2 style={titleStyle}>{title}</h2>
        {subtitle ? <div style={mutedStyle}>{subtitle}</div> : null}
        {statusSlot ? <div style={statusRowStyle}>{statusSlot}</div> : null}
      </div>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  padding: "14px 16px",
  borderBottom: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
};

const topRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  flexWrap: "wrap",
};

const navGroupStyle: CSSProperties = { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" };
const navPairStyle: CSSProperties = { display: "flex", gap: "6px", alignItems: "center" };
const actionsStyle: CSSProperties = { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" };

const btnStyle: CSSProperties = {
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

const navBtnStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 600,
  fontSize: "13px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const navBtnDisabledStyle: CSSProperties = {
  ...navBtnStyle,
  opacity: 0.45,
  cursor: "not-allowed",
};

const positionStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", fontWeight: 600, marginLeft: "2px" };

const titleBlockStyle: CSSProperties = { display: "grid", gap: "4px" };
const eyebrowStyle: CSSProperties = {
  fontSize: "11px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
};
const titleStyle: CSSProperties = { margin: "2px 0", fontSize: "18px", fontWeight: 800, color: "var(--x-color-ink)" };
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
const statusRowStyle: CSSProperties = { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", marginTop: "2px" };
