import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { io, type Socket } from "socket.io-client";

import { API_BASE } from "../../../js/apiBase";
import { apiFetch } from "../../../js/apiFetch";
import { LogoQrBadge } from "../../../components/LogoQrBadge";
import { createMemberPayment, fetchPaymentQuote, resolveStaticUrl } from "../payApi";
import { GoogleMapEmbed } from "../../../components/GoogleMapEmbed";
import type { FormFee } from "../../../CRM/form/react/types";

type PortalForm = { form_id: number; title: string };
type PortalEvent = {
  id: number;
  event_name?: string | null;
  type?: string | null;
  datetime?: string | null;
  end_datetime?: string | null;
  location?: string | null;
  place_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  target?: string | null;
  purpose?: string | null;
};
type ParticipatedEvent = PortalEvent & { accessible: boolean; state: string; state_message?: string | null; forms: PortalForm[] };
type FlowItem = { no?: number; minutes?: number | null; title?: string | null; detail?: string | null };
type MemberExtraField = { label?: string | null; field_value?: unknown };
type MemberData = {
  name_cn?: string | null; name?: string | null; nric?: string | null; gender?: string | null;
  phone?: string | null; email?: string | null; address?: string | null;
  medical?: string | null; allergy?: string | null; other_remark?: string | null;
  parent_1?: string | null; parent_1_phone?: string | null; parent_2?: string | null; parent_2_phone?: string | null;
  group?: string | null;
  group_id?: number | null;
  group_score?: number | null;
  is_leader?: boolean;
  extra_fields?: MemberExtraField[];
};
type PortalGroupMember = { name: string; age: number | null; gender: string; is_leader?: boolean };
type PaymentInfo = { applicable: boolean; status: string | null; price?: number | null };
type DetailResponse = {
  status: string;
  message?: string;
  member_name?: string | null;
  form_title?: string | null;
  notes?: string | null;
  event?: PortalEvent;
  event_name?: string | null;
  poster_url?: string | null;
  flow?: FlowItem[];
  member_data?: MemberData | null;
  group_members?: PortalGroupMember[] | null;
  payment?: PaymentInfo | null;
};

