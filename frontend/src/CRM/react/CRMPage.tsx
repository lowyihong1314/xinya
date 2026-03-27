import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { CSSProperties } from "react";

import { useUserState } from "../../app/UserState";
import { ensureDesignTokens } from "../../theme/designTokens";
import {
  CRM_MODULES,
  buildCRMModulePath,
  buildCRMModuleHref,
} from "./crmModules";

export function CRMPage() {
  ensureDesignTokens();

  const { isAuthenticated, openLogin, isMobile } = useUserState();
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const isMobileHome = isMobile && location.pathname === "/crm/home";
  const activeModule = CRM_MODULES.find((module) => location.pathname === buildCRMModulePath(module.key)) ?? null;

  if (!isAuthenticated) {
    return (
      <div style={pageShellStyle}>
        <section style={gateStyle(isMobile)}>
          <div style={eyebrowStyle}>CRM Access</div>
          <h1 style={gateTitleStyle}>请先登录后台</h1>
          <p style={gateBodyStyle}>CRM 入口已经切到 React Router，模块切换和状态同步现在由 React 负责。</p>
          <div style={gateActionsStyle}>
            <button type="button" style={primaryButtonStyle} onClick={() => openLogin("/crm")}>
              打开登录框
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div style={pageShellStyle}>
      <section style={contentStyle(isMobile)}>
        {!isMobile ? (
          <nav style={moduleNavStyle(false)}>
            {CRM_MODULES.map((module) => {
              const active = location.pathname === buildCRMModulePath(module.key);
              return (
                <NavLink
                  key={module.key}
                  to={buildCRMModuleHref(module.key, searchParams)}
                  style={moduleButtonStyle(active, false)}
                >
                  <span style={moduleIconStyle(active)}>
                    <i className={module.icon} />
                  </span>
                  <span style={moduleButtonCopyStyle}>
                    <span style={moduleButtonTitleStyle(active)}>{module.title}</span>
                    <span style={moduleButtonDescriptionStyle(active)}>{module.description}</span>
                  </span>
                </NavLink>
              );
            })}
          </nav>
        ) : null}

        <section style={workspaceStyle(isMobile, isMobileHome)}>
          {isMobile && !isMobileHome && activeModule ? (
            <header style={mobileModuleHeaderStyle}>
              <button
                type="button"
                onClick={() => navigate("/crm/home")}
                style={mobileBackButtonStyle}
              >
                <i className="fas fa-arrow-left" />
                <span>返回</span>
              </button>
              <div style={mobileHeaderCopyStyle}>
                <div style={mobileHeaderTitleStyle}>{activeModule.title}</div>
                <div style={mobileHeaderDescriptionStyle}>{activeModule.description}</div>
              </div>
            </header>
          ) : null}
          <Outlet />
        </section>
      </section>
    </div>
  );
}

const pageShellStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
  padding: "28px clamp(18px, 4vw, 36px) 36px",
  background:
    "radial-gradient(circle at top left, var(--x-color-info-tint-strong), transparent 30%), radial-gradient(circle at top right, var(--x-color-accent-tint-strong), transparent 32%), linear-gradient(180deg, var(--x-color-canvas), var(--x-color-canvas-alt))",
  color: "var(--x-color-ink)",
  fontFamily: "var(--x-font-sans)",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  opacity: 0.72,
};

function contentStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(260px, 320px) minmax(0, 1fr)",
    gap: "22px",
    alignItems: "start",
  };
}

function moduleNavStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "12px",
    position: isMobile ? "static" : "sticky",
    top: isMobile ? undefined : "84px",
  };
}

function moduleButtonStyle(active: boolean, isMobile: boolean): CSSProperties {
  return {
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
    cursor: "pointer",
    textAlign: "left",
  };
}

function moduleIconStyle(active: boolean): CSSProperties {
  return {
    width: "56px",
    height: "56px",
    display: "grid",
    placeItems: "center",
    borderRadius: "16px",
    background: active
      ? "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))"
      : "var(--x-color-panel-alt)",
    color: active ? "white" : "var(--x-color-ink)",
    fontSize: "20px",
  };
}

const moduleButtonCopyStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

function moduleButtonTitleStyle(active: boolean): CSSProperties {
  return {
    fontSize: "16px",
    fontWeight: 700,
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink)",
  };
}

function moduleButtonDescriptionStyle(active: boolean): CSSProperties {
  return {
    fontSize: "13px",
    lineHeight: 1.6,
    color: active ? "var(--x-color-ink)" : "var(--x-color-ink-muted)",
  };
}

function workspaceStyle(isMobile: boolean, isMobileHome: boolean): CSSProperties {
  return {
    padding: isMobile ? (isMobileHome ? "0" : "16px") : "22px",
    borderRadius: "var(--x-radius-lg)",
    background: isMobileHome ? "transparent" : "var(--x-color-panel-glass)",
    border: isMobileHome ? "none" : "1px solid var(--x-color-line-soft)",
    boxShadow: isMobileHome ? "none" : "0 20px 44px var(--x-color-shadow-medium)",
    minWidth: 0,
  };
}

const mobileModuleHeaderStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  marginBottom: "14px",
};

const mobileBackButtonStyle: CSSProperties = {
  width: "fit-content",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "10px 14px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 10px 24px var(--x-color-shadow-soft)",
};

const mobileHeaderCopyStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

const mobileHeaderTitleStyle: CSSProperties = {
  fontSize: "22px",
  fontWeight: 800,
  lineHeight: 1.1,
};

const mobileHeaderDescriptionStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.6,
  color: "var(--x-color-ink-muted)",
};

const workspaceHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "end",
  paddingBottom: "16px",
  marginBottom: "20px",
  borderBottom: "1px solid var(--x-color-line-soft)",
};

const workspaceEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const workspaceTitleStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "28px",
  lineHeight: 1.1,
};

const workspaceHintStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

function gateStyle(isMobile: boolean): CSSProperties {
  return {
    maxWidth: "720px",
    margin: "48px auto",
    padding: isMobile ? "24px" : "32px",
    borderRadius: "var(--x-radius-lg)",
    background: "linear-gradient(160deg, var(--x-color-panel), var(--x-color-panel-alt))",
    boxShadow: "0 24px 60px var(--x-color-shadow-strong)",
  };
}

const gateTitleStyle: CSSProperties = {
  margin: "10px 0 12px",
  fontSize: "40px",
  color: "var(--x-color-ink)",
};

const gateBodyStyle: CSSProperties = {
  margin: 0,
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

const gateActionsStyle: CSSProperties = {
  display: "flex",
  gap: "12px",
  marginTop: "20px",
  flexWrap: "wrap",
};

const primaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "none",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};
