import { createHashRouter, Navigate, useParams } from "react-router-dom";

import { CRMPage } from "../CRM/react/CRMPage";
import { HomeAlbumPage } from "../album/react/HomeAlbumPage";
import { EventDetailPage } from "../album/react/EventDetailPage";
import { ImageDetailPageRoute } from "../album/react/ImageDetailPage";
import { InfoPage } from "../info/react/InfoPage";
import { LampPage } from "../lamp/react/LampPage";
import {
  CHANGYOU_PATH,
  CHANGYOU_ROOM_PATH,
  getChangyouDetailPath,
  getChangyouRoomPath,
} from "../music/router/paths";
import { musicRoute } from "../music/router/routes";
import { ProfilePage } from "../profile/react/ProfilePage";
import { PaymentVoucherSignPage } from "../CRM/Account/react/claim/PaymentVoucherSignPage";
import { LoginPage } from "../app/LoginPage";
import { AppLayout } from "./AppLayout";

function ErrorPage({ message }: { message: string }) {
  return (
    <div id="app" style={{ minHeight: "calc(100vh - 60px)", padding: "24px", color: "#b42318" }}>
      {message}
    </div>
  );
}

function LegacyChangyouDetailRedirect() {
  const { entryId } = useParams();
  return <Navigate to={entryId ? getChangyouDetailPath(entryId) : CHANGYOU_PATH} replace />;
}

function LegacyChangyouRoomRedirect() {
  const { roomId } = useParams();
  return <Navigate to={roomId ? getChangyouRoomPath(roomId) : CHANGYOU_ROOM_PATH} replace />;
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
      musicRoute,
      { path: "lamp-registration", element: <LampPage /> },
      { path: "event/:eventId", element: <EventDetailPage /> },
      { path: "image/:imageId", element: <ImageDetailPageRoute /> },
      { path: "login", element: <LoginPage /> },
      { path: "not-found", element: <ErrorPage message="页面不存在" /> },
      { path: "*", element: <ErrorPage message="页面不存在" /> },
    ],
  },
  { path: "/changyou", element: <Navigate to={CHANGYOU_PATH} replace /> },
  { path: "/changyou/:entryId", element: <LegacyChangyouDetailRedirect /> },
  { path: "/changyou-room", element: <Navigate to={CHANGYOU_ROOM_PATH} replace /> },
  { path: "/changyou-room/:roomId", element: <LegacyChangyouRoomRedirect /> },
  { path: "/payment-voucher-sign/:token", element: <PaymentVoucherSignPage /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);
