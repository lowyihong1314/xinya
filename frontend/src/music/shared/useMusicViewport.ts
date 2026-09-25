import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { useOptionalAppChrome } from "../../router/AppChromeContext";

/**
 * 音乐各模块统一的「可用高度」：视口高度减去顶栏（顶栏隐藏时为 0）。
 * 页面外壳用 shellStyle 把自己钉在这个高度里、内部滚动，就不会撑出屏幕。
 */
export function useMusicViewport() {
  const chrome = useOptionalAppChrome();
  const [innerHeight, setInnerHeight] = useState(() =>
    typeof window === "undefined" ? 800 : Math.round(window.visualViewport?.height || window.innerHeight),
  );
  const [fallbackNavbarHeight, setFallbackNavbarHeight] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    const measure = () => {
      setInnerHeight(Math.round(window.visualViewport?.height || window.innerHeight));
      if (!chrome) {
        const navbar = document.getElementById("base_navbar");
        setFallbackNavbarHeight(navbar ? Math.round(navbar.getBoundingClientRect().height) : 0);
      }
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [chrome]);

  const navbarHeight = chrome ? (chrome.navbarVisible ? chrome.navbarHeight : 0) : fallbackNavbarHeight;
  const contentHeight = Math.max(240, innerHeight - navbarHeight);

  const shellStyle = useMemo<CSSProperties>(
    () => ({
      height: `${contentHeight}px`,
      maxHeight: `${contentHeight}px`,
      minHeight: 0,
      overflowY: "auto",
      overflowX: "hidden",
      boxSizing: "border-box",
      WebkitOverflowScrolling: "touch",
    }),
    [contentHeight],
  );

  return { navbarHeight, innerHeight, contentHeight, contentHeightCss: `${contentHeight}px`, shellStyle };
}
