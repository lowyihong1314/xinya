import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { fetchEventDetail } from "../../../event/shared/api";
import type { EventDetailRecord } from "../../../event/shared/types";
import { EventFlowInline } from "./EventFlowInline";

// 直接内联显示流程表（设计令牌主题）。按 event_id 拉活动详情供时间线推算。
export function EventFlowTab({ eventId, canEdit, isMobile }: { eventId: number; canEdit: boolean; isMobile: boolean }) {
  const [detail, setDetail] = useState<EventDetailRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetchEventDetail(eventId)
      .then((payload) => {
        if (active) setDetail(payload.data ?? null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "读取活动失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventId]);

  if (loading) return <div style={hintStyle}>加载流程…</div>;
  if (!detail) return <div style={hintStyle}>{error || "加载失败"}</div>;

  return <EventFlowInline detail={detail} canEdit={canEdit} isMobile={isMobile} />;
}

const hintStyle: CSSProperties = { padding: "24px", textAlign: "center", color: "var(--x-color-ink-muted)" };
