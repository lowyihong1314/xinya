import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

import { reset_style } from "../../js/reset_style";
import type { CRMModuleSpec } from "./crmModules";

export function LegacyCRMPanel({
  module,
  resetBeforeMount = true,
}: {
  module: CRMModuleSpec;
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
    void module.render(node);
  }, [module, resetBeforeMount]);

  return <div ref={containerRef} style={panelMountStyle} />;
}

const panelMountStyle: CSSProperties = {
  minHeight: "640px",
};
