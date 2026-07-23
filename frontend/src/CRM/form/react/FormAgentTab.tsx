import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { io, type Socket } from "socket.io-client";

import { API_BASE } from "../../../js/apiBase";
import { apiFetch } from "../../../js/apiFetch";
import { showConfirmDialog } from "../../../js/dialogs";

type Seg = { add?: unknown[]; update?: unknown[]; delete?: unknown[]; rename?: unknown[]; groups?: unknown[]; remove?: unknown[] };
type Plan = {
  settings?: Record<string, unknown>;
  groups?: Seg;
  fees?: Seg;
  extra_fields?: Seg;
  members?: Seg;
};
type Entry = { role: "user" | "assistant"; content: string; plan?: Plan | null; applied?: boolean };
type ChatMessage = { role: "user" | "assistant"; content: string };

function stripJson(text: string): string {
  const cleaned = (text || "").replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/g, "").trim();
  return cleaned || (text || "").trim();
}
function segCount(o?: Seg): number {
  return (o?.add?.length || 0) + (o?.update?.length || 0) + (o?.delete?.length || 0) + (o?.rename?.length || 0) + (o?.groups?.length || 0) + (o?.remove?.length || 0);
}
function planHasContent(p?: Plan | null): boolean {
  if (!p) return false;
  return Boolean((p.settings && Object.keys(p.settings).length) || segCount(p.groups) || segCount(p.fees) || segCount(p.extra_fields) || segCount(p.members));
}
function summarizePlan(p: Plan): string[] {
  const lines: string[] = [];
  if (p.settings && Object.keys(p.settings).length) lines.push(`基本设置：${Object.keys(p.settings).join("、")}`);
  const seg = (label: string, o?: Seg, addKey: "add" | "groups" = "add") => {
    if (!o) return;
    const parts: string[] = [];
    const addN = (o[addKey] as unknown[] | undefined)?.length || 0;
    if (addN) parts.push(`加 ${addN}`);
    if (o.rename?.length) parts.push(`改名 ${o.rename.length}`);
    if (o.update?.length) parts.push(`改 ${o.update.length}`);
    if (o.delete?.length) parts.push(`删 ${o.delete.length}`);
    if (o.remove?.length) parts.push(`移除 ${o.remove.length}`);
    if (parts.length) lines.push(`${label}：${parts.join(" · ")}`);
  };
  seg("分组", p.groups, "groups");
  seg("报名费", p.fees);
  seg("表格内容", p.extra_fields);
  seg("成员", p.members);
  return lines;
}

