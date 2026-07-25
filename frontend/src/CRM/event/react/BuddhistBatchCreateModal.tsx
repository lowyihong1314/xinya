import { useState } from "react";
import type { CSSProperties } from "react";

import type { EventCreatePayload } from "./types";

type Row = { name: string; date: string; time: string; note: string };
type TabKey = "youth" | "child";

const TAB_META: Record<TabKey, { type: string; label: string; time: string }> = {
  youth: { type: "青少年佛学班", label: "青少年佛学班", time: "18:00" },
  child: { type: "儿童佛学班", label: "儿童佛学班", time: "15:00" },
};

const pad = (n: number) => String(n).padStart(2, "0");
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// datetime-local "YYYY-MM-DDTHH:mm" + 3 小时。
function plus3h(dtLocal: string): string {
  const d = new Date(dtLocal);
  if (Number.isNaN(d.getTime())) return dtLocal;
  d.setHours(d.getHours() + 3);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function newRow(defTime: string, lastDate?: string): Row {
  return { name: "", date: lastDate || todayStr(), time: defTime, note: "" };
}
function validRows(rows: Row[]): Row[] {
  return rows.filter((r) => r.name.trim() && r.date && r.time);
}

export function BuddhistBatchCreateModal({
  creating,
  onClose,
  onSubmit,
}: {
  creating: boolean;
  onClose: () => void;
  onSubmit: (payloads: EventCreatePayload[]) => Promise<number>;
}) {
  const [tab, setTab] = useState<TabKey>("youth");
  const [youthRows, setYouthRows] = useState<Row[]>([newRow(TAB_META.youth.time)]);
  const [childRows, setChildRows] = useState<Row[]>([newRow(TAB_META.child.time)]);
  const [error, setError] = useState("");

  const rows = tab === "youth" ? youthRows : childRows;
  const setRows = tab === "youth" ? setYouthRows : setChildRows;
  const defTime = TAB_META[tab].time;

  function addRow() {
    setRows([...rows, newRow(defTime, rows[rows.length - 1]?.date)]);
  }
  function updateRow(i: number, patch: Partial<Row>) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    setRows(rows.filter((_, idx) => idx !== i));
  }

  function buildPayloads(): EventCreatePayload[] {
    const mk = (rs: Row[], type: string): EventCreatePayload[] =>
      validRows(rs).map((r) => {
        const datetime = `${r.date}T${r.time}`;
        return {
          event_name: r.name.trim(),
          datetime,
          end_datetime: plus3h(datetime),
          type,
          purpose: r.note.trim() || undefined,
        };
      });
    return [...mk(youthRows, TAB_META.youth.type), ...mk(childRows, TAB_META.child.type)];
  }

  async function submit() {
    const payloads = buildPayloads();
    if (!payloads.length) {
      setError("请至少填写一行（活动名称 + 日期 + 时间）");
      return;
    }
    setError("");
    const n = await onSubmit(payloads);
    if (n > 0) onClose();
  }

  const youthCount = validRows(youthRows).length;
  const childCount = validRows(childRows).length;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={sheetStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headStyle}>
          <h4 style={titleStyle}>批量新建佛学班</h4>
          <button type="button" style={btnStyle} onClick={onClose}>关闭</button>
        </div>

        <div style={tabsStyle}>
          {(Object.keys(TAB_META) as TabKey[]).map((k) => (
            <button key={k} type="button" style={tab === k ? tabActiveStyle : tabStyle} onClick={() => setTab(k)}>
              {TAB_META[k].label}
              <span style={tabCountStyle}>{(k === "youth" ? youthCount : childCount) || ""}</span>
            </button>
          ))}
        </div>
        <div style={hintStyle}>
          默认时间：青少年 6:00 PM · 儿童 3:00 PM ｜ 结束时间自动 +3 小时 ｜ 两个 tab 的行会一起创建
        </div>

        {error ? <div style={errStyle}>{error}</div> : null}

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ ...rowStyle, fontWeight: 700, color: "var(--x-color-ink-muted)", fontSize: 11.5 }}>
            <span style={{ flex: "2 1 160px" }}>活动名称 *</span>
            <span style={{ flex: "0 1 130px" }}>日期</span>
            <span style={{ flex: "0 1 92px" }}>时间</span>
            <span style={{ flex: "2 1 160px" }}>说明（选填）</span>
            <span style={{ width: 30 }} />
          </div>
          {rows.map((r, i) => (
            <div key={i} style={rowStyle}>
              <input style={{ ...cellStyle, flex: "2 1 160px" }} placeholder="例如：青少年佛学班 7" value={r.name}
                onChange={(e) => updateRow(i, { name: e.target.value })} />
              <input type="date" style={{ ...cellStyle, flex: "0 1 130px" }} value={r.date}
                onChange={(e) => updateRow(i, { date: e.target.value })} />
              <input type="time" style={{ ...cellStyle, flex: "0 1 92px" }} value={r.time}
                onChange={(e) => updateRow(i, { time: e.target.value })} />
              <input style={{ ...cellStyle, flex: "2 1 160px" }} placeholder="活动说明" value={r.note}
                onChange={(e) => updateRow(i, { note: e.target.value })} />
              <button type="button" style={delStyle} disabled={rows.length <= 1} onClick={() => removeRow(i)} title="删除这一行">×</button>
            </div>
          ))}
        </div>

        <div>
          <button type="button" style={addBtnStyle} onClick={addRow}>+ 添加一行</button>
        </div>

        <div style={footStyle}>
          <button type="button" style={btnStyle} disabled={creating} onClick={onClose}>取消</button>
          <button type="button" style={{ ...primaryStyle, opacity: creating ? 0.6 : 1 }} disabled={creating} onClick={() => void submit()}>
            {creating ? "创建中…" : `全部创建（青少年 ${youthCount} · 儿童 ${childCount}）`}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 200, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 12px", overflowY: "auto" };
