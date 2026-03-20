import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

import { reset_style } from "../../../js/reset_style";

export function LegacyAccountPanel({
  mount,
  resetBeforeMount = true,
}: {
  mount: (node: HTMLElement) => void | Promise<void>;
  resetBeforeMount?: boolean;
}) {
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
    node.innerHTML = "";
    void mount(node);
  }, [mount, resetBeforeMount]);

  return <div ref={containerRef} style={panelMountStyle} />;
}

const panelMountStyle: CSSProperties = {
  minHeight: "560px",
};