export function FormAgentTab({ formId, canEdit, isMobile, onApplied }: { formId: number; canEdit: boolean; isMobile: boolean; onApplied?: () => void }) {
  const storageKey = `xinya_form_agent_${formId}`;
  const [entries, setEntries] = useState<Entry[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const pendingJobRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(entries));
    } catch {
      /* ignore */
    }
  }, [entries, storageKey]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [entries, pending]);

  useEffect(() => {
    const origin = API_BASE || (typeof window !== "undefined" ? window.location.origin : "");
    const room = `form_agent_${formId}`;
    const socket: Socket = io(origin, { withCredentials: true, transports: ["websocket", "polling"] });
    const join = () => socket.emit("join_room", { room });
    socket.on("connect", join);
    if (socket.connected) join();
    socket.on("form_agent_reply", (payload: { job_id?: string; status?: string; reply?: string; plan?: Plan | null; message?: string }) => {
      if (!payload || payload.job_id !== pendingJobRef.current) return;
      pendingJobRef.current = null;
      setPending(false);
      if (payload.status === "error") setError(payload.message || "AI 请求失败");
      else setEntries((cur) => [...cur, { role: "assistant", content: payload.reply || "（无回复）", plan: payload.plan || null }]);
    });
    return () => {
      socket.off("form_agent_reply");
      socket.off("connect", join);
      socket.disconnect();
    };
  }, [formId]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    setError("");
    const history: ChatMessage[] = [...entries.map((e) => ({ role: e.role, content: e.content })), { role: "user", content }];
    setEntries((cur) => [...cur, { role: "user", content }]);
    setInput("");
    setPending(true);
    try {
      const res = await apiFetch(`/api/form/agent/chat/${formId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      const data = await res.json();
      if (!res.ok || !data.job_id) throw new Error(data.message || "AI 任务未启动");
      const jobId = data.job_id as string;
      pendingJobRef.current = jobId;
      window.setTimeout(() => {
        if (pendingJobRef.current === jobId) {
          pendingJobRef.current = null;
          setPending(false);
          setError("AI 响应超时，请重试");
        }
      }, 120000);
    } catch (err) {
      setPending(false);
      setError(err instanceof Error ? err.message : "AI 请求失败");
    }
  }

  async function apply(idx: number) {
    const entry = entries[idx];
    if (!entry?.plan) return;
    const lines = summarizePlan(entry.plan);
    if (!(await showConfirmDialog({ message: `确认执行以下改动？\n${lines.join("\n")}`, tone: "danger" }))) return;
    try {
      const res = await apiFetch(`/api/form/agent/apply/${formId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: entry.plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "应用失败");
      setEntries((cur) => cur.map((e, i) => (i === idx ? { ...e, applied: true } : e)).concat([{ role: "assistant", content: `✅ 已执行 ${data.count ?? 0} 项改动。` }]));
      onApplied?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用失败");
    }
  }

  function clearChat() {
    setEntries([]);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }

  if (!canEdit) {
    return <div style={emptyStyle}>报名表 Agent 需要 form_edit 权限。</div>;
  }

  const examples = ["现在几个人报名、几个未分组？", "把大家按年龄平衡分成 3 组", "加一个成人报名费 RM50、儿童 RM30", "表格内容加一项「紧急联络人电话」"];

  return (
    <div style={wrapStyle}>
      <div style={headRowStyle}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>
            <i className="fa-solid fa-robot" style={{ marginRight: 6, color: "var(--x-color-accent)" }} />报名表 Agent
          </div>
          <div style={mutedStyle}>能读/改本表的 基本设置 · 分组 · 报名费 · 表格内容 · 成员。改动先预览，点「应用」才执行。只发送成员的姓名/年龄/性别/组名。</div>
        </div>
        {entries.length ? <button type="button" style={btnStyle} onClick={clearChat}>清空对话</button> : null}
      </div>

      <div ref={listRef} style={listStyle(isMobile)}>
        {!entries.length ? (
          <div style={chatEmptyStyle}>
            <div style={{ marginBottom: 8 }}>试试这样说：</div>
            {examples.map((ex) => (
              <button key={ex} type="button" style={exampleStyle} onClick={() => void send(ex)}>{ex}</button>
            ))}
          </div>
        ) : null}
        {entries.map((e, i) => (
          <div key={i} style={e.role === "user" ? rowUserStyle : rowAiStyle}>
            <div style={e.role === "user" ? bubbleUserStyle : bubbleAiStyle}>
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{stripJson(e.content)}</div>
              {planHasContent(e.plan) ? (
                <div style={planBoxStyle}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>建议操作</div>
                  {summarizePlan(e.plan as Plan).map((line, k) => (
                    <div key={k} style={{ fontSize: 12.5 }}>{line}</div>
                  ))}
                  <button type="button" style={{ ...primaryBtnStyle, marginTop: 8, opacity: e.applied ? 0.5 : 1 }} disabled={e.applied} onClick={() => void apply(i)}>
                    {e.applied ? "已应用" : "应用此操作"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {pending ? <div style={rowAiStyle}><div style={bubbleAiStyle}>思考中…（处理完会自动回到这里）</div></div> : null}
      </div>

      {error ? <div style={errorStyle}>{error}</div> : null}

      <div style={inputBarStyle}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
          placeholder="对报名表下指令或提问…（Enter 发送，Shift+Enter 换行）"
          style={textareaStyle}
          rows={isMobile ? 2 : 3}
        />
        <button type="button" style={{ ...primaryBtnStyle, opacity: pending || !input.trim() ? 0.6 : 1 }} disabled={pending || !input.trim()} onClick={() => void send(input)}>发送</button>
      </div>
    </div>
  );
}

const wrapStyle: CSSProperties = { display: "grid", gap: "10px" };
const headRowStyle: CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 };
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
function listStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", flexDirection: "column", gap: "10px", padding: "12px", borderRadius: "10px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-canvas-alt)", height: isMobile ? "48vh" : "min(52vh, 520px)", overflowY: "auto" };
}
const chatEmptyStyle: CSSProperties = { margin: "auto 0", color: "var(--x-color-ink-muted)", fontSize: "13px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px" };
const exampleStyle: CSSProperties = { textAlign: "left", padding: "8px 12px", borderRadius: "8px", border: "1px dashed var(--x-color-accent-border)", background: "var(--x-color-panel)", color: "var(--x-color-accent-strong)", fontSize: "13px", cursor: "pointer", width: "100%" };
const rowUserStyle: CSSProperties = { display: "flex", justifyContent: "flex-end" };
const rowAiStyle: CSSProperties = { display: "flex", justifyContent: "flex-start" };
const bubbleUserStyle: CSSProperties = { maxWidth: "84%", padding: "9px 12px", borderRadius: "12px 12px 2px 12px", background: "var(--x-color-accent)", color: "#fff", fontSize: "13.5px", lineHeight: 1.5 };
const bubbleAiStyle: CSSProperties = { maxWidth: "84%", padding: "9px 12px", borderRadius: "12px 12px 12px 2px", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line)", color: "var(--x-color-ink)", fontSize: "13.5px", lineHeight: 1.5 };
const planBoxStyle: CSSProperties = { marginTop: "8px", padding: "10px", borderRadius: "8px", background: "var(--x-color-accent-tint)", border: "1px solid var(--x-color-accent-border)", display: "grid", gap: "2px" };
const inputBarStyle: CSSProperties = { display: "flex", gap: "8px", alignItems: "flex-end" };
const textareaStyle: CSSProperties = { flex: 1, resize: "none", padding: "9px 11px", borderRadius: "10px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink)", fontSize: "13.5px", lineHeight: 1.5, boxSizing: "border-box" };
const btnStyle: CSSProperties = { padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 600, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const primaryBtnStyle: CSSProperties = { padding: "9px 18px", borderRadius: "8px", border: "1px solid var(--x-color-accent-strong)", background: "var(--x-color-accent)", color: "white", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const emptyStyle: CSSProperties = { padding: "22px", borderRadius: "10px", border: "1px dashed var(--x-color-line)", textAlign: "center", color: "var(--x-color-ink-muted)" };
const errorStyle: CSSProperties = { padding: "9px 12px", borderRadius: "8px", background: "var(--x-color-danger-soft)", border: "1px solid var(--x-color-danger-border)", color: "var(--x-color-danger)", fontSize: "13px" };
