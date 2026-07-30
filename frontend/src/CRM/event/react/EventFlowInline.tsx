import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

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

  async function persistOrder(list: EventFlowRecord[]) {
    try {
      await reorderEventFlows(detail.id, list.map((f) => f.id));
    } catch {
      void load();
    }
  }

  // ------- 手机版拖动排序 -------
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const dragIdxRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (dragIdx == null) return;
    function onMove(ev: PointerEvent) {
      const from = dragIdxRef.current;
      const container = listRef.current;
      if (from == null || !container) return;
      const items = Array.from(container.querySelectorAll("[data-flow-row]")) as HTMLElement[];
      let target = items.length - 1;
      for (let i = 0; i < items.length; i += 1) {
        const r = items[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) { target = i; break; }
      }
      if (target !== from) {
        setFlows((cur) => {
          const n = [...cur];
          const [m] = n.splice(from, 1);
          n.splice(target, 0, m);
          return n;
        });
        dragIdxRef.current = target;
        setDragIdx(target);
      }
    }
    function onUp() {
      dragIdxRef.current = null;
      setDragIdx(null);
      setFlows((cur) => { void persistOrder(cur); return cur; });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragIdx]);

  function startDrag(e: ReactPointerEvent, idx: number) {
    e.preventDefault();
    dragIdxRef.current = idx;
    setDragIdx(idx);
  }

  // ------- 手机版编辑弹窗 -------
  const [editing, setEditing] = useState<EventFlowRecord | null>(null);
  const [ef, setEf] = useState({ title: "", minutes: "", detail: "", login_only: false });

  function openEdit(f: EventFlowRecord) {
    setEditing(f);
    setEf({
      title: f.title || "",
      minutes: f.minutes == null ? "" : String(f.minutes),
      detail: f.detail || "",
      login_only: !!f.login_only,
    });
  }
  async function saveEdit() {
    if (!editing) return;
    await patch(editing.id, {
      title: ef.title.trim(),
      minutes: ef.minutes === "" ? 0 : Number(ef.minutes),
      detail: ef.detail.trim(),
      login_only: ef.login_only,
    });
    setEditing(null);
  }
  async function removeEditing() {
    if (!editing) return;
    const id = editing.id;
    setEditing(null);
    await remove(id);
  }

  // ------- 手机版：可拖动排序 + 编辑弹窗 -------
  if (isMobile) {
    return (
      <div style={mWrapStyle}>
        <div style={mHeadStyle}>
          <span style={mHeadTitleStyle}>活动流程</span>
          <span style={mutedStyle}>{flows.length} 段</span>
        </div>
        {error ? <div style={errorStyle}>{error}</div> : null}

        {canEdit ? (
          <div style={mAddStyle}>
            <input
              style={inputStyle}
              placeholder="环节，例如：破冰分组"
              value={nf.title}
              onChange={(e) => setNf((v) => ({ ...v, title: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="number"
                min={0}
                style={{ ...inputStyle, flex: 1 }}
                placeholder="时长(分)"
                value={nf.minutes}
                onChange={(e) => setNf((v) => ({ ...v, minutes: e.target.value }))}
              />
              <button type="button" style={primaryBtnStyle} disabled={!nf.title.trim()} onClick={() => void add()}>添加</button>
            </div>
          </div>
        ) : null}

        {loading ? <div style={emptyStyle}>加载中…</div> : null}
        {!loading && !flows.length ? <div style={emptyStyle}>还没有流程环节。</div> : null}

        <div ref={listRef} style={mListStyle}>
          {rows.map(({ f, s, e }, idx) => (
            <div key={f.id} data-flow-row style={mCardStyle(dragIdx === idx)}>
              {canEdit ? (
                <button
                  type="button"
                  style={mHandleStyle}
                  title="拖动排序"
                  aria-label="拖动排序"
                  onPointerDown={(ev) => startDrag(ev, idx)}
                >
                  <i className="fa-solid fa-grip-vertical" aria-hidden="true" />
                </button>
              ) : null}
              <div style={mBodyStyle}>
                <div style={mTimeStyle}>
                  {clock(s)}{s && e ? ` – ${clock(e)}` : ""}{f.minutes != null ? ` · ${f.minutes} 分` : ""}
                </div>
                <div style={mTitleStyle}>
                  {f.title || "（未命名）"}
                  {f.login_only ? <span style={lockBadgeStyle} title="仅登陆可见"> 🔒</span> : null}
                </div>
                {f.detail ? <div style={mDetailStyle}>{f.detail}</div> : null}
              </div>
              {canEdit ? (
                <button type="button" style={mEditBtnStyle} title="编辑" aria-label="编辑" onClick={() => openEdit(f)}>
                  <i className="fa-solid fa-pen" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {editing ? (
          <div style={editOverlayStyle} onClick={() => setEditing(null)}>
            <div style={editSheetStyle} onClick={(ev) => ev.stopPropagation()}>
              <div style={editHeadStyle}>
                <span style={mHeadTitleStyle}>编辑环节</span>
                <button type="button" style={editCloseStyle} onClick={() => setEditing(null)}>关闭</button>
              </div>
              <label style={editLabelStyle}>环节标题</label>
              <input style={inputStyle} value={ef.title} placeholder="环节标题" onChange={(e) => setEf((v) => ({ ...v, title: e.target.value }))} />
              <label style={editLabelStyle}>时长（分钟）</label>
              <input type="number" min={0} style={inputStyle} value={ef.minutes} placeholder="时长(分)" onChange={(e) => setEf((v) => ({ ...v, minutes: e.target.value }))} />
              <label style={editLabelStyle}>详情 / 负责人</label>
              <textarea style={{ ...inputStyle, minHeight: 72, resize: "vertical" }} value={ef.detail} placeholder="详情 / 负责人（可空）" onChange={(e) => setEf((v) => ({ ...v, detail: e.target.value }))} />
              <label style={editToggleRowStyle}>
                <input type="checkbox" checked={ef.login_only} onChange={(e) => setEf((v) => ({ ...v, login_only: e.target.checked }))} />
                <span>仅登陆可见（公开/终端隐藏）</span>
              </label>
              <div style={editActionsStyle}>
                <button type="button" style={delBtnStyle} onClick={() => void removeEditing()}>移除</button>
                <button type="button" style={primaryBtnStyle} onClick={() => void saveEdit()}>保存</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // ------- 电脑版：完整可编辑流程表 -------
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
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input style={titleInputStyle} defaultValue={f.title || ""} placeholder="环节标题"
                    onBlur={(ev) => { const v = ev.target.value.trim(); if (v !== (f.title || "")) void patch(f.id, { title: v }); }} />
                  {f.login_only ? <span style={lockBadgeStyle} title="仅登陆可见">🔒</span> : null}
                </div>
              ) : (
                <span style={{ fontWeight: 700, fontSize: 14 }}>
                  {f.title || "（未命名）"}
                  {f.login_only ? <span style={lockBadgeStyle} title="仅登陆可见">🔒</span> : null}
                </span>
              )}
              {canEdit ? (
                <textarea style={{ ...detailInputStyle, resize: "none", fontFamily: "inherit", lineHeight: 1.5, whiteSpace: "pre-wrap" }}
                  rows={Math.max(1, (f.detail || "").split("\n").length)} defaultValue={f.detail || ""} placeholder="详情 / 负责人"
                  onBlur={(ev) => { const v = ev.target.value.trim(); if (v !== (f.detail || "")) void patch(f.id, { detail: v }); }} />
              ) : f.detail ? <span style={{ ...mutedStyle, whiteSpace: "pre-wrap" }}>{f.detail}</span> : null}
            </div>
            {canEdit ? (
              <div style={actionsStyle}>
                <label style={durWrapStyle}>
                  <input type="number" min={0} style={durInputStyle} defaultValue={f.minutes == null ? "" : String(f.minutes)}
                    onBlur={(ev) => { const v = ev.target.value.trim(); const n = v === "" ? 0 : Number(v); if (n !== (Number(f.minutes) || 0)) void patch(f.id, { minutes: n }); }} />
                  <span style={{ fontSize: 11, color: "var(--x-color-ink-muted)" }}>分</span>
                </label>
                <button type="button" style={f.login_only ? lockOnBtnStyle : iconBtnStyle}
                  onClick={() => void patch(f.id, { login_only: !f.login_only })}
                  title={f.login_only ? "仅登陆可见（点一下改回公开）" : "设为仅登陆可见（公开/终端将隐藏）"}>
                  {f.login_only ? "🔒" : "🔓"}
                </button>
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

const wrapStyle: CSSProperties = { display: "grid", gap: "8px", width: "100%", maxWidth: "960px", margin: "0 auto", padding: "20px 24px", boxSizing: "border-box" };
const headRowStyle: CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 };
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
function addRowStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", gap: "6px", flexWrap: "wrap", padding: "10px", borderRadius: "9px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)", flexDirection: isMobile ? "column" : "row" };
}
const inputStyle: CSSProperties = { padding: "8px 10px", borderRadius: "7px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontSize: "13px", boxSizing: "border-box" };
const primaryBtnStyle: CSSProperties = { padding: "8px 16px", borderRadius: "7px", border: "1px solid var(--x-color-accent-strong)", background: "var(--x-color-accent)", color: "white", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const rowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "80px minmax(0, 1fr) auto", alignItems: "center", gap: "14px", padding: "8px 14px", borderRadius: "10px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)" };
const timeBadgeStyle: CSSProperties = { display: "grid", justifyItems: "center", alignContent: "center", padding: "6px 6px", borderRadius: "8px", background: "var(--x-color-accent-tint)", color: "var(--x-color-accent-strong)", lineHeight: 1.2 };
const titleInputStyle: CSSProperties = { border: "none", background: "transparent", color: "var(--x-color-ink)", fontSize: "14px", fontWeight: 700, padding: "2px 0", width: "100%" };
const detailInputStyle: CSSProperties = { border: "none", background: "transparent", color: "var(--x-color-ink-muted)", fontSize: "12.5px", padding: "1px 0", width: "100%" };
const actionsStyle: CSSProperties = { flexShrink: 0, display: "flex", alignItems: "center", gap: "6px", justifyContent: "flex-end" };
const durWrapStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: "3px" };
const durInputStyle: CSSProperties = { width: "52px", padding: "5px 6px", borderRadius: "6px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink)", fontSize: "12.5px", textAlign: "right" };
const durTextStyle: CSSProperties = { flexShrink: 0, fontSize: "12px", color: "var(--x-color-ink-muted)" };
const iconBtnStyle: CSSProperties = { width: 28, height: 28, borderRadius: "6px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", cursor: "pointer", fontSize: "13px", lineHeight: 1 };
const lockOnBtnStyle: CSSProperties = { width: 28, height: 28, borderRadius: "6px", border: "1px solid var(--x-color-accent-strong)", background: "var(--x-color-accent-tint)", color: "var(--x-color-accent-strong)", cursor: "pointer", fontSize: "13px", lineHeight: 1 };
const lockBadgeStyle: CSSProperties = { fontSize: "11px", flexShrink: 0 };
const delBtnStyle: CSSProperties = { padding: "5px 10px", borderRadius: "6px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 700, fontSize: "12px", cursor: "pointer" };
const emptyStyle: CSSProperties = { padding: "22px", borderRadius: "10px", border: "1px dashed var(--x-color-line)", textAlign: "center", color: "var(--x-color-ink-muted)" };
const errorStyle: CSSProperties = { padding: "9px 12px", borderRadius: "8px", background: "var(--x-color-danger-soft)", border: "1px solid var(--x-color-danger-border)", color: "var(--x-color-danger)", fontSize: "13px" };

// —— 手机极简时间线 ——
const mWrapStyle: CSSProperties = { display: "grid", gap: "12px", padding: "16px 14px" };
const mHeadStyle: CSSProperties = { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 };
const mHeadTitleStyle: CSSProperties = { fontFamily: "var(--x-font-serif)", fontWeight: 500, fontSize: "18px", color: "var(--x-color-ink)" };
const mAddStyle: CSSProperties = { display: "grid", gap: "6px", padding: "10px", borderRadius: "10px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)" };
const mListStyle: CSSProperties = { display: "grid", gap: "8px" };
function mCardStyle(dragging: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 10px",
    borderRadius: "10px",
    border: dragging ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
    boxShadow: dragging ? "0 12px 28px var(--x-color-shadow)" : "0 1px 2px var(--x-color-shadow-soft)",
    opacity: dragging ? 0.95 : 1,
    touchAction: "pan-y",
  };
}
const mHandleStyle: CSSProperties = { flexShrink: 0, width: "34px", height: "40px", display: "grid", placeItems: "center", border: "none", background: "transparent", color: "var(--x-color-ink-muted)", cursor: "grab", touchAction: "none", fontSize: "16px" };
const mBodyStyle: CSSProperties = { flex: 1, minWidth: 0, display: "grid", gap: "2px" };
const mTimeStyle: CSSProperties = { fontSize: "12px", fontWeight: 600, letterSpacing: "0.02em", color: "var(--x-color-accent-strong)" };
const mTitleStyle: CSSProperties = { fontSize: "15px", fontWeight: 600, color: "var(--x-color-ink)" };
const mDetailStyle: CSSProperties = { fontSize: "13px", lineHeight: 1.6, color: "var(--x-color-ink-muted)", whiteSpace: "pre-wrap" };
const mEditBtnStyle: CSSProperties = { flexShrink: 0, width: "36px", height: "36px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-accent-strong)", cursor: "pointer", fontSize: "13px" };
const editOverlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 3000, background: "rgba(15,23,42,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center" };
const editSheetStyle: CSSProperties = { width: "min(560px, 100%)", maxHeight: "88vh", overflowY: "auto", background: "var(--x-color-panel)", borderRadius: "18px 18px 0 0", padding: "18px 16px max(18px, env(safe-area-inset-bottom))", display: "grid", gap: "8px", boxShadow: "0 -20px 50px rgba(15,23,42,0.25)" };
const editHeadStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 4 };
const editCloseStyle: CSSProperties = { padding: "6px 12px", borderRadius: "999px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 600, fontSize: "12.5px", cursor: "pointer" };
const editLabelStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", marginTop: "6px" };
const editToggleRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--x-color-ink)", marginTop: "8px" };
const editActionsStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: "14px" };
