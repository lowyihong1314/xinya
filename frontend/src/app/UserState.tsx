import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import { ensureDesignTokens } from "../theme/designTokens";
import { apiFetch } from "../js/apiFetch";

type UserData = {
  username?: string;
  [key: string]: unknown;
};

type UserStateContextValue = {
  user: UserData | null;
  isAuthenticated: boolean;
  isMobile: boolean;
  loginOpen: boolean;
  loadingUser: boolean;
  refreshUser: () => Promise<UserData | null>;
  openLogin: () => void;
  closeLogin: () => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const UserStateContext = createContext<UserStateContextValue | null>(null);

async function fetchCurrentUser(): Promise<UserData | null> {
  try {
    const response = await apiFetch("/api/user_control/get_user_data", {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error("Unauthenticated");
    }
    const data = (await response.json()) as UserData;
    return data.username ? data : null;
  } catch {
    return null;
  }
}

export function UserStateProvider({
  children,
  initialIsMobile = false,
}: {
  children: ReactNode;
  initialIsMobile?: boolean;
}) {
  ensureDesignTokens();

  const [user, setUser] = useState<UserData | null>(null);
  const [isMobile, setIsMobile] = useState(initialIsMobile);
  const [loadingUser, setLoadingUser] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    void refreshUser();
    const handleFocus = () => {
      void refreshUser();
    };
    const handleResize = () => {
      setIsMobile(window.matchMedia("(max-width: 900px)").matches);
    };

    handleResize();
    window.addEventListener("focus", handleFocus);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    window.__xinyaFetchUserAuth = async () => user;
    window.__xinyaOpenLogin = () => setLoginOpen(true);
    return () => {
      delete window.__xinyaFetchUserAuth;
      delete window.__xinyaOpenLogin;
    };
  }, [user]);

  async function refreshUser() {
    setLoadingUser(true);
    try {
      const nextUser = await fetchCurrentUser();
      setUser(nextUser);
      return nextUser;
    } finally {
      setLoadingUser(false);
    }
  }

  async function login(username: string, password: string) {
    const response = await apiFetch("/api/user_control/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "登录失败");
    }
    await refreshUser();
    setLoginOpen(false);
  }

  async function logout() {
    const response = await apiFetch("/api/user_control/logout", { credentials: "include" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "退出失败");
    }
    setUser(null);
  }

  const value = useMemo<UserStateContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user?.username),
      isMobile,
      loginOpen,
      loadingUser,
      refreshUser,
      openLogin: () => setLoginOpen(true),
      closeLogin: () => setLoginOpen(false),
      login,
      logout,
    }),
    [user, isMobile, loginOpen, loadingUser],
  );

  return (
    <UserStateContext.Provider value={value}>
      {children}
      <LoginModal />
    </UserStateContext.Provider>
  );
}

export function useUserState() {
  const context = useContext(UserStateContext);
  if (!context) {
    throw new Error("useUserState must be used within UserStateProvider");
  }
  return context;
}

function LoginModal() {
  const { loginOpen, closeLogin, login } = useUserState();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loginOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeLogin();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loginOpen, closeLogin]);

  useEffect(() => {
    if (!loginOpen) {
      setUsername("");
      setPassword("");
      setError(null);
      setSubmitting(false);
    }
  }, [loginOpen]);

  if (!loginOpen) {
    return null;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={(event) => event.target === event.currentTarget && closeLogin()}>
      <div style={modalStyle}>
        <div style={eyebrowStyle}>User Access</div>
        <h2 style={titleStyle}>登录</h2>
        <p style={copyStyle}>登录后，导航栏和页面编辑模式会立即同步切换。</p>
        <form onSubmit={handleSubmit} style={formStyle}>
          <label style={labelStyle}>
            <span>Username</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              style={inputStyle}
              required
            />
          </label>
          <label style={labelStyle}>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={inputStyle}
              required
            />
          </label>
          {error ? <div style={errorStyle}>{error}</div> : null}
          <div style={actionsStyle}>
            <button type="button" style={ghostButtonStyle} onClick={closeLogin}>
              Cancel
            </button>
            <button type="submit" style={primaryButtonStyle} disabled={submitting}>
              {submitting ? "Logging in..." : "Login"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(8,15,25,0.58)",
  display: "grid",
  alignContent: "center",
  justifyItems: "center",
  overflowY: "auto",
  padding: "24px",
  zIndex: 9999,
} as const;

const modalStyle = {
  width: "min(440px, 100%)",
  borderRadius: "var(--x-radius-lg)",
  background: "linear-gradient(145deg, var(--x-color-nav-start), var(--x-color-nav-end))",
  color: "white",
  boxShadow: "0 30px 80px rgba(0,0,0,0.28)",
  padding: "28px",
} as const;

const eyebrowStyle = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  opacity: 0.75,
} as const;

const titleStyle = {
  margin: "12px 0 8px",
  fontSize: "32px",
} as const;

const copyStyle = {
  margin: 0,
  lineHeight: 1.7,
  opacity: 0.86,
} as const;

const formStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "14px",
  marginTop: "20px",
} as const;

const labelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  fontSize: "14px",
} as const;

const inputStyle = {
  border: "none",
  borderRadius: "var(--x-radius-sm)",
  padding: "12px 14px",
  fontSize: "15px",
  outline: "none",
} as const;

const actionsStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  marginTop: "8px",
} as const;

const primaryButtonStyle = {
  border: "none",
  borderRadius: "999px",
  padding: "11px 16px",
  background: "white",
  color: "var(--x-color-nav-start)",
  fontWeight: 700,
  cursor: "pointer",
} as const;

const ghostButtonStyle = {
  border: "1px solid rgba(255,255,255,0.34)",
  borderRadius: "999px",
  padding: "11px 16px",
  background: "transparent",
  color: "white",
  fontWeight: 600,
  cursor: "pointer",
} as const;

const errorStyle = {
  borderRadius: "var(--x-radius-sm)",
  background: "rgba(194,65,12,0.22)",
  color: "#fff0e6",
  padding: "10px 12px",
  fontSize: "14px",
} as const;
