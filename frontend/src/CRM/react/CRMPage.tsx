import { useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";

import { useUserState } from "../../app/UserState";
import { ensureDesignTokens } from "../../theme/designTokens";
import { LegacyCRMPanel } from "./LegacyCRMPanel";
import { CRM_MODULES, DEFAULT_CRM_MODULE_KEY, getCRMModule, isCRMModuleKey } from "./crmModules";

export function CRMPage() {
  ensureDesignTokens();

  const { isAuthenticated, openLogin, isMobile } = useUserState();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeKey = useMemo(() => {
    const nextKey = searchParams.get("crm") ?? searchParams.get("CRM");
    return isCRMModuleKey(nextKey) ? nextKey : DEFAULT_CRM_MODULE_KEY;
  }, [searchParams]);

  const activeModule = getCRMModule(activeKey);

  useEffect(() => {
    const legacyKey = searchParams.get("CRM");
    const lowerKey = searchParams.get("crm");
    if (lowerKey === activeKey && !legacyKey) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("CRM");
    nextParams.set("crm", activeKey);
    setSearchParams(nextParams, { replace: true });
  }, [activeKey, searchParams, setSearchParams]);

  if (!isAuthenticated) {
    return (
      <div style={pageShellStyle}>
        <section style={gateStyle(isMobile)}>
          <div style={eyebrowStyle}>CRM Access</div>
          <h1 style={gateTitleStyle}>请先登录后台</h1>
          <p style={gateBodyStyle}>CRM 入口已经切到 React Router，模块切换和状态同步现在由 React 负责。</p>
          <div style={gateActionsStyle}>
            <button type="button" style={primaryButtonStyle} onClick={openLogin}>
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
        <nav style={moduleNavStyle(isMobile)}>
          {CRM_MODULES.map((module) => {
            const active = module.key === activeModule.key;
            return (
              <button
                key={module.key}
                type="button"
                onClick={() => {
                  const nextParams = new URLSearchParams(searchParams);
                  nextParams.delete("CRM");
                  nextParams.set("crm", module.key);
                  setSearchParams(nextParams);
                }}
                style={moduleButtonStyle(active, isMobile)}
              >
                <span style={moduleIconStyle(active)}>
                  <i className={module.icon} />
                </span>
                <span style={moduleButtonCopyStyle}>
                  <span style={moduleButtonTitleStyle(active)}>{module.title}</span>
                  <span style={moduleButtonDescriptionStyle(active)}>{module.description}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <section style={workspaceStyle(isMobile)}>
          {activeModule.panelType === "react" ? (
            <activeModule.Component />
          ) : (
            <LegacyCRMPanel module={activeModule} />
          )}
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

function workspaceStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "16px" : "22px",
    borderRadius: "var(--x-radius-lg)",
    background: "var(--x-color-panel-glass)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 20px 44px var(--x-color-shadow-medium)",
    minWidth: 0,
  };
}

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
