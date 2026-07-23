import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { io, type Socket } from "socket.io-client";

import { API_BASE } from "../../../js/apiBase";
import { showConfirmDialog } from "../../../js/dialogs";
import {
  createAttendance,
  deleteAttendance,
  getAttendance,
  listAttendance,
  markAttendance,
  updateAttendance,
} from "./api";
import type { AttendanceSnapshot, FormMember } from "./types";

type Toast = { type: "success" | "error"; text: string } | null;

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16).replace("T", " ");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const REMARK_EXAMPLES = ["早上报道", "下午吃饭", "巴士车上点名"];

// 本地乐观更新：先翻转 UI，等服务器回来再以其为准。
function applyPresentLocal(snap: AttendanceSnapshot, memberId: number, present: boolean): AttendanceSnapshot {
  const roster = (snap.roster || []).map((e) => (e.id === memberId ? { ...e, present } : e));
  return { ...snap, roster, present_count: roster.filter((e) => e.present).length };
}

// 单行补丁：只改动这一个成员（present + 报到时间），其余行原样保留。
function patchEntry(
  snap: AttendanceSnapshot,
  memberId: number,
  present: boolean,
  checkedAt: string | null | undefined,
  presentCount?: number,
  totalCount?: number,
): AttendanceSnapshot {
  const roster = (snap.roster || []).map((e) =>
    e.id === memberId ? { ...e, present, checked_at: checkedAt ?? null } : e,
  );
  return {
    ...snap,
    roster,
    present_count: presentCount ?? roster.filter((e) => e.present).length,
    total_count: totalCount ?? snap.total_count,
  };
}

