import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import QRCode from "qrcode";

import { useUserState } from "../../../app/UserState";

const PUBLIC_URL = `${window.location.origin}/template/youth-class-registration`;

type Entry = {
  id: string;
  submitted_at: string;
  chinese_name: string;
  english_name?: string;
  gender?: string;
  birth_date?: string;
  age?: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  school?: string;
  education_level?: string;
  occupation?: string;
  guardian_name?: string;
  guardian_phone?: string;
  address?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  buddhist_experience?: string;
  learning_goals?: string;
  medical_notes?: string;
  attendance_preference?: string;
  available_time?: string;
  referral_source?: string;
  remarks?: string;
  agree_contact?: boolean;
};

export function YouthClassRegistrationPage() {
  const { isMobile } = useUserState();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    void QRCode.toDataURL(PUBLIC_URL, {
      width: isMobile ? 220 : 320,
      margin: 1,
      color: { dark: "#111827", light: "#ffffff" },
    }).then(setQrDataUrl);
  }, [isMobile]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/form/youth-class-registration/entries", { credentials: "include" });
        const data = await response.json();
        if (!response.ok || data.status !== "success") throw new Error(data.message || "加载失败");
        if (!cancelled) setEntries(Array.isArray(data.entries) ? data.entries : []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const latestSubmittedAt = useMemo(() => entries[0]?.submitted_at ?? "暂无", [entries]);

  return (
    <div style={pageStyle}>
      <section style={heroStyle(isMobile)}>
        <div style={panelStyle(isMobile)}>
          <div style={eyebrowStyle}>CRM / 报名管理</div>
          <h1 style={titleStyle(isMobile)}>青少年 & 青年佛学班</h1>
          <p style={descStyle}>这个后台现在只负责两件事：给大家扫码报名，以及查看已经提交的报名结果。</p>
          <div style={statsRowStyle(isMobile)}>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>报名总数</div>
              <div style={statValueStyle(isMobile)}>{entries.length}</div>
            </div>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>最近报名</div>
              <div style={statSmallStyle}>{latestSubmittedAt}</div>
            </div>
          </div>
        </div>

        <div style={panelStyle(isMobile)}>
          <div style={sectionTitleRowStyle(isMobile)}>
            <h2 style={sectionTitleStyle}>报名二维码</h2>
            <a href={PUBLIC_URL} target="_blank" rel="noreferrer" style={linkStyle}>
              打开公开报名页
            </a>
          </div>
          <div style={qrWrapStyle(isMobile)}>
            {qrDataUrl ? <img src={qrDataUrl} alt="报名二维码" style={qrImageStyle(isMobile)} /> : <div style={emptyStyle}>生成二维码中…</div>}
          </div>
          <div style={urlBoxStyle}>{PUBLIC_URL}</div>
        </div>
      </section>

      <section style={panelStyle(isMobile)}>
        <div style={sectionTitleRowStyle(isMobile)}>
          <h2 style={sectionTitleStyle}>报名结果</h2>
          <button type="button" style={refreshButtonStyle} onClick={() => window.location.reload()}>
            刷新
          </button>
        </div>

        {loading ? <div style={emptyStyle}>加载中…</div> : null}
        {error ? <div style={errorStyle}>{error}</div> : null}
        {!loading && !error && !entries.length ? <div style={emptyStyle}>还没有人提交报名。</div> : null}

        {!loading && !error && entries.length ?
          isMobile ? (
            <div style={mobileListStyle}>
              {entries.map((entry) => (
                <article key={entry.id} style={mobileCardStyle}>
                  <div style={mobileCardHeaderStyle}>
                    <div>
                      <div style={mobileNameStyle}>{entry.chinese_name || "-"}</div>
                      {entry.english_name ? <div style={mutedStyle}>{entry.english_name}</div> : null}
                    </div>
                    <div style={mobileTimeStyle}>{entry.submitted_at || "-"}</div>
                  </div>

                  <div style={mobileFieldGridStyle}>
                    <InfoItem label="电话" value={entry.phone || "-"} />
                    <InfoItem label="WhatsApp" value={entry.whatsapp || "-"} />
                    <InfoItem label="学校 / 职业" value={entry.school || entry.occupation || "-"} />
                    <InfoItem label="出席方式" value={entry.attendance_preference || "-"} />
                  </div>

                  <InfoItem label="学习目标" value={entry.learning_goals || "-"} block />
                </article>
              ))}
            </div>
          ) : (
            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>提交时间</th>
                    <th style={thStyle}>姓名</th>
                    <th style={thStyle}>电话</th>
                    <th style={thStyle}>学校/职业</th>
                    <th style={thStyle}>出席方式</th>
                    <th style={thStyle}>学习目标</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td style={tdStyle}>{entry.submitted_at || "-"}</td>
                      <td style={tdStyle}>
                        <div>{entry.chinese_name || "-"}</div>
                        {entry.english_name ? <div style={mutedStyle}>{entry.english_name}</div> : null}
                      </td>
                      <td style={tdStyle}>
                        <div>{entry.phone || "-"}</div>
                        {entry.whatsapp ? <div style={mutedStyle}>WA: {entry.whatsapp}</div> : null}
                      </td>
                      <td style={tdStyle}>
                        <div>{entry.school || entry.occupation || "-"}</div>
                        {entry.education_level ? <div style={mutedStyle}>{entry.education_level}</div> : null}
                      </td>
                      <td style={tdStyle}>{entry.attendance_preference || "-"}</td>
                      <td style={tdStyle}>{entry.learning_goals || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        : null}
      </section>
    </div>
  );
}

function InfoItem({ label, value, block = false }: { label: string; value: string; block?: boolean }) {
  return (
    <div style={block ? mobileInfoBlockStyle : mobileInfoStyle}>
      <div style={mobileInfoLabelStyle}>{label}</div>
      <div style={mobileInfoValueStyle}>{value}</div>
    </div>
  );
}

const pageStyle: CSSProperties = { display: "grid", gap: "20px" };
const eyebrowStyle: CSSProperties = { fontSize: "12px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" };
const descStyle: CSSProperties = { margin: 0, lineHeight: 1.7, color: "var(--x-color-ink-muted)" };
const statCardStyle: CSSProperties = { padding: "16px", borderRadius: "18px", background: "var(--x-color-panel-strong)", border: "1px solid var(--x-color-line-soft)" };
const statLabelStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", marginBottom: "8px" };
const statSmallStyle: CSSProperties = { fontSize: "14px", lineHeight: 1.6 };
const sectionTitleStyle: CSSProperties = { margin: 0, fontSize: "22px" };
const linkStyle: CSSProperties = { color: "var(--x-color-accent-strong)", textDecoration: "none", fontWeight: 600 };
const urlBoxStyle: CSSProperties = { padding: "12px 14px", borderRadius: "14px", background: "var(--x-color-panel-strong)", border: "1px solid var(--x-color-line-soft)", wordBreak: "break-all", fontSize: "13px" };
const refreshButtonStyle: CSSProperties = { padding: "10px 16px", borderRadius: "999px", border: "1px solid var(--x-color-line-soft)", cursor: "pointer", background: "var(--x-color-panel-strong)", fontWeight: 600 };
const tableWrapStyle: CSSProperties = { overflowX: "auto" };
const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", minWidth: "920px" };
const thStyle: CSSProperties = { textAlign: "left", padding: "12px", fontSize: "12px", color: "var(--x-color-ink-muted)", borderBottom: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)" };
const tdStyle: CSSProperties = { padding: "12px", verticalAlign: "top", borderBottom: "1px solid var(--x-color-line-soft)", fontSize: "14px", lineHeight: 1.6 };
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
const emptyStyle: CSSProperties = { padding: "20px", borderRadius: "16px", border: "1px dashed var(--x-color-line-soft)", textAlign: "center", color: "var(--x-color-ink-muted)" };
const errorStyle: CSSProperties = { padding: "14px 16px", borderRadius: "14px", background: "#fff1f2", border: "1px solid #fecdd3", color: "#b42318" };
const mobileListStyle: CSSProperties = { display: "grid", gap: "12px" };
const mobileCardStyle: CSSProperties = { padding: "14px", borderRadius: "18px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", display: "grid", gap: "12px" };
const mobileCardHeaderStyle: CSSProperties = { display: "grid", gap: "6px" };
const mobileNameStyle: CSSProperties = { fontSize: "16px", fontWeight: 700, lineHeight: 1.4 };
const mobileTimeStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
const mobileFieldGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" };
const mobileInfoStyle: CSSProperties = { display: "grid", gap: "4px", padding: "10px", borderRadius: "12px", background: "rgba(255,255,255,0.75)" };
const mobileInfoBlockStyle: CSSProperties = { ...mobileInfoStyle };
const mobileInfoLabelStyle: CSSProperties = { fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--x-color-ink-muted)" };
const mobileInfoValueStyle: CSSProperties = { fontSize: "14px", lineHeight: 1.55, wordBreak: "break-word" };

function heroStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.2fr) minmax(320px, 0.8fr)",
    gap: "18px",
    alignItems: "start",
  };
}

function panelStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "16px" : "22px",
    borderRadius: isMobile ? "18px" : "22px",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 18px 36px var(--x-color-shadow-soft)",
    display: "grid",
    gap: "16px",
  };
}

function titleStyle(isMobile: boolean): CSSProperties {
  return {
    margin: "6px 0 10px",
    fontSize: isMobile ? "24px" : "30px",
    lineHeight: 1.15,
  };
}

function statsRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: "12px",
    marginTop: "8px",
  };
}

function statValueStyle(isMobile: boolean): CSSProperties {
  return {
    fontSize: isMobile ? "28px" : "32px",
    fontWeight: 800,
  };
}

function sectionTitleRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: isMobile ? "flex-start" : "center",
    gap: "12px",
    flexWrap: "wrap",
    flexDirection: isMobile ? "column" : "row",
  };
}

function qrWrapStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    placeItems: "center",
    minHeight: isMobile ? "220px" : "260px",
    borderRadius: "18px",
    background: "white",
    border: "1px solid var(--x-color-line-soft)",
    padding: isMobile ? "12px" : "16px",
  };
}

function qrImageStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    maxWidth: isMobile ? "220px" : "280px",
    height: "auto",
  };
}
