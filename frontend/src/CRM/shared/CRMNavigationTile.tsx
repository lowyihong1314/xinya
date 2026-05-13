import { Link } from "react-router-dom";
import type { CSSProperties } from "react";

type CRMNavigationTileProps = {
  active?: boolean;
  description?: string;
  icon: string;
  isMobile?: boolean;
  onClick?: () => void;
  title: string;
  to?: string;
};

export function CRMNavigationTile({
  active = false,
  description,
  icon,
  isMobile = false,
  onClick,
  title,
  to,
}: CRMNavigationTileProps) {
  const tooltipTitle = description ? `${title} · ${description}` : title;

  const content = (
    <>
      <span style={iconStyle(active, isMobile)}>
        <i className={icon} />
      </span>
      <span style={copyStyle}>
        <span style={titleStyle(active)}>{title}</span>
      </span>
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        title={tooltipTitle}
        aria-label={tooltipTitle}
        style={tileStyle(active, isMobile)}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      title={tooltipTitle}
      aria-label={tooltipTitle}
      onClick={onClick}
      style={tileButtonStyle(active, isMobile)}
    >
      {content}
    </button>
  );
}

function tileStyle(active: boolean, isMobile: boolean): CSSProperties {
  return {
    position: "relative",
    display: "grid",
    gridTemplateColumns: isMobile ? "34px minmax(0, 1fr)" : "30px minmax(0, 1fr)",
    gap: "8px",
    alignItems: "center",
    padding: isMobile ? "8px 10px" : "7px 8px",
    borderRadius: "6px",
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)",
    borderLeft: active ? "3px solid var(--x-color-accent)" : "3px solid transparent",
    background: active ? "var(--x-color-accent-tint)" : "transparent",
    boxShadow: "none",
    color: "var(--x-color-ink)",
    cursor: "pointer",
    textAlign: "left",
    textDecoration: "none",
    width: isMobile ? "100%" : "min(100%, 180px)",
    overflow: "visible",
    transition: "background 140ms ease, border-color 140ms ease",
  };
}

function tileButtonStyle(active: boolean, isMobile: boolean): CSSProperties {
  return {
    ...tileStyle(active, isMobile),
    appearance: "none",
    WebkitAppearance: "none",
    borderWidth: "1px",
  };
}

function iconStyle(active: boolean, isMobile: boolean): CSSProperties {
  const size = isMobile ? 34 : 30;
  return {
    width: `${size}px`,
    height: `${size}px`,
    display: "grid",
    placeItems: "center",
    borderRadius: "6px",
    background: active ? "var(--x-color-accent)" : "var(--x-color-panel-alt)",
    color: active ? "white" : "var(--x-color-ink-muted)",
    fontSize: isMobile ? "15px" : "13px",
  };
}

const copyStyle: CSSProperties = {
  display: "grid",
  gap: "0",
  minWidth: 0,
};

function titleStyle(active: boolean): CSSProperties {
  return {
    fontSize: "13px",
    fontWeight: 700,
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink)",
    lineHeight: 1.2,
  };
}
