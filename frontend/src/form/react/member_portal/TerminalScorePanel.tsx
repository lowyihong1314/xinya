import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { io, type Socket } from "socket.io-client";

import { API_BASE } from "../../../js/apiBase";
import { apiFetch } from "../../../js/apiFetch";

type GroupMember = { name: string; age: number | null; gender: string; is_leader?: boolean };
type Group = { id: number; name: string; score: number; color?: string | null; members?: GroupMember[] };
type PanelData = {
  status: string;
  message?: string;
  creator_name?: string | null;
  form_id?: number;
  form_title?: string | null;
  palette?: Record<string, string>;
  groups?: Group[];
};

// 终端内嵌积分控制面板：跟成员终端同一套浅色风格，不套整页。
export function TerminalScorePanel({ token }: { token: string }) {
  const [data, setData] = useState<PanelData | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");
  const [showMembers, setShowMembers] = useState(false);
  const formIdRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiFetch(`/api/form/score_panel/${token}/data`)
      .then((r) => r.json())
      .then((d: PanelData) => {
        if (!active) return;
        if (d.status !== "success") { setError(d.message || "链接无效"); return; }
        setData(d);
        setGroups(d.groups || []);
        formIdRef.current = d.form_id ?? null;
        if ((d.groups || []).length) setSelectedId(d.groups![0].id);
      })
      .catch(() => { if (active) setError("网络错误，请稍后再试"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    const formId = data?.form_id;
    if (!formId) return;
    const origin = API_BASE || (typeof window !== "undefined" ? window.location.origin : "");
    const socket: Socket = io(origin, { withCredentials: true, transports: ["websocket", "polling"] });
    const join = () => socket.emit("join_room", { room: `form_score_${formId}` });
    socket.on("connect", join);
    if (socket.connected) join();
    socket.on("group_score", (p: { form_id?: number; group_id?: number; score?: number; color?: string | null; name?: string }) => {
      if (p.form_id !== formId || p.group_id == null) return;
      setGroups((cur) => cur.map((g) => (g.id === p.group_id ? { ...g, score: p.score ?? g.score, color: p.color ?? g.color, name: p.name ?? g.name } : g)));
    });
    return () => { socket.off("group_score"); socket.off("connect", join); socket.disconnect(); };
  }, [data?.form_id]);

  const selected = groups.find((g) => g.id === selectedId) || null;
  const palette = data?.palette || {};

  async function adjust(delta: number) {
    if (!selected || busy || !delta) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/form/score_panel/${token}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: selected.id, delta }),
      });
      const d = await res.json();
      if (!res.ok || d.status !== "success") throw new Error(d.message || "操作失败");
      setGroups((cur) => cur.map((g) => (g.id === d.group.id ? { ...g, score: d.group.score } : g)));
      setFlash(`${selected.name} ${delta > 0 ? "+" : ""}${delta}`);
      window.setTimeout(() => setFlash(""), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
      window.setTimeout(() => setError(""), 2500);
    } finally {
      setBusy(false);
    }
  }

  function deduct() {
    const raw = window.prompt("扣多少分？", "5");
    if (raw == null) return;
    const n = Math.abs(parseInt(raw, 10));
    if (!Number.isFinite(n) || n <= 0) return;
    void adjust(-n);
  }

  if (loading) return <section style={cardStyle}><div style={hintStyle}>加载中…</div></section>;
  if (error && !data) return <section style={cardStyle}><div style={errBoxStyle}>{error}</div></section>;

  return (
    <section style={cardStyle}>
      <div style={headStyle}>
        <h2 style={titleStyle}>积分控制</h2>
        <span style={controllerStyle}>控制者：{data?.creator_name || "—"}</span>
      </div>

      {!groups.length ? <div style={hintStyle}>这个表单还没有小组。</div> : null}

      <div style={cardsWrapStyle}>
        {groups.map((g) => {
          const tint = g.color && palette[g.color] ? palette[g.color] : null;
          const isSel = g.id === selectedId;
          return (
            <button
              key={g.id}
              type="button"
              style={{
                ...groupCardStyle,
                background: tint || "#f8fafc",
                ...(isSel ? groupCardSelStyle : {}),
              }}
              onClick={() => setSelectedId(g.id)}
            >
              <div style={groupNameStyle}>{g.name}</div>
              <div style={groupScoreStyle}>{g.score}</div>
            </button>
          );
        })}
      </div>

      {flash ? <div style={flashStyle}>{flash}</div> : null}
      {error && data ? <div style={errBoxStyle}>{error}</div> : null}

      <div style={btnRowStyle}>
        <button type="button" style={{ ...bigBtnStyle, ...(selected ? {} : disStyle) }} disabled={!selected || busy} onClick={() => void adjust(1)}>+1</button>
        <button type="button" style={{ ...bigBtnStyle, ...(selected ? {} : disStyle) }} disabled={!selected || busy} onClick={() => void adjust(5)}>+5</button>
        <button type="button" style={{ ...bigBtnStyle, ...(selected ? {} : disStyle) }} disabled={!selected || busy} onClick={() => void adjust(10)}>+10</button>
        <button type="button" style={{ ...bigBtnStyle, ...deductBtnStyle, ...(selected ? {} : disStyle) }} disabled={!selected || busy} onClick={deduct}>扣分</button>
      </div>

      {selected ? (
        <div style={selInfoStyle}>
          当前：{selected.name} · {selected.score} 分
          <button type="button" style={membersBtnStyle} onClick={() => setShowMembers(true)}>
            组员（{selected.members?.length ?? 0}）
          </button>
        </div>
      ) : <div style={selInfoStyle}>请先选择一个小组</div>}

      {showMembers && selected ? (
        <div style={sheetOverlayStyle} onClick={() => setShowMembers(false)}>
          <div style={sheetStyle} onClick={(e) => e.stopPropagation()}>
            <div style={sheetHeadStyle}>
              <span style={{ fontWeight: 800, fontSize: 16 }}>{selected.name} · 组员（{selected.members?.length ?? 0}）</span>
              <button type="button" style={sheetCloseStyle} onClick={() => setShowMembers(false)}>关闭</button>
            </div>
            {!selected.members?.length ? <div style={hintStyle}>这个小组还没有成员。</div> : null}
            <div style={{ display: "grid", gap: 6 }}>
              {(selected.members || []).map((m, i) => (
                <div key={i} style={{ ...memberRowStyle, ...(m.is_leader ? { border: "1px solid #6366f1" } : {}) }}>
                  <span style={{ fontWeight: 700 }}>{m.is_leader ? "👑 " : ""}{m.name || "—"}</span>
                  <span style={{ color: "#6b7280", fontSize: 13 }}>{m.age != null ? `${m.age}岁` : "—"} · {m.gender || "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const cardStyle: CSSProperties = { background: "rgba(255,255,255,0.92)", border: "1px solid #e5e7eb", borderRadius: 16, padding: 20, boxShadow: "0 12px 40px rgba(30,41,59,0.10)", display: "grid", gap: 12 };
const headStyle: CSSProperties = { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" };
const titleStyle: CSSProperties = { margin: 0, fontSize: 18, fontWeight: 800 };
const controllerStyle: CSSProperties = { fontSize: 12.5, color: "#6b7280" };
const cardsWrapStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))", gap: 10 };
const groupCardStyle: CSSProperties = { border: "2px solid #e5e7eb", borderRadius: 14, padding: "14px 10px", cursor: "pointer", textAlign: "center", display: "grid", gap: 4, minHeight: 84, color: "#0f172a" };
const groupCardSelStyle: CSSProperties = { border: "3px solid #6366f1", boxShadow: "0 0 0 4px rgba(99,102,241,0.22)", transform: "translateY(-2px)" };
const groupNameStyle: CSSProperties = { fontSize: 14, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const groupScoreStyle: CSSProperties = { fontSize: 30, fontWeight: 900, lineHeight: 1 };
const flashStyle: CSSProperties = { textAlign: "center", fontWeight: 900, fontSize: 20, color: "#4338ca" };
const btnRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 };
const bigBtnStyle: CSSProperties = { padding: "20px 6px", borderRadius: 14, border: "none", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontWeight: 900, fontSize: 22, cursor: "pointer", boxShadow: "0 10px 24px rgba(99,102,241,0.35)" };
const deductBtnStyle: CSSProperties = { background: "linear-gradient(135deg,#ef4444,#f97316)", boxShadow: "0 10px 24px rgba(239,68,68,0.35)", fontSize: 18 };
const disStyle: CSSProperties = { opacity: 0.4, cursor: "not-allowed" };
const selInfoStyle: CSSProperties = { textAlign: "center", color: "#6b7280", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" };
const membersBtnStyle: CSSProperties = { padding: "7px 14px", borderRadius: 999, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const sheetOverlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 100, background: "rgba(15,23,42,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center" };
const sheetStyle: CSSProperties = { width: "min(560px, 100%)", maxHeight: "80vh", overflowY: "auto", background: "#fff", borderRadius: "18px 18px 0 0", padding: 16, boxShadow: "0 -20px 50px rgba(15,23,42,0.25)" };
const sheetHeadStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 };
const sheetCloseStyle: CSSProperties = { padding: "6px 12px", borderRadius: 999, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontWeight: 700, fontSize: 12.5, cursor: "pointer" };
const memberRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: 10, background: "#f8fafc", border: "1px solid #eef2f7" };
const hintStyle: CSSProperties = { textAlign: "center", color: "#6b7280", padding: 24 };
const errBoxStyle: CSSProperties = { padding: "12px 14px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13, textAlign: "center" };
