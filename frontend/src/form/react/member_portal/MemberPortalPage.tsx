import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { apiFetch } from "../../../js/apiFetch";

type PortalForm = { form_id: number; title: string };
type PortalEvent = {
  id: number;
  event_name?: string | null;
  type?: string | null;
  datetime?: string | null;
  end_datetime?: string | null;
  location?: string | null;
  target?: string | null;
  purpose?: string | null;
};
type ParticipatedEvent = PortalEvent & { accessible: boolean; state: string; state_message?: string | null; forms: PortalForm[] };
type FlowItem = { no?: number; minutes?: number | null; title?: string | null; detail?: string | null };
type DetailResponse = {
  status: string;
  message?: string;
  member_name?: string | null;
  form_title?: string | null;
  event?: PortalEvent;
  event_name?: string | null;
  flow?: FlowItem[];
};

const pad = (n: number) => String(n).padStart(2, "0");
function fmtDateTime(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function clock(d: Date | null): string {
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "--:--";
}
function setQuery(params: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) sp.set(k, v);
  });
  window.location.search = sp.toString();
}

export function MemberPortalPage() {
  const search = new URLSearchParams(window.location.search);
  const nric = (search.get("nric") || "").trim();
  const rawFormId = search.get("form_id");
  const formId = rawFormId && Number.isFinite(Number(rawFormId)) ? Number(rawFormId) : null;

  return (
    <div style={pageStyle}>
      <div style={shellStyle}>
        <div style={brandStyle}>成员终端</div>
        {!nric ? (
          <NricGate />
        ) : formId ? (
          <PortalView nric={nric} formId={formId} />
        ) : (
          <ParticipatedView nric={nric} />
        )}
      </div>
    </div>
  );
}

function NricGate() {
  const [value, setValue] = useState("");
  return (
    <section style={cardStyle}>
      <h1 style={titleStyle}>请输入 NRIC</h1>
      <p style={mutedStyle}>输入你报名时用的身份证 / 护照号码，查看你参加的活动。</p>
      <input
        style={inputStyle}
        placeholder="例如 010203040506"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) setQuery({ nric: value.trim() }); }}
        autoFocus
      />
      <button type="button" style={{ ...primaryStyle, ...(value.trim() ? {} : disabledStyle) }} disabled={!value.trim()} onClick={() => setQuery({ nric: value.trim() })}>
        进入
      </button>
    </section>
  );
}