const sheetStyle: CSSProperties = { width: "min(820px, 100%)", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line)", borderRadius: "14px", boxShadow: "0 24px 60px var(--x-color-shadow)", padding: "16px", display: "grid", gap: "12px" };
const headStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const titleStyle: CSSProperties = { margin: 0, fontSize: 16, fontWeight: 800 };
const tabsStyle: CSSProperties = { display: "flex", gap: 6, padding: 4, borderRadius: 10, background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)" };
const tabStyle: CSSProperties = { flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 12px", borderRadius: 8, border: "none", background: "transparent", color: "var(--x-color-ink-muted)", fontWeight: 700, fontSize: 13.5, cursor: "pointer" };
const tabActiveStyle: CSSProperties = { ...tabStyle, background: "var(--x-color-panel)", color: "var(--x-color-accent-strong)", border: "1px solid var(--x-color-accent-border)" };
const tabCountStyle: CSSProperties = { fontSize: 11, fontWeight: 800, color: "var(--x-color-accent-strong)" };
const hintStyle: CSSProperties = { fontSize: 12, color: "var(--x-color-ink-muted)" };
const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" };
const cellStyle: CSSProperties = { minWidth: 0, padding: "7px 9px", borderRadius: 7, border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontSize: 13, boxSizing: "border-box" };
const delStyle: CSSProperties = { width: 30, flexShrink: 0, height: 30, borderRadius: 7, border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink-muted)", fontSize: 16, lineHeight: 1, cursor: "pointer" };
const addBtnStyle: CSSProperties = { padding: "7px 14px", borderRadius: 8, border: "1px dashed var(--x-color-accent-border)", background: "var(--x-color-panel)", color: "var(--x-color-accent-strong)", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const footStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 6, borderTop: "1px solid var(--x-color-line-soft)" };
const btnStyle: CSSProperties = { padding: "8px 14px", borderRadius: 8, border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 600, fontSize: 13, cursor: "pointer" };
const primaryStyle: CSSProperties = { padding: "8px 16px", borderRadius: 8, border: "1px solid var(--x-color-accent-strong)", background: "var(--x-color-accent)", color: "white", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" };
const errStyle: CSSProperties = { padding: "8px 12px", borderRadius: 8, background: "var(--x-color-danger-soft)", border: "1px solid var(--x-color-danger-border)", color: "var(--x-color-danger)", fontSize: 13 };
