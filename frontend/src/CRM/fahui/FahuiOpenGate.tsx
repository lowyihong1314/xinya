import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { useUserState } from "../../app/UserState";
import { fetchAllFahuiOpenWindows, type FahuiOpenWindowStatus } from "./api";

const FAHUI_ROUTES: Record<string, string> = {
  ylp: "/ylp-registration",
  lamp: "/lamp-registration",
};

const FAHUI_LABELS: Record<string, string> = {
  ylp: "盂兰盆法会 · 牌位登记",
  lamp: "点灯法会 · 供灯登记",
};

function formatMd(md: string) {
  const [month, day] = md.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

// 法会公开报名页的开放时间闸门：
// - 本法会开放（或已登录 CRM 用户）→ 正常渲染登记页
// - 本法会未开放但有别的法会开放 → 提示后自动跳转过去
// - 全部未开放 → 显示本法会的开放时间，请访客开放期间再来
export function FahuiOpenGate({ selfKey, children }: { selfKey: "ylp" | "lamp"; children: ReactNode }) {
  const navigate = useNavigate();
  const { isAuthenticated } = useUserState();
  const [statuses, setStatuses] = useState<FahuiOpenWindowStatus[] | null | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    fetchAllFahuiOpenWindows()
      .then((res) => {
        if (!cancelled) setStatuses(res.data.items || []);
      })
      .catch(() => {
        // 状态查询失败时放行显示（后端提交仍会拦截）。
        if (!cancelled) setStatuses(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selfStatus = Array.isArray(statuses) ? statuses.find((item) => item.fahui_key === selfKey) : null;
  const selfOpen = !Array.isArray(statuses) || !selfStatus ? true : selfStatus.is_open;
  const openOther = Array.isArray(statuses)
    ? statuses.find((item) => item.fahui_key !== selfKey && item.is_open && FAHUI_ROUTES[item.fahui_key])
    : null;
  const redirectPath = !selfOpen && !isAuthenticated && openOther ? FAHUI_ROUTES[openOther.fahui_key] : null;

  useEffect(() => {
    if (!redirectPath) return;
    const timer = window.setTimeout(() => navigate(redirectPath, { replace: true }), 2500);
    return () => window.clearTimeout(timer);
  }, [redirectPath, navigate]);

  if (statuses === "loading") return null;
  if (selfOpen || isAuthenticated) return <>{children}</>;

  const selfLabel = FAHUI_LABELS[selfKey] || selfKey;

  if (openOther) {
    const otherLabel = FAHUI_LABELS[openOther.fahui_key] || openOther.fahui_key;
    return (
      <div style={pageStyle}>
        <p style={titleStyle}>{selfLabel}目前未开放</p>
        <p style={noteStyle}>「{otherLabel}」正在开放，正在为你跳转…</p>
        <a href={`/#${FAHUI_ROUTES[openOther.fahui_key]}`} style={{ fontSize: "14px" }}>
          没有跳转？点这里前往
        </a>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <p style={titleStyle}>{selfLabel}目前未开放</p>
      {selfStatus && selfStatus.windows.length ? (
        <p style={noteStyle}>
          开放时间：
          {selfStatus.windows
            .map((window) => `每年 ${formatMd(window.start_md)} 至 ${formatMd(window.end_md)}`)
            .join("、")}
        </p>
      ) : null}
      <p style={mutedStyle}>请在开放期间再回来登记，感恩。</p>
    </div>
  );
}

const pageStyle = {
  minHeight: "calc(100vh - 60px)",
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
  gap: "12px",
  padding: "24px",
  textAlign: "center" as const,
};
const titleStyle = { margin: 0, fontSize: "17px", fontWeight: 700 };
const noteStyle = { margin: 0, fontSize: "14px", color: "#667085" };
const mutedStyle = { margin: 0, fontSize: "13px", color: "#98a2b3" };
