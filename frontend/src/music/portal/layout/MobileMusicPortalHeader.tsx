import type { CSSProperties } from "react";

import { CachedImage } from "../../../components/CachedMedia";
import { API_BASE } from "../../../js/apiBase";
import type { PortalNavItem, PortalNavKey } from "./portalNavItems";

export function MobileMusicPortalHeader({
  portalItems,
  activeKey,
  isAuthenticated,
  userLabel,
  loadingUser,
  loggingOut,
  onNavigate,
  onAccountClick,
}: {
  portalItems: PortalNavItem[];
  activeKey: PortalNavKey | null;
  isAuthenticated: boolean;
  userLabel: string;
  loadingUser: boolean;
  loggingOut: boolean;
  onNavigate: (path: string) => void;
  onAccountClick: () => Promise<void>;
}) {
  return (
    <header id="base_navbar" style={navbarStyle}>
      <div style={topRowStyle}>
        <div style={brandWrapStyle}>
          <div style={brandBadgeStyle}>
            <CachedImage
              src={`${API_BASE}/static/images/logo/logo.png`}
              cacheKey="music-portal-mobile-logo"
              alt="UTBA logo"
              style={brandLogoStyle}
            />
          </div>
          <div style={brandCopyStyle}>
            <div style={brandTitleStyle}>音乐入口</div>
            <div style={brandSubtitleStyle}>Music + Changyou</div>
          </div>
        </div>

        <button
          type="button"
          title={isAuthenticated ? `退出 ${userLabel}` : "登录"}
          onClick={() => void onAccountClick()}
          style={accountButtonStyle(isAuthenticated)}
        >
          <i className={isAuthenticated ? "fas fa-right-from-bracket" : "fas fa-right-to-bracket"} />
        </button>
      </div>

      <nav style={navGroupStyle}>
        {portalItems.map((item) => (
          <button
            key={item.key}
            type="button"
            title={item.title}
            aria-label={item.title}
            onClick={() => onNavigate(item.path)}
            style={navButtonStyle(activeKey === item.key)}
          >
            <i className={item.icon} />
            <span>{item.title}</span>
          </button>
        ))}
      </nav>

      <div style={statusRowStyle}>
        {loadingUser ? "载入中" : loggingOut ? "退出中" : isAuthenticated ? userLabel : "未登录"}
      </div>
    </header>
  );
}

const navbarStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
  padding: "12px 14px",
  background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
  position: "sticky",
  top: "0",
  zIndex: 1000,
  boxShadow: "0 16px 32px rgba(15, 23, 42, 0.18)",
};

const topRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
};

const brandWrapStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  minWidth: 0,
};

const brandBadgeStyle: CSSProperties = {
  width: "40px",
  height: "40px",
  borderRadius: "14px",
  display: "grid",
  placeItems: "center",
  background: "rgba(255,255,255,0.18)",
  overflow: "hidden",
  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
};

const brandLogoStyle: CSSProperties = {
  width: "26px",
  height: "26px",
  objectFit: "contain",
  display: "block",
};

const brandCopyStyle: CSSProperties = {
  display: "grid",
  gap: "2px",
  minWidth: 0,
};

const brandTitleStyle: CSSProperties = {
  color: "white",
  fontSize: "15px",
  fontWeight: 800,
  lineHeight: 1.1,
};

const brandSubtitleStyle: CSSProperties = {
  color: "rgba(255,255,255,0.78)",
  fontSize: "11px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const navGroupStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "10px",
};

function navButtonStyle(active: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    minHeight: "44px",
    padding: "0 14px",
    borderRadius: "14px",
    border: active ? "1px solid rgba(255,255,255,0.44)" : "1px solid rgba(255,255,255,0.16)",
    background: active ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
  };
}

function accountButtonStyle(active: boolean): CSSProperties {
  return {
    width: "42px",
    height: "42px",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,0.2)",
    background: active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)",
    color: "white",
    cursor: "pointer",
  };
}

const statusRowStyle: CSSProperties = {
  color: "rgba(255,255,255,0.78)",
  fontSize: "12px",
  lineHeight: 1.2,
};
