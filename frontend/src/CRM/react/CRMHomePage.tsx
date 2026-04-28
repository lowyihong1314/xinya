import { useLocation } from "react-router-dom";
import type { CSSProperties } from "react";

import { useUserState } from "../../app/UserState";
import { CRMNavigationTile } from "../shared/CRMNavigationTile";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import { CRM_MODULES, buildCRMModuleHref } from "./crmModules";

export function CRMHomePage() {
  useEnsureDesignTokens();

  const { isMobile } = useUserState();
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
          <CRMNavigationTile
            key={module.key}
            to={buildCRMModuleHref(module.key, searchParams)}
            icon={module.icon}
            title={module.title}
            description={module.description}
            isMobile={isMobile}
          />
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

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 180px))",
  gap: "12px",
  justifyContent: "start",
};
