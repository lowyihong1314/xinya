import { Link, useLocation } from "react-router-dom";
import { useState } from "react";
import type { CSSProperties } from "react";

import { useUserState } from "../../app/UserState";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import { CRM_MODULES, buildCRMModuleHref, type CRMModuleKey } from "./crmModules";
import { getSidebarChildren } from "./CRMPage";

export function CRMHomePage() {
  useEnsureDesignTokens();

  const { isMobile } = useUserState();
  const location = useLocation();
  const [expandedModuleKey, setExpandedModuleKey] = useState<CRMModuleKey | null>(null);
  const searchParams = new URLSearchParams(location.search);

  return (
    <div style={pageStyle(isMobile)}>
      <section style={heroStyle(isMobile)}>
        <div style={heroCopyStyle}>
          <div style={eyebrowStyle}>ERP Console</div>
          <h1 style={titleStyle}>CRM 工作台</h1>
        </div>
        <div style={moduleCountStyle}>{CRM_MODULES.length}</div>
      </section>

      <section style={moduleListStyle}>
        {CRM_MODULES.map((module) => {
          const children = getSidebarChildren(module.key, searchParams, false);
          const hasChildren = children.length > 0;
          const expanded = expandedModuleKey === module.key;

          return (
            <div key={module.key} style={moduleGroupStyle(expanded)}>
              {hasChildren ? (
                <button
                  type="button"
                  style={moduleButtonStyle(expanded)}
                  aria-expanded={expanded}
                  onClick={() => setExpandedModuleKey((current) => (current === module.key ? null : module.key))}
                >
                  <span style={moduleIconStyle(expanded)}>
                    <i className={module.icon} />
                  </span>
                  <span style={moduleTextStyle}>
                    <span style={moduleTitleStyle}>{module.title}</span>
                    <span style={moduleMetaStyle}>{children.length} 个子模块</span>
                  </span>
                  <i className={`fas fa-chevron-${expanded ? "down" : "right"}`} style={chevronStyle} />
                </button>
              ) : (
                <Link
                  to={buildCRMModuleHref(module.key, searchParams)}
                  title={module.description}
                  aria-label={module.description ? `${module.title} · ${module.description}` : module.title}
                  style={moduleLinkStyle}
                >
                  <span style={moduleIconStyle(false)}>
                    <i className={module.icon} />
                  </span>
                  <span style={moduleTextStyle}>
                    <span style={moduleTitleStyle}>{module.title}</span>
                    <span style={moduleMetaStyle}>模块入口</span>
                  </span>
                  <i className="fas fa-arrow-right" style={chevronStyle} />
                </Link>
              )}

              {expanded ? (
                <div style={childListStyle}>
                  {children.map((child) => (
                    <Link
                      key={child.key}
                      to={child.to}
                      title={child.description}
                      aria-label={`${module.title} · ${child.title}`}
                      style={childLinkStyle}
                    >
                      <span style={childIconStyle}>
                        <i className={child.icon} />
                      </span>
                      <span style={childTitleStyle}>{child.title}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function pageStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "8px",
    width: "100%",
    maxWidth: isMobile ? "100%" : "760px",
    margin: isMobile ? 0 : "0 auto",
  };
}

function heroStyle(isMobile: boolean): CSSProperties {
  return {
    minHeight: "44px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: isMobile ? "8px" : "10px 12px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    boxShadow: "none",
  };
}

const heroCopyStyle: CSSProperties = {
  display: "grid",
  gap: "2px",
  minWidth: 0,
};

const eyebrowStyle: CSSProperties = {
  fontSize: "10px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "17px",
  lineHeight: 1.15,
  fontWeight: 900,
};

const moduleCountStyle: CSSProperties = {
  width: "30px",
  height: "30px",
  display: "grid",
  placeItems: "center",
  borderRadius: "6px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 900,
};

const moduleListStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

function moduleGroupStyle(expanded: boolean): CSSProperties {
  return {
    display: "grid",
    gap: expanded ? "4px" : 0,
    padding: expanded ? "4px" : 0,
    borderRadius: "8px",
    border: expanded ? "1px solid var(--x-color-line-soft)" : "1px solid transparent",
    background: expanded ? "var(--x-color-panel)" : "transparent",
  };
}

const moduleRowBaseStyle: CSSProperties = {
  width: "100%",
  minHeight: "44px",
  display: "grid",
  gridTemplateColumns: "32px minmax(0, 1fr) 16px",
  gap: "8px",
  alignItems: "center",
  padding: "6px 8px",
  borderRadius: "6px",
  textAlign: "left",
  textDecoration: "none",
  color: "var(--x-color-ink)",
  boxSizing: "border-box",
};

function moduleButtonStyle(expanded: boolean): CSSProperties {
  return {
    ...moduleRowBaseStyle,
    appearance: "none",
    WebkitAppearance: "none",
    border: expanded ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)",
    background: expanded ? "var(--x-color-accent-tint)" : "var(--x-color-panel)",
    cursor: "pointer",
  };
}

const moduleLinkStyle: CSSProperties = {
  ...moduleRowBaseStyle,
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
};

function moduleIconStyle(active: boolean): CSSProperties {
  return {
    width: "32px",
    height: "32px",
    display: "grid",
    placeItems: "center",
    borderRadius: "6px",
    background: active ? "var(--x-color-accent)" : "var(--x-color-panel-alt)",
    color: active ? "white" : "var(--x-color-ink-muted)",
    fontSize: "13px",
  };
}

const moduleTextStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: "2px",
};

const moduleTitleStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 850,
  lineHeight: 1.15,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const moduleMetaStyle: CSSProperties = {
  fontSize: "10px",
  lineHeight: 1.1,
  color: "var(--x-color-ink-muted)",
};

const chevronStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "11px",
  justifySelf: "center",
};

const childListStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "3px",
  padding: "0 0 2px 28px",
};

const childLinkStyle: CSSProperties = {
  minHeight: "34px",
  display: "grid",
  gridTemplateColumns: "26px minmax(0, 1fr)",
  gap: "7px",
  alignItems: "center",
  padding: "5px 7px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  textDecoration: "none",
  boxSizing: "border-box",
};

const childIconStyle: CSSProperties = {
  width: "26px",
  height: "24px",
  display: "grid",
  placeItems: "center",
  borderRadius: "5px",
  color: "var(--x-color-accent-strong)",
  background: "var(--x-color-accent-tint)",
  fontSize: "11px",
};

const childTitleStyle: CSSProperties = {
  minWidth: 0,
  fontSize: "12px",
  fontWeight: 750,
  lineHeight: 1.15,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
