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
  loadingUser: boolean;
  refreshUser: () => Promise<UserData | null>;
  openLogin: (from?: string) => void;
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

function navigateToLogin(from?: string) {
  const dest = from && from !== "/login" ? `/login?from=${encodeURIComponent(from)}` : "/login";
  window.location.hash = dest;
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
    window.__xinyaOpenLogin = () => navigateToLogin();
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
      loadingUser,
      refreshUser,
      openLogin: navigateToLogin,
      login,
      logout,
    }),
    [user, isMobile, loadingUser],
  );

  return (
    <UserStateContext.Provider value={value}>
      {children}
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
