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
  const [open, setOpen] = useState(false);

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

  return (
    <div style={wrapStyle}>
      <div style={mutedStyle}>活动流程表：环节、时长与顺序（时间线）。</div>
      <button type="button" style={primaryBtnStyle} onClick={() => setOpen(true)}>
        <i className="fa-solid fa-list-ol" style={{ marginRight: 6 }} aria-hidden="true" />
        打开流程表
      </button>
      {open ? <EventFlowModal detail={detail} canEdit={canEdit} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

const hintStyle: CSSProperties = { padding: "24px", textAlign: "center", color: "var(--x-color-ink-muted)" };
const wrapStyle: CSSProperties = { display: "grid", gap: "12px", justifyItems: "start", padding: "8px 2px" };
const mutedStyle: CSSProperties = { fontSize: "13px", color: "var(--x-color-ink-muted)" };
const primaryBtnStyle: CSSProperties = { padding: "10px 18px", borderRadius: "8px", border: "1px solid var(--x-color-accent-strong)", background: "var(--x-color-accent)", color: "white", fontWeight: 700, fontSize: "14px", cursor: "pointer" };
