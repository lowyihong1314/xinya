import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { EventCheckInPanel } from "../../../album/react/EventCheckInPanel";
import { fetchEventDetail } from "../../../event/shared/api";
import type { EventDetailRecord } from "../../../event/shared/types";

// 复用相册里的签到面板：按 event_id 拉活动详情后原样渲染。
export function EventCheckinTab({ eventId, isMobile }: { eventId: number; isMobile: boolean }) {
  const [detail, setDetail] = useState<EventDetailRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(silent = false) {
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const payload = await fetchEventDetail(eventId);
      setDetail(payload.data ?? null);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "读取活动失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  if (loading) return <div style={hintStyle}>加载签到面板…</div>;
  if (!detail) return <div style={hintStyle}>{error || "加载失败"}</div>;

  return <EventCheckInPanel detail={detail} isMobile={isMobile} onChanged={() => load(true)} />;
}

const hintStyle: CSSProperties = { padding: "24px", textAlign: "center", color: "var(--x-color-ink-muted)" };
