import { Link, useLocation } from "react-router-dom";
import type { CSSProperties } from "react";

import { ensureDesignTokens } from "../../theme/designTokens";
import { CRM_MODULES, buildCRMModuleHref } from "./crmModules";

export function CRMHomePage() {
  ensureDesignTokens();

  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);

  return (
    <div style={pageStyle}>
      <section style={heroStyle}>
        <div style={eyebrowStyle}>CRM Home</div>
        <h1 style={titleStyle}>CRM 首页</h1>
      </section>

      <section style={gridStyle}>
        {CRM_MODULES.map((module) => (
          <Link
            key={module.key}
            to={buildCRMModuleHref(module.key, searchParams)}
            style={cardStyle}
          >
            <span style={cardIconStyle}>
              <i className={module.icon} />
            </span>
            <span style={cardTitleStyle}>{module.title}</span>
            <span style={cardDescStyle}>{module.description}</span>
          </Link>
        ))}
      </section>
    </div>
  );
}

const pageStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
};

const heroStyle: CSSProperties = {
  padding: "22px 22px 24px",
  borderRadius: "24px",
  background:
    "linear-gradient(145deg, rgba(10,35,45,0.96), rgba(14,116,144,0.92) 58%, rgba(221,107,32,0.84) 120%)",
  color: "white",
  boxShadow: "0 18px 42px rgba(15,23,42,0.16)",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  opacity: 0.76,
};

const titleStyle: CSSProperties = {
  margin: "10px 0 12px",
  fontSize: "32px",
  lineHeight: 1.04,
};

const descStyle: CSSProperties = {
  margin: 0,
  lineHeight: 1.7,
  fontSize: "14px",
  opacity: 0.92,
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "12px",
};

const cardStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
  minHeight: "148px",
  padding: "16px",
  borderRadius: "20px",
  background: "var(--x-color-panel-strong)",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 14px 30px var(--x-color-shadow-soft)",
  color: "var(--x-color-ink)",
  textDecoration: "none",
};

const cardIconStyle: CSSProperties = {
  width: "46px",
  height: "46px",
  display: "grid",
  placeItems: "center",
  borderRadius: "14px",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
  color: "white",
  fontSize: "18px",
};

const cardTitleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 800,
  lineHeight: 1.25,
};

const cardDescStyle: CSSProperties = {
  fontSize: "12px",
  lineHeight: 1.55,
  color: "var(--x-color-ink-muted)",
};
