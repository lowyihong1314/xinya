import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import { useEnsureDesignTokens } from "../theme/designTokens";
import { apiFetch } from "../js/apiFetch";
import { clearAllNativeResponseCache } from "../js/nativeResponseCache";
import { navigateWithRouter } from "../router/navigationBridge";

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

type CurrentUserFetchResult = {
  user: UserData | null;
  state: "authenticated" | "unauthenticated" | "unavailable";
};

async function fetchCurrentUser(): Promise<CurrentUserFetchResult> {
  try {
    const response = await apiFetch("/api/user_control/get_user_data", {
      credentials: "include",
    });
    if (response.status === 401 || response.status === 403) {
      return { user: null, state: "unauthenticated" };
    }
    if (!response.ok) {
      throw new Error("User fetch unavailable");
    }
    const data = (await response.json()) as UserData;
    if (!data.username) {
      return { user: null, state: "unauthenticated" };
    }
    return { user: data, state: "authenticated" };
  } catch {
    return { user: null, state: "unavailable" };
  }
}

function navigateToLogin(from?: string) {
  const dest = from && from !== "/login" ? `/login?from=${encodeURIComponent(from)}` : "/login";
  navigateWithRouter(dest);
}

export function UserStateProvider({
  children,
  initialIsMobile = false,
}: {
  children: ReactNode;
  initialIsMobile?: boolean;
}) {
  useEnsureDesignTokens();

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

  async function refreshUser() {
    setLoadingUser(true);
    try {
      const nextUser = await fetchCurrentUser();
      if (nextUser.state === "unavailable") {
        return user;
      }

      if (nextUser.state === "unauthenticated") {
        setUser(null);
        void clearAllNativeResponseCache();
        return null;
      }

      setUser(nextUser.user);
      return nextUser.user;
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
    await clearAllNativeResponseCache();
    await refreshUser();
  }

  async function logout() {
    const response = await apiFetch("/api/user_control/logout", {
      credentials: "include",
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "退出失败");
    }
    await clearAllNativeResponseCache();
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
