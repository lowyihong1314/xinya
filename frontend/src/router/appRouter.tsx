import { createHashRouter, Navigate } from "react-router-dom";

import { CRMPage } from "../CRM/react/CRMPage";
import { HomeAlbumPage } from "../album/react/HomeAlbumPage";
import { EventDetailPage } from "../album/react/EventDetailPage";
import { ImageDetailPage } from "../album/react/ImageDetailPage";
import { InfoPage } from "../info/react/InfoPage";
import { LampPage } from "../lamp/react/LampPage";
import { MusicPage } from "../music/react/MusicPage";
import { ProfilePage } from "../profile/react/ProfilePage";
import { PaymentVoucherSignPage } from "../CRM/Account/react/claim/PaymentVoucherSignPage";
import { AppLayout } from "./AppLayout";

function ErrorPage({ message }: { message: string }) {
  return (
    <div id="app" style={{ minHeight: "calc(100vh - 60px)", padding: "24px", color: "#b42318" }}>
      {message}
    </div>
  );
}

function LoginPage() {
  window.__xinyaOpenLogin?.();
  return <Navigate to="/" replace />;
}

export const appRouter = createHashRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <HomeAlbumPage /> },
      { path: "info", element: <InfoPage /> },
      { path: "crm", element: <CRMPage /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "music", element: <MusicPage /> },
      { path: "lamp-registration", element: <LampPage /> },
      { path: "event/:eventId", element: <EventDetailPage /> },
      { path: "image/:imageId", element: <ImageDetailPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "not-found", element: <ErrorPage message="页面不存在" /> },
      { path: "*", element: <ErrorPage message="页面不存在" /> },
    ],
  },
  { path: "/payment-voucher-sign/:token", element: <PaymentVoucherSignPage /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);
