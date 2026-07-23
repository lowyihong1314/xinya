import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import {
  createEventFlow,
  deleteEventFlow,
  fetchEventFlows,
  reorderEventFlows,
  updateEventFlow,
} from "../../../event/shared/api";
import type { EventDetailRecord, EventFlowRecord } from "../../../event/shared/types";
import { showConfirmDialog } from "../../../js/dialogs";

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date | null) => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "--:--");

// CRM 活动详情里的内联流程表（设计令牌主题，替代相册那个浅蓝弹窗）。
export function EventFlowInline({ detail, canEdit, isMobile }: { detail: EventDetailRecord; canEdit: boolean; isMobile: boolean }) {
  const [flows, setFlows] = useState<EventFlowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nf, setNf] = useState({ title: "", minutes: "", detail: "" });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetchEventFlows(detail.id);
      setFlows(Array.isArray(res.data) ? (res.data as EventFlowRecord[]) : []);
    } catch {
      setError("读取流程失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);

  const startDate = detail.datetime ? new Date(detail.datetime) : null;
  const rows = useMemo(() => {
    let cum = 0;
    return flows.map((f) => {
      const s = startDate ? new Date(startDate.getTime() + cum * 60000) : null;
      cum += Number(f.minutes) || 0;
      const e = startDate ? new Date(startDate.getTime() + cum * 60000) : null;
      return { f, s, e };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flows, detail.datetime]);

  async function add() {
    const title = nf.title.trim();
    if (!title) return;
    try {
      const res = await createEventFlow({ event_id: detail.id, title, minutes: nf.minutes, detail: nf.detail.trim() });
      if (res.data) {
        setNf({ title: "", minutes: "", detail: "" });
        await load();
      }
    } catch {
      setError("添加失败");
    }
  }
  async function patch(id: number, body: Record<string, unknown>) {
    setFlows((cur) => cur.map((f) => (f.id === id ? { ...f, ...body } : f)));
    try {
      await updateEventFlow(id, body);
    } catch {
      void load();
    }
  }
  async function remove(id: number) {
    if (!(await showConfirmDialog({ message: "删除这个环节？", tone: "danger" }))) return;
    setFlows((cur) => cur.filter((f) => f.id !== id));
    try {
      await deleteEventFlow(id);
    } catch {
      void load();
    }
  }
  async function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= flows.length) return;
    const next = [...flows];
    [next[idx], next[j]] = [next[j], next[idx]];
    setFlows(next);
    try {
      await reorderEventFlows(detail.id, next.map((f) => f.id));
    } catch {
      void load();
    }
  }

  return (
    <div style={wrapStyle}>
      <div style={headRowStyle}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>活动流程</div>
          <div style={mutedStyle}>
            {startDate ? "每段开始时间按活动开始时间 + 前面时长自动推算。" : "活动没有开始时间，时刻无法推算。"}
          </div>
        </div>
        <div style={mutedStyle}>{flows.length} 段</div>
      </div>
      {error ? <div style={errorStyle}>{error}</div> : null}

      {canEdit ? (
        <div style={addRowStyle(isMobile)}>
          <input style={{ ...inputStyle, flex: "2 1 160px" }} placeholder="环节，例如：破冰分组" value={nf.title}
            onChange={(e) => setNf((v) => ({ ...v, title: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
          <input type="number" min={0} style={{ ...inputStyle, flex: "0 1 110px" }} placeholder="时长(分)" value={nf.minutes}
            onChange={(e) => setNf((v) => ({ ...v, minutes: e.target.value }))} />
          <input style={{ ...inputStyle, flex: "2 1 160px" }} placeholder="详情 / 负责人（可空）" value={nf.detail}
            onChange={(e) => setNf((v) => ({ ...v, detail: e.target.value }))} />
          <button type="button" style={primaryBtnStyle} disabled={!nf.title.trim()} onClick={() => void add()}>添加</button>
        </div>
      ) : null}

      {loading ? <div style={emptyStyle}>加载中…</div> : null}
      {!loading && !flows.length ? <div style={emptyStyle}>还没有流程环节。</div> : null}

      <div style={{ display: "grid", gap: 6 }}>
        {rows.map(({ f, s, e }, idx) => (
          <div key={f.id} style={rowStyle}>
            <div style={timeBadgeStyle}>
              <span style={{ fontWeight: 800, fontSize: 15 }}>{clock(s)}</span>
              <span style={{ fontSize: 11, opacity: 0.75 }}>{clock(e)}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 3 }}>
              {canEdit ? (
                <input style={titleInputStyle} defaultValue={f.title || ""} placeholder="环节标题"
                  onBlur={(ev) => { const v = ev.target.value.trim(); if (v !== (f.title || "")) void patch(f.id, { title: v }); }} />
              ) : (
                <span style={{ fontWeight: 700, fontSize: 14 }}>{f.title || "（未命名）"}</span>
              )}
              {canEdit ? (
                <input style={detailInputStyle} defaultValue={f.detail || ""} placeholder="详情 / 负责人"
                  onBlur={(ev) => { const v = ev.target.value.trim(); if (v !== (f.detail || "")) void patch(f.id, { detail: v }); }} />
              ) : f.detail ? <span style={mutedStyle}>{f.detail}</span> : null}
            </div>
            {canEdit ? (
              <div style={actionsStyle}>
                <label style={durWrapStyle}>
                  <input type="number" min={0} style={durInputStyle} defaultValue={f.minutes == null ? "" : String(f.minutes)}
                    onBlur={(ev) => { const v = ev.target.value.trim(); const n = v === "" ? 0 : Number(v); if (n !== (Number(f.minutes) || 0)) void patch(f.id, { minutes: n }); }} />
                  <span style={{ fontSize: 11, color: "var(--x-color-ink-muted)" }}>分</span>
                </label>
                <button type="button" style={iconBtnStyle} disabled={idx === 0} onClick={() => void move(idx, -1)} title="上移">↑</button>
                <button type="button" style={iconBtnStyle} disabled={idx === rows.length - 1} onClick={() => void move(idx, 1)} title="下移">↓</button>
                <button type="button" style={delBtnStyle} onClick={() => void remove(f.id)}>删</button>
              </div>
            ) : (
              <span style={durTextStyle}>{f.minutes != null ? `${f.minutes} 分` : ""}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const wrapStyle: CSSProperties = { display: "grid", gap: "10px" };
const headRowStyle: CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 };
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
function addRowStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", gap: "6px", flexWrap: "wrap", padding: "10px", borderRadius: "9px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)", flexDirection: isMobile ? "column" : "row" };
}
const inputStyle: CSSProperties = { padding: "8px 10px", borderRadius: "7px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontSize: "13px", boxSizing: "border-box" };
const primaryBtnStyle: CSSProperties = { padding: "8px 16px", borderRadius: "7px", border: "1px solid var(--x-color-accent-strong)", background: "var(--x-color-accent)", color: "white", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "10px", padding: "9px 11px", borderRadius: "9px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", flexWrap: "wrap" };
const timeBadgeStyle: CSSProperties = { flexShrink: 0, display: "grid", justifyItems: "center", alignContent: "center", minWidth: 58, padding: "6px 8px", borderRadius: "8px", background: "var(--x-color-accent-tint)", color: "var(--x-color-accent-strong)", lineHeight: 1.2 };
const titleInputStyle: CSSProperties = { border: "none", background: "transparent", color: "var(--x-color-ink)", fontSize: "14px", fontWeight: 700, padding: "2px 0", width: "100%" };
const detailInputStyle: CSSProperties = { border: "none", background: "transparent", color: "var(--x-color-ink-muted)", fontSize: "12.5px", padding: "1px 0", width: "100%" };
const actionsStyle: CSSProperties = { flexShrink: 0, display: "flex", alignItems: "center", gap: "6px" };
const durWrapStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: "3px" };
const durInputStyle: CSSProperties = { width: "52px", padding: "5px 6px", borderRadius: "6px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink)", fontSize: "12.5px", textAlign: "right" };
const durTextStyle: CSSProperties = { flexShrink: 0, fontSize: "12px", color: "var(--x-color-ink-muted)" };
const iconBtnStyle: CSSProperties = { width: 28, height: 28, borderRadius: "6px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", cursor: "pointer", fontSize: "13px", lineHeight: 1 };
const delBtnStyle: CSSProperties = { padding: "5px 10px", borderRadius: "6px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 700, fontSize: "12px", cursor: "pointer" };
const emptyStyle: CSSProperties = { padding: "22px", borderRadius: "10px", border: "1px dashed var(--x-color-line)", textAlign: "center", color: "var(--x-color-ink-muted)" };
const errorStyle: CSSProperties = { padding: "9px 12px", borderRadius: "8px", background: "var(--x-color-danger-soft)", border: "1px solid var(--x-color-danger-border)", color: "var(--x-color-danger)", fontSize: "13px" };
