import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { resolveLegacyPath } from "./AppLayout";

export function LegacyQueryRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    const url = new URL(window.location.href);
    const page = url.searchParams.get("page");
    if (!page) {
      return;
    }

    const target = resolveLegacyPath(page, url);
    navigate(target, { replace: true });
  }, [navigate]);

  return null;
}
