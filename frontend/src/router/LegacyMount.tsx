import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

import { reset_style } from "../js/reset_style";

type LegacyMountProps = {
  mount: (node: HTMLElement) => void | Promise<void>;
  resetBeforeMount?: boolean;
};

export function LegacyMount({ mount, resetBeforeMount = true }: LegacyMountProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    window.app = node;
    if (resetBeforeMount) {
      reset_style();
    }
    void mount(node);
  }, [mount, resetBeforeMount]);

  return <div id="app" ref={containerRef} style={appStyle} />;
}

const appStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
};
