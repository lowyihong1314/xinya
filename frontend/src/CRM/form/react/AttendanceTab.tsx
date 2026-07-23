import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { calcAgeFromNric } from "../../../js/nric";
import { showConfirmDialog } from "../../../js/dialogs";
import { createAttendance, deleteAttendance, getAttendance, listAttendance } from "./api";
import type { AttendanceSnapshot, FormMember } from "./types";

type Toast = { type: "success" | "error"; text: string } | null;

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16).replace("T", " ");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const REMARK_EXAMPLES = ["早上报道", "下午吃饭", "巴士车上点名"];

export function AttendanceTab({
  formId,
  members,
  isMobile,
  canDelete,
}: {
  formId: number;
  members: FormMember[];
  isMobile: boolean;
  canDelete: boolean;
}) {
  const [snapshots, setSnapshots] = useState<AttendanceSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"list" | "new" | "view">("list");
  const [viewing, setViewing] = useState<AttendanceSnapshot | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  // 新建点名状态
  const [remark, setRemark] = useState("");
  const [query, setQuery] = useState("");
  const [present, setPresent] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);

  const roster = useMemo(
    () =>
      members.map((m) => ({
        id: m.id,
        name: m.name_cn || m.name || `成员#${m.id}`,
        age: calcAgeFromNric(m.nric),
        gender: String(m.gender || ""),
      })),
    [members],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    listAttendance(formId)
      .then((res) => {
        if (active) setSnapshots(res.attendances || []);
      })
      .catch((err) => {
        if (active) setToast({ type: "error", text: err instanceof Error ? err.message : "读取点名记录失败" });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [formId]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  async function refreshList() {
    setLoading(true);
    try {
      const res = await listAttendance(formId);
      setSnapshots(res.attendances || []);
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "读取点名记录失败" });
    } finally {
      setLoading(false);
    }
  }

  function startNew() {
    setRemark("");
    setQuery("");
    // 默认全部「到」，未到的取消勾选即可（大多数场合出席率高）。
    setPresent(Object.fromEntries(roster.map((r) => [r.id, true])));
    setMode("new");
  }

  const presentCount = roster.filter((r) => present[r.id]).length;
  const filteredRoster = useMemo(() => {
    const kw = query.trim().toLowerCase();
    if (!kw) return roster;
    return roster.filter((r) => `${r.name} ${r.gender} ${r.age ?? ""}`.toLowerCase().includes(kw));
  }, [roster, query]);

  async function save() {
    setSaving(true);
    try {
      const presentIds = roster.filter((r) => present[r.id]).map((r) => r.id);
      await createAttendance(formId, remark.trim(), presentIds);
      setToast({ type: "success", text: "点名快照已保存" });
      setMode("list");
      await refreshList();
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  async function openView(id: number) {
    try {
      const res = await getAttendance(id);
      if (res.attendance) {
        setViewing(res.attendance);
        setMode("view");
      }
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "读取快照失败" });
    }
  }

  async function remove(id: number) {
    if (!(await showConfirmDialog({ message: "删除这条点名记录？", tone: "danger" }))) return;
    try {
      await deleteAttendance(id);
      setSnapshots((cur) => cur.filter((s) => s.id !== id));
      setToast({ type: "success", text: "已删除" });
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "删除失败" });
    }
  }

  const toastNode = toast ? (
    <div style={toast.type === "success" ? successStyle : errorStyle}>{toast.text}</div>
  ) : null;

  // -------- 新建点名 --------
  if (mode === "new") {
    return (
      <div style={sectionStyle}>
        {toastNode}
        <div style={toolbarStyle(isMobile)}>
          <button type="button" style={btnStyle} onClick={() => setMode("list")}>← 返回</button>
          <div style={countPillStyle}>已到 {presentCount} / 共 {roster.length}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={btnStyle} onClick={() => setPresent(Object.fromEntries(roster.map((r) => [r.id, true])))}>全部到</button>
            <button type="button" style={btnStyle} onClick={() => setPresent({})}>全部未到</button>
          </div>
        </div>
        <input
          type="text"
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="备注，例如：早上报道 / 下午吃饭 / 巴士车上点名"
          style={inputStyle}
        />
        <div style={exampleRowStyle}>
          {REMARK_EXAMPLES.map((ex) => (
            <button key={ex} type="button" style={chipBtnStyle} onClick={() => setRemark(ex)}>{ex}</button>
          ))}
        </div>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索姓名快速定位" style={inputStyle} />
        {!roster.length ? <div style={emptyStyle}>暂无报名成员。</div> : null}
        <div style={rollListStyle}>
          {filteredRoster.map((r) => {
            const on = !!present[r.id];
            return (
              <button
                key={r.id}
                type="button"
                style={{ ...rollRowStyle, ...(on ? rollRowOnStyle : {}) }}
                onClick={() => setPresent((cur) => ({ ...cur, [r.id]: !on }))}
              >
                <span style={{ display: "grid", gap: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                  <span style={rollMetaStyle}>{r.age != null ? `${r.age}岁` : "—"} · {r.gender || "—"}</span>
                </span>
                <span style={on ? presentChipStyle : absentChipStyle}>{on ? "到" : "未到"}</span>
              </button>
            );
          })}
        </div>
        <div style={saveBarStyle}>
          <button type="button" style={btnStyle} onClick={() => setMode("list")}>取消</button>
          <button type="button" style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={() => void save()}>
            {saving ? "保存中…" : `保存快照（到 ${presentCount}）`}
          </button>
        </div>
      </div>
    );
  }

  // -------- 查看快照 --------
  if (mode === "view" && viewing) {
    const roll = viewing.roster || [];
    return (
      <div style={sectionStyle}>
        {toastNode}
        <div style={toolbarStyle(isMobile)}>
          <button type="button" style={btnStyle} onClick={() => setMode("list")}>← 返回</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{viewing.remark || "（无备注）"}</div>
            <div style={mutedStyle}>{formatDateTime(viewing.created_at)} · 到 {viewing.present_count} / 共 {viewing.total_count}</div>
          </div>
        </div>
        <div style={rollListStyle}>
          {roll.map((r) => (
            <div key={r.id} style={{ ...rollRowStyle, cursor: "default", ...(r.present ? rollRowOnStyle : {}) }}>
              <span style={{ display: "grid", gap: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name || `成员#${r.id}`}</span>
                <span style={rollMetaStyle}>{r.age != null ? `${r.age}岁` : "—"} · {r.gender || "—"}</span>
              </span>
              <span style={r.present ? presentChipStyle : absentChipStyle}>{r.present ? "到" : "未到"}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // -------- 记录列表 --------
  return (
    <div style={sectionStyle}>
      {toastNode}
      <div style={toolbarStyle(isMobile)}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>点名记录</div>
          <div style={mutedStyle}>共 {snapshots.length} 条快照</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={btnStyle} onClick={() => void refreshList()} disabled={loading}>{loading ? "刷新中…" : "刷新"}</button>
          <button type="button" style={primaryBtnStyle} onClick={startNew}>新建点名</button>
        </div>
      </div>
      {loading ? <div style={emptyStyle}>加载中…</div> : null}
      {!loading && !snapshots.length ? <div style={emptyStyle}>还没有点名记录，点「新建点名」开始。</div> : null}
      <div style={{ display: "grid", gap: 8 }}>
        {snapshots.map((s) => (
          <div key={s.id} style={recordRowStyle}>
            <button type="button" style={recordMainStyle} onClick={() => void openView(s.id)}>
              <span style={{ fontWeight: 700 }}>{s.remark || "（无备注）"}</span>
              <span style={mutedStyle}>{formatDateTime(s.created_at)}</span>
            </button>
            <span style={recordCountStyle}>到 {s.present_count}/{s.total_count}</span>
            {canDelete ? (
              <button type="button" style={dangerBtnStyle} onClick={() => void remove(s.id)}>删除</button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

const sectionStyle: CSSProperties = { display: "grid", gap: "10px" };
function toolbarStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", flexDirection: isMobile ? "column" : "row" };
}
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
const inputStyle: CSSProperties = { width: "100%", padding: "9px 11px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontSize: "13.5px", boxSizing: "border-box" };
const exampleRowStyle: CSSProperties = { display: "flex", gap: "6px", flexWrap: "wrap" };
const chipBtnStyle: CSSProperties = { padding: "5px 10px", borderRadius: "999px", border: "1px dashed var(--x-color-accent-border)", background: "var(--x-color-panel)", color: "var(--x-color-accent-strong)", fontSize: "12px", cursor: "pointer" };
const countPillStyle: CSSProperties = { padding: "5px 12px", borderRadius: "999px", background: "var(--x-color-accent-tint)", color: "var(--x-color-accent-strong)", fontWeight: 700, fontSize: "13px" };
const rollListStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "6px" };
const rollRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", textAlign: "left", padding: "8px 11px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", cursor: "pointer", fontSize: "13px" };
const rollRowOnStyle: CSSProperties = { border: "1px solid var(--x-color-accent-border)", background: "var(--x-color-accent-tint)" };
const rollMetaStyle: CSSProperties = { fontSize: "11.5px", color: "var(--x-color-ink-muted)" };
const presentChipStyle: CSSProperties = { flexShrink: 0, padding: "3px 10px", borderRadius: "6px", background: "var(--x-color-success-soft)", color: "var(--x-color-success)", fontWeight: 700, fontSize: "12px" };
const absentChipStyle: CSSProperties = { flexShrink: 0, padding: "3px 10px", borderRadius: "6px", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink-muted)", fontWeight: 700, fontSize: "12px" };
const saveBarStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "8px", position: "sticky", bottom: 0, paddingTop: "8px" };
const recordRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderRadius: "9px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-alt)" };
const recordMainStyle: CSSProperties = { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px", alignItems: "flex-start", background: "transparent", border: "none", color: "var(--x-color-ink)", cursor: "pointer", textAlign: "left" };
const recordCountStyle: CSSProperties = { flexShrink: 0, fontFamily: "var(--x-font-mono)", fontSize: "12.5px", color: "var(--x-color-ink)" };
const btnStyle: CSSProperties = { padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 600, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const primaryBtnStyle: CSSProperties = { padding: "9px 18px", borderRadius: "8px", border: "1px solid var(--x-color-accent-strong)", background: "var(--x-color-accent)", color: "white", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const dangerBtnStyle: CSSProperties = { flexShrink: 0, padding: "6px 12px", borderRadius: "7px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 700, fontSize: "12px", cursor: "pointer" };
const emptyStyle: CSSProperties = { padding: "24px", borderRadius: "10px", border: "1px dashed var(--x-color-line)", textAlign: "center", color: "var(--x-color-ink-muted)" };
const successStyle: CSSProperties = { padding: "9px 13px", borderRadius: "8px", background: "var(--x-color-success-soft)", border: "1px solid rgba(21,128,61,0.28)", color: "var(--x-color-success)", fontSize: "13px" };
const errorStyle: CSSProperties = { padding: "9px 13px", borderRadius: "8px", background: "var(--x-color-danger-soft)", border: "1px solid var(--x-color-danger-border)", color: "var(--x-color-danger)", fontSize: "13px" };
