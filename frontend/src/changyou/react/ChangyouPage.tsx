import { useEffect } from "react";

import { useUserState } from "../../app/UserState";
import { ensureDesignTokens } from "../../theme/designTokens";

export function ChangyouPage() {
  ensureDesignTokens();

  const { isAuthenticated, loadingUser, openLogin } = useUserState();

  useEffect(() => {
    if (!loadingUser && !isAuthenticated) {
      openLogin();
    }
  }, [loadingUser, isAuthenticated, openLogin]);

  if (loadingUser) {
    return <div style={stateStyle}>加载中…</div>;
  }

  if (!isAuthenticated) {
    return <div style={stateStyle}>请先登录后再访问唱游页面。</div>;
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={eyebrowStyle}>Dharma CRM</div>
        <h1 style={titleStyle}>唱游</h1>
        <p style={subtitleStyle}>页面内容暂时留空，后续再补。</p>
      </div>
    </div>
  );
}

const pageStyle = {
  minHeight: "calc(100vh - 60px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  background:
    "radial-gradient(circle at top left, var(--x-color-accent-tint-strong), var(--x-color-canvas) 42%, var(--x-color-canvas-alt) 100%)",
} as const;

const cardStyle = {
  width: "min(680px, 100%)",
  padding: "28px",
  borderRadius: "24px",
  background: "var(--x-color-panel-strongest)",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 20px 50px var(--x-color-shadow-soft)",
  textAlign: "center",
} as const;

const eyebrowStyle = {
  fontSize: "12px",
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
  marginBottom: "10px",
} as const;

const titleStyle = {
  margin: 0,
  fontSize: "32px",
  fontWeight: 900,
  color: "var(--x-color-ink)",
} as const;

const subtitleStyle = {
  margin: "12px 0 0",
  fontSize: "14px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
} as const;

const stateStyle = {
  minHeight: "calc(100vh - 60px)",
  display: "grid",
  placeItems: "center",
  padding: "24px",
  color: "var(--x-color-ink-muted)",
} as const;