function fmtVal(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (Array.isArray(v)) return v.join("、");
  return String(v);
}
function buildMemberFacts(md: MemberData): { label: string; value: string }[] {
  const contact = (name?: string | null, phone?: string | null) =>
    name && phone ? `${name}（${phone}）` : (name || phone || "");
  const raw: [string, string][] = [
    ["中文名", md.name_cn || ""],
    ["英文名", md.name || ""],
    ["NRIC", md.nric || ""],
    ["性别", md.gender || ""],
    ["电话", md.phone || ""],
    ["Email", md.email || ""],
    ["居住地址", md.address || ""],
    ["小组", md.group || ""],
    ["小组积分", md.group != null && md.group_score != null ? `${md.group_score} 分` : ""],
    ["紧急联络人 1", contact(md.parent_1, md.parent_1_phone)],
    ["紧急联络人 2", contact(md.parent_2, md.parent_2_phone)],
    ["医疗备注", md.medical || ""],
    ["过敏", md.allergy || ""],
    ["其他备注", md.other_remark || ""],
    ...(md.extra_fields || []).map((f) => [f.label || "字段", fmtVal(f.field_value)] as [string, string]),
  ];
  return raw.filter(([, v]) => v).map(([label, value]) => ({ label, value }));
}

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
      <LogoQrBadge />
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
  const formId = new URLSearchParams(window.location.search).get("form_id") || undefined;
  const submit = () => { if (value.trim()) setQuery({ nric: value.trim(), form_id: formId }); };
  return (
    <section style={cardStyle}>
      <h1 style={titleStyle}>请输入 NRIC</h1>
      <p style={mutedStyle}>输入你报名时用的身份证 / 护照号码，查看你参加的活动。</p>
      <input
        style={inputStyle}
        placeholder="例如 010203040506"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        autoFocus
      />
      <button type="button" style={{ ...primaryStyle, ...(value.trim() ? {} : disabledStyle) }} disabled={!value.trim()} onClick={submit}>
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
  const [tab, setTab] = useState<"event" | "info" | "flow">("event");
  const [posterOk, setPosterOk] = useState(true);
  const [showGroupMembers, setShowGroupMembers] = useState(false);

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

  // 实时：本组积分变化时更新显示。
  useEffect(() => {
    const origin = API_BASE || (typeof window !== "undefined" ? window.location.origin : "");
    const socket: Socket = io(origin, { withCredentials: true, transports: ["websocket", "polling"] });
    const join = () => socket.emit("join_room", { room: `form_score_${formId}` });
    socket.on("connect", join);
    if (socket.connected) join();
    socket.on("group_score", (p: { form_id?: number; group_id?: number; score?: number }) => {
      if (p.form_id !== formId) return;
      setData((cur) => {
        if (!cur?.member_data || cur.member_data.group_id == null || cur.member_data.group_id !== p.group_id) return cur;
        return { ...cur, member_data: { ...cur.member_data, group_score: p.score ?? cur.member_data.group_score } };
      });
    });
    return () => { socket.off("group_score"); socket.off("connect", join); socket.disconnect(); };
  }, [formId]);

  // 付款提交后静默刷新详情（更新付款状态），不闪整页 loading。
  function reload() {
    apiFetch(`/api/form/member/detail?nric=${encodeURIComponent(nric)}&form_id=${formId}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => { /* ignore */ });
  }

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

  const memberFacts = data.member_data ? buildMemberFacts(data.member_data) : [];
  const posterUrl = posterOk && data.poster_url ? data.poster_url : null;
  const tabs: { key: "event" | "info" | "flow"; label: string }[] = [
    { key: "event", label: "活动" },
    { key: "info", label: "信息" },
    { key: "flow", label: "流程" },
  ];

  return (
    <div style={{ paddingBottom: 74 }}>
      <div style={portalHeadStyle}>
        <div style={memberLineStyle}>
          <span style={memberNameStyle}>{data.member_name || "成员"}</span>
          {data.member_data?.is_leader ? <span style={leaderBadgeStyle}>👑 组长</span> : null}
          {data.member_data?.group ? (
            <span style={groupChipStyle}>
              {data.member_data.group}
              {data.member_data.group_score != null ? ` · ${data.member_data.group_score} 分` : ""}
            </span>
          ) : null}
        </div>
        <h1 style={titleStyle}>{ev?.event_name || data.form_title || "活动"}</h1>
        {data.member_data?.is_leader ? (
          <button type="button" style={leaderBtnStyle} onClick={() => setShowGroupMembers(true)}>
            查看我的组员（{data.group_members?.length ?? 0}）
          </button>
        ) : null}
      </div>

      {showGroupMembers ? (
        <div style={gmOverlayStyle} onClick={() => setShowGroupMembers(false)}>
          <div style={gmSheetStyle} onClick={(e) => e.stopPropagation()}>
            <div style={gmHeadStyle}>
              <span style={{ fontWeight: 800, fontSize: 16 }}>我的组员（{data.group_members?.length ?? 0}）</span>
              <button type="button" style={ghostStyle} onClick={() => setShowGroupMembers(false)}>关闭</button>
            </div>
            {!data.group_members?.length ? <div style={hintStyle}>暂无组员。</div> : null}
            <div style={{ display: "grid", gap: 6 }}>
              {(data.group_members || []).map((m, i) => (
                <div key={i} style={gmRowStyle}>
                  <span style={{ fontWeight: 700 }}>{m.is_leader ? "👑 " : ""}{m.name || "—"}</span>
                  <span style={{ color: "#6b7280", fontSize: 13 }}>{m.age != null ? `${m.age}岁` : "—"} · {m.gender || "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "event" ? (
        <section style={cardStyle}>
          {posterUrl ? <img src={posterUrl} alt="活动海报" style={posterStyle} onError={() => setPosterOk(false)} /> : null}
          <div style={factGridStyle}>
            {ev?.datetime ? <Fact label="时间" value={`${fmtDateTime(ev.datetime)}${ev.end_datetime ? ` — ${fmtDateTime(ev.end_datetime)}` : ""}`} /> : null}
            {ev?.location ? <Fact label="地点" value={ev.location} /> : null}
            {ev?.target ? <Fact label="对象" value={ev.target} /> : null}
            {ev?.type ? <Fact label="类型" value={ev.type} /> : null}
          </div>
          {ev && (ev.place_id || ev.location) ? (
            <GoogleMapEmbed placeId={ev.place_id} lat={ev.lat} lng={ev.lng} query={ev.location} height={200} />
          ) : null}
          {ev?.purpose ? <div style={purposeStyle}>{ev.purpose}</div> : null}
          {!posterUrl && !ev?.datetime && !ev?.location && !ev?.purpose ? <div style={hintStyle}>暂无活动信息。</div> : null}
        </section>
      ) : null}

      {tab === "info" ? (
        <>
          <section style={cardStyle}>
            <h2 style={sectionTitleStyle}>我的报名资料</h2>
            {memberFacts.length ? (
              <div style={factGridStyle}>
                {memberFacts.map((f) => <Fact key={f.label} label={f.label} value={f.value} />)}
              </div>
            ) : <div style={hintStyle}>暂无报名资料。</div>}
          </section>
          {data.payment && data.payment.applicable ? (
            <PaymentSection payment={data.payment} nric={nric} formId={formId} onPaid={reload} />
          ) : null}
          {data.notes && data.notes.trim() ? (
            <section style={cardStyle}>
              <div style={notesTextStyle}>{data.notes}</div>
            </section>
          ) : null}
        </>
      ) : null}

      {tab === "flow" ? (
        <section style={cardStyle}>
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
      ) : null}

      <nav style={tabBarStyle}>
        <div style={tabBarInnerStyle}>
          {tabs.map((t) => (
            <button key={t.key} type="button" style={tab === t.key ? tabBtnActiveStyle : tabBtnStyle} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function PaymentSection({ payment, nric, formId, onPaid }: { payment: PaymentInfo; nric: string; formId: number; onPaid: () => void }) {
  const status = payment.status ?? null;
  const meta =
    status === "checked"
      ? { label: "已付款", color: "#15803d", bg: "#dcfce7" }
      : status === "process"
        ? { label: "处理中（待核对）", color: "#b45309", bg: "#fef3c7" }
        : status === "fail"
          ? { label: "付款失败，请重新提交", color: "#b91c1c", bg: "#fee2e2" }
          : { label: "未付款", color: "#b91c1c", bg: "#fee2e2" };
  const canPay = status == null || status === "fail";
  return (
    <section style={cardStyle}>
      <h2 style={sectionTitleStyle}>付款</h2>
      <div style={payStatusRowStyle}>
        <span style={{ ...payBadgeStyle, color: meta.color, background: meta.bg }}>{meta.label}</span>
        {payment.price != null ? <span style={{ fontWeight: 800 }}>RM {payment.price.toFixed(2)}</span> : null}
      </div>
      {canPay ? <TerminalPay nric={nric} formId={formId} onPaid={onPaid} /> : null}
    </section>
  );
}

function TerminalPay({ nric, formId, onPaid }: { nric: string; formId: number; onPaid: () => void }) {
  const [open, setOpen] = useState(false);
  const [fees, setFees] = useState<FormFee[] | null>(null);
  const [sel, setSel] = useState<FormFee | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function begin() {
    setOpen(true);
    setErr("");
    setLoading(true);
    try {
      const q = await fetchPaymentQuote(formId, nric);
      const list = q.fees || [];
      setFees(list);
      setSel(list[0] ?? null);
      if (!list.length) setErr("没有符合你年龄的收费项，请联系管理员。");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "读取收费项失败");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!sel) { setErr("请选择收费项"); return; }
    if (!proof) { setErr("请上传付款截图"); return; }
    setSubmitting(true);
    setErr("");
    try {
      const res = await createMemberPayment(formId, { nric, fee_id: sel.id, payment_mode: "QR" }, proof);
      if (res.status !== "success") throw new Error(res.message || "提交失败");
      setDone(true);
      onPaid();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) return <div style={paySuccessStyle}>✓ 付款资料已提交，等待管理员核对。</div>;
  if (!open) {
    return <button type="button" style={primaryStyle} onClick={() => void begin()}>去付款</button>;
  }

  const qr = sel ? resolveStaticUrl(sel.image_path) : "";
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {err ? <div style={errBoxStyle}>{err}</div> : null}
      {loading ? <div style={hintStyle}>加载中…</div> : null}
      {fees && fees.length > 1 ? (
        <div style={{ display: "grid", gap: 8 }}>
          {fees.map((f) => (
            <button key={f.id} type="button" style={{ ...feePickStyle, ...(sel?.id === f.id ? feePickOnStyle : {}) }} onClick={() => setSel(f)}>
              <span style={{ fontWeight: 700 }}>{f.category || "收费项"}</span>
              <span style={{ fontWeight: 800 }}>RM {Number(f.amount).toFixed(2)}</span>
            </button>
          ))}
        </div>
      ) : sel ? (
        <div style={payStatusRowStyle}>
          <span style={{ fontWeight: 700 }}>{sel.category || "收费项"}</span>
          <span style={{ fontWeight: 800 }}>RM {Number(sel.amount).toFixed(2)}</span>
        </div>
      ) : null}
      {sel && qr ? <img src={qr} alt="收款码" style={qrStyle} /> : null}
      {sel ? (
        <>
          <label style={factLabelStyle}>付款截图</label>
          <input
            type="file"
            accept="image/png,image/jpeg,.heic,.heif"
            style={fileInputStyle}
            disabled={submitting}
            onChange={(e) => setProof(e.target.files?.[0] ?? null)}
          />
          {proof ? <div style={{ fontSize: 12, color: "#15803d" }}>已选择：{proof.name}</div> : null}
          <button
            type="button"
            style={{ ...primaryStyle, ...(submitting || !proof ? disabledStyle : {}) }}
            disabled={submitting || !proof}
            onClick={() => void submit()}
          >
            {submitting ? "提交中…" : "提交付款截图"}
          </button>
        </>
      ) : null}
    </div>
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
const portalHeadStyle: CSSProperties = { padding: "2px 4px", display: "grid", gap: 4 };
const memberLineStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" };
const memberNameStyle: CSSProperties = { fontSize: 15, fontWeight: 800, color: "#4338ca" };
const groupChipStyle: CSSProperties = { padding: "2px 10px", borderRadius: 999, background: "#eef2ff", color: "#4338ca", fontSize: 12.5, fontWeight: 700, border: "1px solid #c7d2fe" };
const leaderBadgeStyle: CSSProperties = { padding: "2px 10px", borderRadius: 999, background: "#fef3c7", color: "#b45309", fontSize: 12.5, fontWeight: 800, border: "1px solid #fde68a" };
const leaderBtnStyle: CSSProperties = { marginTop: 8, padding: "8px 14px", borderRadius: 10, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const gmOverlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 100, background: "rgba(15,23,42,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center" };
const gmSheetStyle: CSSProperties = { width: "min(560px, 100%)", maxHeight: "80vh", overflowY: "auto", background: "#fff", borderRadius: "18px 18px 0 0", padding: 16, boxShadow: "0 -20px 50px rgba(15,23,42,0.25)" };
const gmHeadStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 };
const gmRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: 10, background: "#f8fafc", border: "1px solid #eef2f7" };
const eyebrowStyle: CSSProperties = { fontSize: 12, fontWeight: 700, color: "#6366f1", letterSpacing: "0.08em" };
const mutedStyle: CSSProperties = { fontSize: 13, color: "#6b7280", lineHeight: 1.5 };
const inputStyle: CSSProperties = { width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid #d1d5db", fontSize: 16, boxSizing: "border-box", letterSpacing: "0.04em" };
const primaryStyle: CSSProperties = { padding: "12px 16px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer" };
const disabledStyle: CSSProperties = { opacity: 0.5, cursor: "not-allowed" };
const ghostStyle: CSSProperties = { padding: "7px 12px", borderRadius: 999, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontWeight: 700, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" };
const smallBtnStyle: CSSProperties = { padding: "7px 12px", borderRadius: 8, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const hintStyle: CSSProperties = { padding: 18, textAlign: "center", color: "#6b7280" };
const notesTextStyle: CSSProperties = { whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 14, lineHeight: 1.7, color: "#334155" };
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
const payStatusRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const payBadgeStyle: CSSProperties = { padding: "4px 12px", borderRadius: 999, fontSize: 13, fontWeight: 800 };
const paySuccessStyle: CSSProperties = { padding: "12px 14px", borderRadius: 10, background: "#dcfce7", border: "1px solid #bbf7d0", color: "#15803d", fontSize: 13.5, fontWeight: 700, textAlign: "center" };
const feePickStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 14px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 14 };
const feePickOnStyle: CSSProperties = { border: "1px solid #6366f1", background: "#eef2ff" };
const qrStyle: CSSProperties = { width: "100%", maxWidth: 260, alignSelf: "center", justifySelf: "center", borderRadius: 12, border: "1px solid #e5e7eb", background: "#fff" };
const fileInputStyle: CSSProperties = { width: "100%", boxSizing: "border-box", fontSize: 14, padding: "10px 12px", borderRadius: 10, border: "1px dashed #cbd5e1", background: "#f8fafc" };
const flowRowStyle: CSSProperties = { display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", borderRadius: 10, border: "1px solid #eef2f7", background: "#fff" };
const timeBadgeStyle: CSSProperties = { flexShrink: 0, display: "grid", justifyItems: "center", minWidth: 54, padding: "6px 8px", borderRadius: 8, background: "#eef2ff", color: "#4338ca", lineHeight: 1.2 };
const posterStyle: CSSProperties = { width: "100%", borderRadius: 12, display: "block", marginBottom: 4, objectFit: "cover" };
const tabBarStyle: CSSProperties = { position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50, background: "rgba(255,255,255,0.97)", borderTop: "1px solid #e5e7eb", boxShadow: "0 -6px 24px rgba(30,41,59,0.08)", backdropFilter: "blur(8px)" };
const tabBarInnerStyle: CSSProperties = { width: "min(560px, 100%)", margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr 1fr" };
const tabBtnStyle: CSSProperties = { padding: "13px 8px", border: "none", borderTop: "3px solid transparent", background: "transparent", color: "#6b7280", fontWeight: 700, fontSize: 14, cursor: "pointer" };
const tabBtnActiveStyle: CSSProperties = { ...tabBtnStyle, color: "#6366f1", borderTop: "3px solid #6366f1", background: "rgba(99,102,241,0.06)" };
