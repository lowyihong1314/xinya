import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { CachedImage } from "../components/CachedMedia";
import { API_BASE } from "../js/apiBase";
import { useUserState } from "./UserState";

export function LoginPage() {
  const { login, isAuthenticated } = useUserState();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from") ?? "/";
  // next：登录后跳转的完整地址（用于成员终端等 SPA 之外的页面）
  const next = searchParams.get("next");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isAuthenticated) {
    if (next) {
      window.location.assign(next);
      return null;
    }
    navigate(from, { replace: true });
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      if (next) {
        window.location.assign(next);
        return;
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
      setSubmitting(false);
    }
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={brandSideStyle}>
          <CachedImage
            src={`${API_BASE}/static/images/logo/logo.png`}
            cacheKey="login-logo"
            alt="logo"
            style={logoStyle}
          />
          <div style={brandEyebrowStyle}> UTBA</div>
          <h1 style={brandTitleStyle}>欢迎回来</h1>
          <p style={brandCopyStyle}>登录后，导航栏和页面编辑模式会立即同步切换。</p>
        </div>

        <div style={formSideStyle}>
          <div style={formEyebrowStyle}>User Access</div>
          <h2 style={formTitleStyle}>登录</h2>
          <form onSubmit={handleSubmit} style={formStyle}>
            <label style={labelStyle}>
              <span style={labelTextStyle}>Username</span>
              <input
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={inputStyle}
                required
              />
            </label>
            <label style={labelStyle}>
              <span style={labelTextStyle}>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
                required
              />
            </label>
            {error ? <div style={errorStyle}>{error}</div> : null}
            <div style={actionsStyle}>
              <button
                type="button"
                style={ghostButtonStyle}
                onClick={() => navigate(from === "/login" ? "/" : from, { replace: true })}
              >
                返回
              </button>
              <button type="submit" style={primaryButtonStyle} disabled={submitting}>
                {submitting ? "登录中…" : "登录"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  overflowX: "hidden",
  background: "var(--x-color-canvas)",
};

const cardStyle: CSSProperties = {
  width: "min(860px, 100%)",
  display: "flex",
  flexWrap: "wrap",
  borderRadius: "var(--x-radius-lg)",
  overflow: "hidden",
  boxShadow: "0 30px 80px rgba(0,0,0,0.18)",
};

const brandSideStyle: CSSProperties = {
  flex: "1 1 260px",
  minWidth: 0,
  background: "linear-gradient(145deg, var(--x-color-nav-start), var(--x-color-nav-end))",
  color: "white",
  padding: "32px 24px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const logoStyle: CSSProperties = {
  width: "72px",
  height: "72px",
  borderRadius: "18px",
  objectFit: "contain",
  background: "rgba(255,255,255,0.15)",
};

const brandEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  opacity: 0.75,
  marginTop: "8px",
};

const brandTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "28px",
  fontWeight: 700,
};

const brandCopyStyle: CSSProperties = {
  margin: 0,
  lineHeight: 1.7,
  opacity: 0.82,
  fontSize: "15px",
};

const formSideStyle: CSSProperties = {
  flex: "1 1 280px",
  minWidth: 0,
  background: "var(--x-color-surface)",
  padding: "32px 24px",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};

const formEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  opacity: 0.5,
  color: "var(--x-color-ink)",
};

const formTitleStyle: CSSProperties = {
  margin: "0 0 16px",
  fontSize: "26px",
  color: "var(--x-color-ink)",
};

const formStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "14px",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const labelTextStyle: CSSProperties = {
  fontSize: "14px",
  color: "var(--x-color-ink)",
  opacity: 0.8,
};

const inputStyle: CSSProperties = {
  border: "1px solid rgba(0,0,0,0.14)",
  borderRadius: "var(--x-radius-sm)",
  padding: "12px 14px",
  fontSize: "15px",
  outline: "none",
  background: "var(--x-color-canvas)",
  color: "var(--x-color-ink)",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  marginTop: "8px",
};

const primaryButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "999px",
  padding: "11px 20px",
  background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "15px",
};

const ghostButtonStyle: CSSProperties = {
  border: "1px solid rgba(0,0,0,0.18)",
  borderRadius: "999px",
  padding: "11px 16px",
  background: "transparent",
  color: "var(--x-color-ink)",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: "15px",
};

const errorStyle: CSSProperties = {
  borderRadius: "var(--x-radius-sm)",
  background: "rgba(194,65,12,0.12)",
  color: "#c24108",
  padding: "10px 12px",
  fontSize: "14px",
};
