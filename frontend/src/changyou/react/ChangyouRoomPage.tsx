import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useUserState } from "../../app/UserState";
import { ensureDesignTokens } from "../../theme/designTokens";

export function ChangyouRoomPage() {
  ensureDesignTokens();

  const navigate = useNavigate();
  const { isAuthenticated, loadingUser, openLogin } = useUserState();

  useEffect(() => {
    if (!loadingUser && !isAuthenticated) {
      openLogin();
    }
  }, [loadingUser, isAuthenticated, openLogin]);

  if (loadingUser) return <div style={stateStyle}>加载中…</div>;
  if (!isAuthenticated) return <div style={stateStyle}>请先登录后再访问房间页面。</div>;

  return (
    <div style={pageStyle}>
      <div style={topBarStyle}>
        <button type="button" onClick={() => navigate("/changyou")} style={backButtonStyle}>
          ← 返回唱游歌簿
        </button>
      </div>

      <div style={contentStyle}>
        <div style={eyebrowStyle}>Changyou Room</div>
        <h1 style={titleStyle}>房间</h1>
        <p style={subtitleStyle}>这是独立入口页，当前先保留空白，后续可以继续接房间功能。</p>
      </div>
    </div>
  );
}

const pageStyle = {
  minHeight: "100vh",
  padding: "20px",
  background: "linear-gradient(180deg, var(--x-color-canvas), var(--x-color-canvas-alt))",
  boxSizing: "border-box" as const,
} as const;
const topBarStyle = { display: "flex", justifyContent: "flex-start", marginBottom: "20px" } as const;
const backButtonStyle = { padding: "12px 16px", borderRadius: "999px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 800, cursor: "pointer" } as const;
const contentStyle = { width: "min(960px, 100%)", margin: "0 auto", padding: "24px", borderRadius: "24px", background: "var(--x-color-panel-strongest)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 18px 40px var(--x-color-shadow-soft)" } as const;
const eyebrowStyle = { fontSize: "12px", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" } as const;
const titleStyle = { margin: "8px 0 0", fontSize: "32px", fontWeight: 900, color: "var(--x-color-ink)" } as const;
const subtitleStyle = { margin: "12px 0 0", fontSize: "15px", lineHeight: 1.7, color: "var(--x-color-ink-muted)" } as const;
const stateStyle = { minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--x-color-ink-muted)" } as const;