function ParticipatedView({ nric }: { nric: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [events, setEvents] = useState<ParticipatedEvent[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    apiFetch(`/api/form/member/participated?nric=${encodeURIComponent(nric)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (data.status !== "success") { setError(data.message || "查询失败"); return; }
        setName(data.member_name ?? null);
        setEvents(Array.isArray(data.events) ? data.events : []);
      })
      .catch(() => { if (active) setError("网络错误，请稍后再试"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [nric]);

  return (
    <section style={cardStyle}>
      <div style={headRowStyle}>
        <div>
          <h1 style={titleStyle}>{name ? `${name}，你好` : "你参加的活动"}</h1>
          <p style={mutedStyle}>点选活动进入。仅在活动结束时间之前开放。</p>
        </div>
      </div>

      {loading ? <div style={hintStyle}>加载中…</div> : null}
      {error ? (
        <div>
          <div style={errBoxStyle}>{error}</div>
          <button type="button" style={{ ...ghostStyle, marginTop: 10 }} onClick={() => setQuery({})}>换 NRIC</button>
        </div>
      ) : null}
      {!loading && !error && !events.length ? (
        <div style={{ display: "grid", gap: 10, justifyItems: "center" }}>
          <div style={hintStyle}>没有找到这个 NRIC 的报名记录。</div>
          <button type="button" style={ghostStyle} onClick={() => setQuery({})}>换 NRIC</button>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 10 }}>
        {events.map((ev) => {
          const canEnter = ev.accessible;
          const onePick = ev.forms.length === 1;
          const enter = (fid: number) => setQuery({ nric, form_id: String(fid) });
          return (
            <div key={ev.id} style={{ ...eventCardStyle, ...(canEnter ? {} : dimStyle) }}>
              <button
                type="button"
                style={eventMainStyle}
                disabled={!canEnter || !onePick}
                onClick={() => canEnter && onePick && enter(ev.forms[0].form_id)}
              >
                <div style={eventTitleStyle}>{ev.event_name || `活动 #${ev.id}`}</div>
                <div style={mutedStyle}>
                  {fmtDateTime(ev.datetime)}{ev.end_datetime ? ` — ${fmtDateTime(ev.end_datetime)}` : ""}
                  {ev.location ? ` · ${ev.location}` : ""}
                </div>
                {!canEnter ? <div style={badgeMutedStyle}>{ev.state_message || "暂不可进入"}</div> : null}
              </button>
              {canEnter && !onePick ? (
                <div style={formPickStyle}>
                  <span style={mutedStyle}>选择报名表：</span>
                  {ev.forms.map((f) => (
                    <button key={f.form_id} type="button" style={smallBtnStyle} onClick={() => enter(f.form_id)}>{f.title || `表 #${f.form_id}`}</button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PortalView({ nric, formId }: { nric: string; formId: number }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    apiFetch(`/api/form/member/detail?nric=${encodeURIComponent(nric)}&form_id=${formId}`)
      .then((r) => r.json())
      .then((d) => { if (active) setData(d); })
      .catch(() => { if (active) setError("网络错误，请稍后再试"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [nric, formId]);

  const ev = data?.event;
  const startDate = ev?.datetime ? new Date(ev.datetime) : null;
  const flowRows = useMemo(() => {
    const rows: { start: Date | null; end: Date | null; item: FlowItem }[] = [];
    let cum = 0;
    for (const item of data?.flow || []) {
      const s = startDate ? new Date(startDate.getTime() + cum * 60000) : null;
      cum += Number(item.minutes) || 0;
      const e = startDate ? new Date(startDate.getTime() + cum * 60000) : null;
      rows.push({ start: s, end: e, item });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.flow, ev?.datetime]);

  if (loading) return <section style={cardStyle}><div style={hintStyle}>加载中…</div></section>;
  if (error) return <section style={cardStyle}><div style={errBoxStyle}>{error}</div><BackBar nric={nric} /></section>;
  if (!data) return null;

  if (data.status !== "success") {
    return (
      <section style={cardStyle}>
        <h1 style={titleStyle}>{data.event_name || data.form_title || "通道未开放"}</h1>
        <div style={closedBoxStyle}>{data.message || "此通道暂不可用。"}</div>
        <BackBar nric={nric} />
      </section>
    );
  }

  return (
    <section style={cardStyle}>
      <div style={headRowStyle}>
        <div>
          <div style={eyebrowStyle}>{data.member_name || ""}</div>
          <h1 style={titleStyle}>{ev?.event_name || data.form_title || "活动"}</h1>
        </div>
      </div>

      <div style={factGridStyle}>
        {ev?.datetime ? <Fact label="时间" value={`${fmtDateTime(ev.datetime)}${ev.end_datetime ? ` — ${fmtDateTime(ev.end_datetime)}` : ""}`} /> : null}
        {ev?.location ? <Fact label="地点" value={ev.location} /> : null}
        {ev?.target ? <Fact label="对象" value={ev.target} /> : null}
        {ev?.type ? <Fact label="类型" value={ev.type} /> : null}
      </div>
      {ev?.purpose ? <div style={purposeStyle}>{ev.purpose}</div> : null}

      <h2 style={sectionTitleStyle}>流程</h2>
      {!flowRows.length ? <div style={hintStyle}>暂无流程。</div> : null}
      <div style={{ display: "grid", gap: 8 }}>
        {flowRows.map(({ start, end, item }, i) => (
          <div key={i} style={flowRowStyle}>
            <div style={timeBadgeStyle}>
              <span style={{ fontWeight: 800 }}>{clock(start)}</span>
              <span style={{ fontSize: 11, opacity: 0.7 }}>{clock(end)}</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{item.title || "（环节）"}</div>
              {item.detail ? <div style={mutedStyle}>{item.detail}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={factStyle}>
      <div style={factLabelStyle}>{label}</div>
      <div style={factValueStyle}>{value}</div>
    </div>
  );
}
function BackBar({ nric }: { nric: string }) {
  return (
    <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
      <button type="button" style={ghostStyle} onClick={() => setQuery({ nric })}>← 我的活动</button>
    </div>
  );
}

const pageStyle: CSSProperties = { minHeight: "100vh", boxSizing: "border-box", padding: "20px 14px", background: "linear-gradient(160deg,#eef4ff,#f7fbff 40%,#fef6ff)", fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", color: "#1f2937" };
const shellStyle: CSSProperties = { width: "min(560px, 100%)", margin: "0 auto", display: "grid", gap: 12 };
const brandStyle: CSSProperties = { fontSize: 13, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", color: "#6366f1", textAlign: "center" };
const cardStyle: CSSProperties = { background: "rgba(255,255,255,0.92)", border: "1px solid #e5e7eb", borderRadius: 16, padding: "20px", boxShadow: "0 12px 40px rgba(30,41,59,0.10)", display: "grid", gap: 12 };
const headRowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 };
const titleStyle: CSSProperties = { margin: 0, fontSize: 22, fontWeight: 800 };
const eyebrowStyle: CSSProperties = { fontSize: 12, fontWeight: 700, color: "#6366f1", letterSpacing: "0.08em" };
const mutedStyle: CSSProperties = { fontSize: 13, color: "#6b7280", lineHeight: 1.5 };
const inputStyle: CSSProperties = { width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid #d1d5db", fontSize: 16, boxSizing: "border-box", letterSpacing: "0.04em" };
const primaryStyle: CSSProperties = { padding: "12px 16px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer" };
const disabledStyle: CSSProperties = { opacity: 0.5, cursor: "not-allowed" };
const ghostStyle: CSSProperties = { padding: "7px 12px", borderRadius: 999, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontWeight: 700, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" };
const smallBtnStyle: CSSProperties = { padding: "7px 12px", borderRadius: 8, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const hintStyle: CSSProperties = { padding: 18, textAlign: "center", color: "#6b7280" };
const errBoxStyle: CSSProperties = { padding: "12px 14px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13 };
const closedBoxStyle: CSSProperties = { padding: "16px", borderRadius: 12, background: "#f3f4f6", border: "1px solid #e5e7eb", color: "#4b5563", textAlign: "center", fontWeight: 600 };
const eventCardStyle: CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", overflow: "hidden" };
const dimStyle: CSSProperties = { opacity: 0.62 };
const eventMainStyle: CSSProperties = { width: "100%", textAlign: "left", padding: "14px", border: "none", background: "transparent", cursor: "pointer", display: "grid", gap: 4, color: "inherit" };
const eventTitleStyle: CSSProperties = { fontSize: 16, fontWeight: 800 };
const badgeMutedStyle: CSSProperties = { marginTop: 4, fontSize: 12, fontWeight: 700, color: "#9ca3af" };
const formPickStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "0 14px 14px" };
const factGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 };
const factStyle: CSSProperties = { background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 10, padding: "9px 11px", display: "grid", gap: 2 };
const factLabelStyle: CSSProperties = { fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "#94a3b8" };
const factValueStyle: CSSProperties = { fontSize: 13.5, fontWeight: 600, wordBreak: "break-word" };
const purposeStyle: CSSProperties = { fontSize: 13.5, lineHeight: 1.6, color: "#374151", whiteSpace: "pre-wrap", background: "#f8fafc", borderRadius: 10, padding: "12px" };
const sectionTitleStyle: CSSProperties = { margin: "6px 0 0", fontSize: 15, fontWeight: 800 };
const flowRowStyle: CSSProperties = { display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", borderRadius: 10, border: "1px solid #eef2f7", background: "#fff" };
const timeBadgeStyle: CSSProperties = { flexShrink: 0, display: "grid", justifyItems: "center", minWidth: 54, padding: "6px 8px", borderRadius: 8, background: "#eef2ff", color: "#4338ca", lineHeight: 1.2 };
