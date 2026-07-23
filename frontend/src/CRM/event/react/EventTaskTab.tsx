import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { apiFetch } from "../../../js/apiFetch";
import { showConfirmDialog } from "../../../js/dialogs";

type Task = {
  id: number;
  no: number;
  title: string;
  assignee: string | null;
  status: string;
  due_date: string | null;
  remark: string | null;
};

const STATUS_META: Record<string, { label: string; style: CSSProperties }> = {
  todo: { label: "待办", style: { background: "var(--x-color-panel-alt)", color: "var(--x-color-ink-muted)" } },
  doing: { label: "进行中", style: { background: "var(--x-color-warning-soft)", color: "var(--x-color-warning)" } },
  done: { label: "完成", style: { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" } },
};

export function EventTaskTab({ eventId, canEdit, isMobile }: { eventId: number; canEdit: boolean; isMobile: boolean }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nt, setNt] = useState({ title: "", assignee: "", due_date: "" });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/event_data/event_task/list/${eventId}`, { credentials: "include" });
      const data = await res.json();
      setTasks(Array.isArray(data.data) ? data.data : []);
    } catch {
      setError("读取待办失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function add() {
    const title = nt.title.trim();
    if (!title) return;
    try {
      const res = await apiFetch(`/api/event_data/event_task/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: eventId, title, assignee: nt.assignee.trim(), due_date: nt.due_date }),
      });
      const data = await res.json();
      if (data.data) {
        setTasks((cur) => [...cur, data.data]);
        setNt({ title: "", assignee: "", due_date: "" });
      }
    } catch {
      setError("添加失败");
    }
  }

  async function patch(id: number, body: Record<string, unknown>) {
    setTasks((cur) => cur.map((t) => (t.id === id ? { ...t, ...body } : t)));
    try {
      await apiFetch(`/api/event_data/event_task/update/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      void load();
    }
  }

  async function remove(id: number) {
    if (!(await showConfirmDialog({ message: "删除这条待办？", tone: "danger" }))) return;
    setTasks((cur) => cur.filter((t) => t.id !== id));
    try {
      await apiFetch(`/api/event_data/event_task/delete/${id}`, { method: "POST" });
    } catch {
      void load();
    }
  }

  const doneCount = tasks.filter((t) => t.status === "done").length;
  const nextStatus = (s: string) => (s === "todo" ? "doing" : s === "doing" ? "done" : "todo");

  return (
    <div style={wrapStyle}>
      <div style={headRowStyle}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>待办事项</div>
        <div style={mutedStyle}>完成 {doneCount} / 共 {tasks.length}</div>
      </div>
      {error ? <div style={errorStyle}>{error}</div> : null}

      {canEdit ? (
        <div style={addRowStyle(isMobile)}>
          <input style={{ ...inputStyle, flex: "2 1 200px" }} placeholder="事项，例如：first aid（要检查）" value={nt.title}
            onChange={(e) => setNt((v) => ({ ...v, title: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
          <input style={{ ...inputStyle, flex: "1 1 110px" }} placeholder="负责人" value={nt.assignee}
            onChange={(e) => setNt((v) => ({ ...v, assignee: e.target.value }))} />
          <input type="date" style={{ ...inputStyle, flex: "0 1 150px" }} value={nt.due_date}
            onChange={(e) => setNt((v) => ({ ...v, due_date: e.target.value }))} />
          <button type="button" style={primaryBtnStyle} disabled={!nt.title.trim()} onClick={() => void add()}>添加</button>
        </div>
      ) : null}

      {loading ? <div style={emptyStyle}>加载中…</div> : null}
      {!loading && !tasks.length ? <div style={emptyStyle}>还没有待办事项。</div> : null}
      <div style={{ display: "grid", gap: 6 }}>
        {tasks.map((t) => {
          const meta = STATUS_META[t.status] || STATUS_META.todo;
          const done = t.status === "done";
          return (
            <div key={t.id} style={taskRowStyle}>
              <button type="button" style={{ ...statusChipStyle, ...meta.style }} disabled={!canEdit}
                onClick={() => canEdit && void patch(t.id, { status: nextStatus(t.status) })} title="点击切换状态">
                {meta.label}
              </button>
              <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
                {canEdit ? (
                  <input style={titleInputStyle(done)} defaultValue={t.title}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.title) void patch(t.id, { title: v }); }} />
                ) : (
                  <span style={{ fontWeight: 600, textDecoration: done ? "line-through" : "none" }}>{t.title}</span>
                )}
                {canEdit ? (
                  <input style={remarkInputStyle} placeholder="备注" defaultValue={t.remark || ""}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (t.remark || "")) void patch(t.id, { remark: v }); }} />
                ) : t.remark ? <span style={mutedStyle}>{t.remark}</span> : null}
              </div>
              {canEdit ? (
                <input style={assigneeInputStyle} placeholder="负责人" defaultValue={t.assignee || ""}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== (t.assignee || "")) void patch(t.id, { assignee: v }); }} />
              ) : t.assignee ? <span style={assigneeTextStyle}>{t.assignee}</span> : null}
              {canEdit ? (
                <input type="date" style={dueInputStyle} defaultValue={t.due_date || ""}
                  onChange={(e) => void patch(t.id, { due_date: e.target.value })} />
              ) : t.due_date ? <span style={mutedStyle}>{t.due_date}</span> : null}
              {canEdit ? <button type="button" style={delBtnStyle} onClick={() => void remove(t.id)}>删除</button> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const wrapStyle: CSSProperties = { display: "grid", gap: "10px" };
const headRowStyle: CSSProperties = { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 };
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
function addRowStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", gap: "6px", flexWrap: "wrap", padding: "10px", borderRadius: "9px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)", flexDirection: isMobile ? "column" : "row" };
}
const inputStyle: CSSProperties = { padding: "8px 10px", borderRadius: "7px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontSize: "13px", boxSizing: "border-box" };
const primaryBtnStyle: CSSProperties = { padding: "8px 16px", borderRadius: "7px", border: "1px solid var(--x-color-accent-strong)", background: "var(--x-color-accent)", color: "white", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const taskRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", flexWrap: "wrap" };
const statusChipStyle: CSSProperties = { flexShrink: 0, padding: "4px 10px", borderRadius: "6px", border: "none", fontWeight: 700, fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap" };
const titleInputStyle = (done: boolean): CSSProperties => ({ border: "none", background: "transparent", color: "var(--x-color-ink)", fontSize: "13.5px", fontWeight: 600, padding: "2px 0", textDecoration: done ? "line-through" : "none", width: "100%" });
const remarkInputStyle: CSSProperties = { border: "none", background: "transparent", color: "var(--x-color-ink-muted)", fontSize: "12px", padding: "1px 0", width: "100%" };
const assigneeInputStyle: CSSProperties = { flexShrink: 0, width: "90px", padding: "5px 8px", borderRadius: "6px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink)", fontSize: "12px" };
const assigneeTextStyle: CSSProperties = { flexShrink: 0, fontSize: "12px", color: "var(--x-color-ink)", padding: "2px 8px", borderRadius: "999px", background: "var(--x-color-panel-alt)" };
const dueInputStyle: CSSProperties = { flexShrink: 0, padding: "5px 8px", borderRadius: "6px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink)", fontSize: "12px" };
const delBtnStyle: CSSProperties = { flexShrink: 0, padding: "5px 10px", borderRadius: "6px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 700, fontSize: "12px", cursor: "pointer" };
const emptyStyle: CSSProperties = { padding: "22px", borderRadius: "10px", border: "1px dashed var(--x-color-line)", textAlign: "center", color: "var(--x-color-ink-muted)" };
const errorStyle: CSSProperties = { padding: "9px 12px", borderRadius: "8px", background: "var(--x-color-danger-soft)", border: "1px solid var(--x-color-danger-border)", color: "var(--x-color-danger)", fontSize: "13px" };
