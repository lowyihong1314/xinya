import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { EventFlowModal } from "../../../album/react/EventFlowModal";
import { fetchEventDetail } from "../../../event/shared/api";
import type { EventDetailRecord } from "../../../event/shared/types";

// 复用相册里的活动流程表（弹窗）：按 event_id 拉详情，tab 内点按钮打开。
export function EventFlowTab({ eventId, canEdit }: { eventId: number; canEdit: boolean }) {
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

  // 直接内联显示流程表（不再弹窗）。
  return <EventFlowModal detail={detail} canEdit={canEdit} inline onClose={() => {}} />;
}

const hintStyle: CSSProperties = { padding: "24px", textAlign: "center", color: "var(--x-color-ink-muted)" };
