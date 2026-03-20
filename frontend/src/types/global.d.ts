/// <reference types="vite/client" />

declare global {
  interface Window {
    app?: HTMLElement | null;
    base_navbar?: HTMLElement | null;
    __xinyaNavigate?: (page: string, options?: { replace?: boolean }) => void;
    __xinyaFetchUserAuth?: () => Promise<unknown | null>;
    __xinyaOpenLogin?: () => void;
  }
}

export {};
