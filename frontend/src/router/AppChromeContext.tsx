import {
  createContext,
  useContext,
  useLayoutEffect,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

type AppChromeContextValue = {
  navbarHeight: number;
  navbarVisible: boolean;
  setNavbarVisible: Dispatch<SetStateAction<boolean>>;
};

const AppChromeContext = createContext<AppChromeContextValue | null>(null);

export function AppChromeProvider({
  value,
  children,
}: {
  value: AppChromeContextValue;
  children: ReactNode;
}) {
  return <AppChromeContext.Provider value={value}>{children}</AppChromeContext.Provider>;
}

export function useAppChrome() {
  const context = useContext(AppChromeContext);
  if (!context) {
    throw new Error("useAppChrome must be used within AppChromeProvider");
  }
  return context;
}

export function useOptionalAppChrome() {
  return useContext(AppChromeContext);
}

export function useBaseNavbarVisibility(visible: boolean) {
  const chrome = useOptionalAppChrome();

  useLayoutEffect(() => {
    if (chrome) {
      chrome.setNavbarVisible(visible);

      return () => {
        chrome.setNavbarVisible(true);
      };
    }

    if (typeof document === "undefined") {
      return;
    }

    const navbar = document.getElementById("base_navbar");
    if (!navbar) {
      return;
    }

    const previousDisplay = navbar.style.display;
    navbar.style.display = visible ? previousDisplay : "none";

    return () => {
      navbar.style.display = previousDisplay;
    };
  }, [chrome, visible]);
}
