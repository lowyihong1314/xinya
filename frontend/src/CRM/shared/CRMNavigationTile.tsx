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
    gridTemplateColumns: isMobile ? "44px minmax(0, 1fr)" : "56px minmax(0, 1fr)",
    gap: "14px",
    alignItems: "start",
    padding: isMobile ? "14px" : "16px",
    borderRadius: "var(--x-radius-md)",
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)",
    background: active
      ? "linear-gradient(145deg, var(--x-color-accent-tint-strong), var(--x-color-info-tint))"
      : "var(--x-color-panel-strong)",
    boxShadow: active ? "0 18px 36px var(--x-color-shadow-strong)" : "0 10px 24px var(--x-color-shadow-soft)",
    color: "var(--x-color-ink)",
    cursor: "pointer",
    textAlign: "left",
    textDecoration: "none",
    width: isMobile ? "100%" : "min(100%, 180px)",
    overflow: "visible",
    transition: "transform 160ms ease, box-shadow 180ms ease, border-color 180ms ease",
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
  const size = isMobile ? 44 : 56;
  return {
    width: `${size}px`,
    height: `${size}px`,
    display: "grid",
    placeItems: "center",
    borderRadius: isMobile ? "14px" : "16px",
    background: active
      ? "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))"
      : "var(--x-color-panel-alt)",
    color: active ? "white" : "var(--x-color-ink)",
    fontSize: isMobile ? "18px" : "20px",
  };
}

const copyStyle: CSSProperties = {
  display: "grid",
  gap: "0",
  minWidth: 0,
};

function titleStyle(active: boolean): CSSProperties {
  return {
    fontSize: "16px",
    fontWeight: 700,
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink)",
    lineHeight: 1.35,
  };
}
