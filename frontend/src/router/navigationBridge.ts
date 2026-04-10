import { useEffect } from "react";
import { useNavigate, type NavigateOptions, type To } from "react-router-dom";

type RouterNavigate = (to: To | number, options?: NavigateOptions) => void;
type PendingNavigation = {
  to: To | number;
  options?: NavigateOptions;
};

const routerNavigateStack: RouterNavigate[] = [];
const pendingNavigations: PendingNavigation[] = [];

function registerRouterNavigate(navigate: RouterNavigate) {
  routerNavigateStack.push(navigate);

  return () => {
    const index = routerNavigateStack.lastIndexOf(navigate);
    if (index !== -1) {
      routerNavigateStack.splice(index, 1);
    }
  };
}

function getActiveRouterNavigate() {
  return routerNavigateStack[routerNavigateStack.length - 1] || null;
}

export function navigateWithRouter(to: To | number, options?: NavigateOptions) {
  const navigate = getActiveRouterNavigate();
  if (!navigate) {
    pendingNavigations.push({ to, options });
    console.warn("Router navigation bridge is not mounted yet; navigation request was queued.");
    return false;
  }

  navigate(to, options);
  return true;
}

export function useRegisterRouterNavigation() {
  const navigate = useNavigate();

  useEffect(() => registerRouterNavigate((to, options) => {
    if (typeof to === "number") {
      navigate(to);
      return;
    }
    navigate(to, options);
  }), [navigate]);

  useEffect(() => {
    if (!pendingNavigations.length) {
      return;
    }

    const queued = pendingNavigations.splice(0, pendingNavigations.length);
    queued.forEach(({ to, options }) => {
      if (typeof to === "number") {
        navigate(to);
        return;
      }
      navigate(to, options);
    });
  }, [navigate]);
}
