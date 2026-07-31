import { useEffect, useState } from "react";
import { createHashRouter, Navigate, useNavigate, useParams } from "react-router-dom";

import { LongOpenRegistrationFormPage } from "../CRM/long_open_registration_form/react/LongOpenRegistrationFormPage";
import { CRMPage } from "../CRM/react/CRMPage";
import { crmRoute } from "../CRM/react/routes";
import { LONG_OPEN_REGISTRATION_FORM_PATH } from "../CRM/react/crmModules";
import { FahuiIntakePage } from "../CRM/fahui/FahuiIntakePage";
import { HomeAlbumPage } from "../album/react/HomeAlbumPage";
import { EventDetailPage } from "../album/react/EventDetailPage";
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
import { apiFetch } from "../js/apiFetch";
import { AppLayout } from "./AppLayout";

type LegacyImagePayload = {
  status?: string;
  message?: string;
  data?: {
    file?: {
      id?: number;
      event_id?: number | null;
    };
    event?: {
      id?: number;
    } | null;
  };
};

function ErrorPage({ message }: { message: string }) {
  return (
    <div id="app" style={{ minHeight: "calc(100vh - 60px)", padding: "24px", color: "#b42318" }}>
      {message}
    </div>
  );
}

// 点灯法会开放时间由 CRM「开放时间设置」维护：开放期内正常显示登记页，
// 截止期间提示后自动跳转盂兰盆牌位登记。
function LampRegistrationGate() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/fahui_router/open_windows?key=lamp")
      .then((res) => res.json())
      .then((payload: { data?: { is_open?: boolean } }) => {
        if (!cancelled) setIsOpen(Boolean(payload?.data?.is_open));
      })
      .catch(() => {
        // 状态查询失败时不拦路，放行到登记页（后端仍会拦截提交）。
        if (!cancelled) setIsOpen(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isOpen !== false) return;
    const timer = window.setTimeout(() => navigate("/ylp-registration", { replace: true }), 2500);
    return () => window.clearTimeout(timer);
  }, [isOpen, navigate]);

  if (isOpen == null) return null;
  if (isOpen) return <LampPage />;
  return (
    <div style={{ minHeight: "calc(100vh - 60px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", padding: "24px", textAlign: "center" }}>
      <p style={{ margin: 0, fontSize: "17px", fontWeight: 700 }}>点灯法会登记目前未开放</p>
      <p style={{ margin: 0, fontSize: "14px", color: "#667085" }}>正在为你跳转到「盂兰盆法会 · 牌位登记」…</p>
      <a href="/#/ylp-registration" style={{ fontSize: "14px" }}>没有跳转？点这里前往</a>
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

function LegacyImageRedirect() {
  const { imageId } = useParams();
  const [target, setTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!imageId) {
      setError("缺少图片 ID");
      return;
    }

    let active = true;
    setError(null);
    setTarget(null);

    void (async () => {
      try {
        const response = await apiFetch(`/api/api/get_file_data/${imageId}`, { credentials: "include" });
        const payload = (await response.json().catch(() => ({}))) as LegacyImagePayload;
        if (!response.ok || payload.status !== "success") {
          throw new Error(payload.message || "读取媒体失败");
        }
        const eventId = payload.data?.event?.id ?? payload.data?.file?.event_id;
        if (!eventId) {
          throw new Error("找不到图片所属活动");
        }
        if (active) {
          setTarget(`/event/${eventId}?img_id=${imageId}`);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "读取媒体失败");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [imageId]);

  if (target) {
    return <Navigate to={target} replace />;
  }

  return (
    <div
      id="legacy-image-redirect"
      style={{
        minHeight: "calc(100vh - 60px)",
        padding: "24px",
        color: error ? "#b42318" : "var(--x-color-ink)",
      }}
    >
      {error || "媒体跳转中…"}
    </div>
  );
}

export const appRouter = createHashRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <HomeAlbumPage /> },
      { path: "info", element: <Navigate to="/info/history" replace /> },
      { path: "info/:section", element: <InfoPage /> },
      crmRoute,
      {
        path: LONG_OPEN_REGISTRATION_FORM_PATH.replace(/^\//, ""),
        element: <CRMPage />,
        children: [{ index: true, element: <LongOpenRegistrationFormPage /> }],
      },
      { path: "profile", element: <Navigate to="/profile/overview" replace /> },
      { path: "profile/:section", element: <ProfilePage /> },
      musicRoute,
      { path: "ylp-registration", element: <FahuiIntakePage /> },
      { path: "lamp-registration", element: <LampRegistrationGate /> },
      { path: "event/:eventId", element: <EventDetailPage /> },
      { path: "image/:imageId", element: <LegacyImageRedirect /> },
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
