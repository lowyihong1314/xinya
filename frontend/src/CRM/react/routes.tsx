import type { RouteObject } from "react-router-dom";
import { Navigate, useLocation } from "react-router-dom";

import { useUserState } from "../../app/UserState";
import { CRMPage } from "./CRMPage";
import { CRMHomePage } from "./CRMHomePage";
import { CRM_MODULES, DEFAULT_CRM_MODULE_KEY, buildCRMModuleHref } from "./crmModules";

function CRMEntryRedirect() {
  const location = useLocation();
  const { isMobile } = useUserState();
  const searchParams = new URLSearchParams(location.search);
  const rawKey = searchParams.get("crm") ?? searchParams.get("CRM");

  if (rawKey) {
    return <Navigate to={buildCRMModuleHref(rawKey, searchParams)} replace />;
  }

  if (isMobile) {
    return <Navigate to="/crm/home" replace />;
  }

  return <Navigate to={buildCRMModuleHref(DEFAULT_CRM_MODULE_KEY, searchParams)} replace />;
}

export const crmRoute: RouteObject = {
  path: "crm",
  element: <CRMPage />,
  children: [
    { index: true, element: <CRMEntryRedirect /> },
    { path: "home", element: <CRMHomePage /> },
    ...CRM_MODULES.map((module) => ({
      path: module.key,
      element: <module.Component />,
    })),
    {
      path: "membership_registration",
      element: <Navigate to={buildCRMModuleHref("membership_registration")} replace />,
    },
    {
      path: "youth_class_registration",
      element: <Navigate to={buildCRMModuleHref("youth_class_registration")} replace />,
    },
    { path: "*", element: <CRMEntryRedirect /> },
  ],
};