export function AttendanceTab({
  formId,
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
  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editing, setEditing] = useState<AttendanceSnapshot | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [creating, setCreating] = useState(false);

  // 编辑态
  const [query, setQuery] = useState("");
  const [remarkDraft, setRemarkDraft] = useState("");
  const [marking, setMarking] = useState<Record<number, boolean>>({});

  // 供 socket 回调读取当前打开的记录 id（避免闭包拿到旧值）。
  const editingIdRef = useRef<number | null>(null);
  useEffect(() => {
    editingIdRef.current = editing?.id ?? null;
  }, [editing]);

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

  // 实时同步：多人同时点名时，任何人改动都会广播到 wait_register_{form_id}。
  useEffect(() => {
    const origin = API_BASE || (typeof window !== "undefined" ? window.location.origin : "");
    const room = `wait_register_${formId}`;
    const socket: Socket = io(origin, { withCredentials: true, transports: ["websocket", "polling"] });
    const join = () => socket.emit("join_room", { room });
    socket.on("connect", join);
    if (socket.connected) join();

    const handler = (payload: {
      form_id?: number;
      event?: string;
      attendance_id?: number;
      member_id?: number;
      present?: boolean;
      checked_at?: string | null;
      present_count?: number;
      total_count?: number;
      remark?: string;
    }) => {
      if (payload?.form_id != null && Number(payload.form_id) !== Number(formId)) return;
      const ev = payload?.event;
      const attId = payload?.attendance_id;
      const openId = editingIdRef.current;

      if (ev === "attendance_mark") {
        // 只补丁这一个成员，绝不回读整表。广播里带的就是刚写入的权威值。
        if (attId && payload.member_id != null) {
          if (openId === attId) {
            setEditing((cur) =>
              cur && cur.id === attId
                ? patchEntry(cur, payload.member_id!, !!payload.present, payload.checked_at, payload.present_count, payload.total_count)
                : cur,
            );
          }
          setSnapshots((cur) =>
            cur.map((s) =>
              s.id === attId
                ? { ...s, present_count: payload.present_count ?? s.present_count, total_count: payload.total_count ?? s.total_count }
                : s,
            ),
          );
        }
        return;
      }

      if (ev === "attendance_rename") {
        if (attId) {
          if (openId === attId) setEditing((cur) => (cur && cur.id === attId ? { ...cur, remark: payload.remark ?? cur.remark } : cur));
          setSnapshots((cur) => cur.map((s) => (s.id === attId ? { ...s, remark: payload.remark ?? s.remark } : s)));
        }
        return;
      }

      if (ev === "attendance_delete") {
        if (attId) {
          setSnapshots((cur) => cur.filter((s) => s.id !== attId));
          if (openId === attId) {
            setEditing(null);
            setMode("list");
            setToast({ type: "error", text: "这条点名已被删除" });
          }
        }
        return;
      }

      if (ev === "attendance_create") {
        // 别人新建了一条：静默补进列表，不动当前编辑态。
        listAttendance(formId)
          .then((res) => setSnapshots(res.attendances || []))
          .catch(() => {});
      }
    };
    socket.on("new_register", handler);

    return () => {
      socket.off("connect", join);
      socket.off("new_register", handler);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

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

  function openEditing(att: AttendanceSnapshot) {
    setEditing(att);
    setRemarkDraft(att.remark || "");
    setQuery("");
    setMarking({});
    setMode("edit");
  }

  // 新建点名：立即建一条「新建点名」（全员未到），直接进入逐个报到。
  async function startNew() {
    setCreating(true);
    try {
      const res = await createAttendance(formId, "新建点名", []);
      if (res.attendance) {
        openEditing(res.attendance);
        await refreshList();
      } else {
        throw new Error(res.message || "新建失败");
      }
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "新建失败" });
    } finally {
      setCreating(false);
    }
  }

  async function openRecord(id: number) {
    try {
      const res = await getAttendance(id);
      if (res.attendance) openEditing(res.attendance);
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "读取点名失败" });
    }
  }

  async function toggleMember(memberId: number, present: boolean) {
    if (!editing) return;
    const attId = editing.id;
    setMarking((cur) => ({ ...cur, [memberId]: true }));
    // 先乐观翻转这一行。
    setEditing((cur) => (cur ? applyPresentLocal(cur, memberId, present) : cur));
    try {
      const res = await markAttendance(attId, memberId, present);
      // 只用返回的这一条结果补丁本行（拿到真实报到时间），不整表覆盖。
      if (res.member && editingIdRef.current === attId) {
        setEditing((cur) =>
          cur && cur.id === attId
            ? patchEntry(cur, res.member!.id, !!res.member!.present, res.member!.checked_at, res.present_count, res.total_count)
            : cur,
        );
        setSnapshots((cur) =>
          cur.map((s) =>
            s.id === attId ? { ...s, present_count: res.present_count ?? s.present_count, total_count: res.total_count ?? s.total_count } : s,
          ),
        );
      }
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "更新失败" });
      // 失败：把这一行翻回去，别的行不动。
      setEditing((cur) => (cur && cur.id === attId ? applyPresentLocal(cur, memberId, !present) : cur));
    } finally {
      setMarking((cur) => {
        const next = { ...cur };
        delete next[memberId];
        return next;
      });
    }
  }

  async function saveRemark(value: string) {
    if (!editing) return;
    const next = value.trim() || "新建点名";
    if (next === (editing.remark || "")) return;
    const attId = editing.id;
    setEditing((cur) => (cur ? { ...cur, remark: next } : cur));
    setSnapshots((cur) => cur.map((s) => (s.id === attId ? { ...s, remark: next } : s)));
    try {
      await updateAttendance(attId, next);
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "改名失败" });
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

  // -------- 点进去逐个报到 --------
  if (mode === "edit" && editing) {
    const roll = editing.roster || [];
    const kw = query.trim().toLowerCase();
    const filtered = kw
      ? roll.filter((r) => `${r.name} ${r.gender} ${r.age ?? ""}`.toLowerCase().includes(kw))
      : roll;
    return (
      <div style={sectionStyle}>
        {toastNode}
        <div style={toolbarStyle(isMobile)}>
          <button type="button" style={btnStyle} onClick={() => setMode("list")}>← 返回</button>
          <div style={countPillStyle}>已到 {editing.present_count} / 共 {editing.total_count}</div>
        </div>
        <input
          type="text"
          value={remarkDraft}
          onChange={(e) => setRemarkDraft(e.target.value)}
          onBlur={() => void saveRemark(remarkDraft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="点名名字，例如：早上报道"
          style={inputStyle}
        />
        <div style={exampleRowStyle}>
          {REMARK_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              style={chipBtnStyle}
              onClick={() => {
                setRemarkDraft(ex);
                void saveRemark(ex);
              }}
            >
              {ex}
            </button>
          ))}
        </div>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索姓名快速定位" style={inputStyle} />
        {!roll.length ? <div style={emptyStyle}>此点名名单为空（报名表暂无成员）。</div> : null}
        <div style={rollListStyle}>
          {filtered.map((r) => {
            const on = !!r.present;
            const busy = !!marking[r.id];
            const time = on ? formatTime(r.checked_at) : "";
            return (
              <button
                key={r.id}
                type="button"
                disabled={busy}
                style={{ ...rollRowStyle, ...(on ? rollRowOnStyle : {}), opacity: busy ? 0.55 : 1 }}
                onClick={() => void toggleMember(r.id, !on)}
              >
                <span style={{ display: "grid", gap: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name || `成员#${r.id}`}</span>
                  <span style={rollMetaStyle}>
                    {r.age != null ? `${r.age}岁` : "—"} · {r.gender || "—"}
                    {on && time ? ` · 到 ${time}` : ""}
                  </span>
                </span>
                <span style={on ? presentChipStyle : absentChipStyle}>{on ? "到" : "未到"}</span>
              </button>
            );
          })}
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
          <div style={mutedStyle}>共 {snapshots.length} 条</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={btnStyle} onClick={() => void refreshList()} disabled={loading}>{loading ? "刷新中…" : "刷新"}</button>
          <button type="button" style={{ ...primaryBtnStyle, opacity: creating ? 0.6 : 1 }} disabled={creating} onClick={() => void startNew()}>
            {creating ? "新建中…" : "新建点名"}
          </button>
        </div>
      </div>
      {loading ? <div style={emptyStyle}>加载中…</div> : null}
      {!loading && !snapshots.length ? <div style={emptyStyle}>还没有点名记录，点「新建点名」开始。</div> : null}
      <div style={{ display: "grid", gap: 8 }}>
        {snapshots.map((s) => (
          <div key={s.id} style={recordRowStyle}>
            <button type="button" style={recordMainStyle} onClick={() => void openRecord(s.id)}>
              <span style={{ fontWeight: 700 }}>{s.remark || "（无名）"}</span>
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
const recordRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderRadius: "9px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-alt)" };
const recordMainStyle: CSSProperties = { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px", alignItems: "flex-start", background: "transparent", border: "none", color: "var(--x-color-ink)", cursor: "pointer", textAlign: "left" };
const recordCountStyle: CSSProperties = { flexShrink: 0, fontFamily: "var(--x-font-mono)", fontSize: "12.5px", color: "var(--x-color-ink)" };
const btnStyle: CSSProperties = { padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 600, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const primaryBtnStyle: CSSProperties = { padding: "9px 18px", borderRadius: "8px", border: "1px solid var(--x-color-accent-strong)", background: "var(--x-color-accent)", color: "white", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const dangerBtnStyle: CSSProperties = { flexShrink: 0, padding: "6px 12px", borderRadius: "7px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 700, fontSize: "12px", cursor: "pointer" };
const emptyStyle: CSSProperties = { padding: "24px", borderRadius: "10px", border: "1px dashed var(--x-color-line)", textAlign: "center", color: "var(--x-color-ink-muted)" };
const successStyle: CSSProperties = { padding: "9px 13px", borderRadius: "8px", background: "var(--x-color-success-soft)", border: "1px solid rgba(21,128,61,0.28)", color: "var(--x-color-success)", fontSize: "13px" };
const errorStyle: CSSProperties = { padding: "9px 13px", borderRadius: "8px", background: "var(--x-color-danger-soft)", border: "1px solid var(--x-color-danger-border)", color: "var(--x-color-danger)", fontSize: "13px" };
