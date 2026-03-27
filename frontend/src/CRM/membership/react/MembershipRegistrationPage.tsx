import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { useUserState } from "../../../app/UserState";
import { apiFetch } from "../../../js/apiFetch";
import { ensureDesignTokens } from "../../../theme/designTokens";
import {
  FeePanel,
  type FeeDraft,
  normalizeFeeDrafts,
  summarizeFee,
} from "../../form/react/FeePanel";

const APPLICATION_URL = `${window.location.origin}/template/membership-application`;

type PaymentRecord = {
  id: number;
  amount?: number;
  status?: "process" | "checked" | "fail" | string;
  counter?: string | null;
  created_at?: string | null;
  date?: string | null;
  time?: string | null;
  proof_image_url?: string | null;
};

type FeeOptionRecord = {
  id?: number | null;
  category?: string | null;
  age_range_from?: number | string | null;
  age_range_to?: number | string | null;
  amount?: number | string | null;
  description?: string | null;
  image_path?: string | null;
  label?: string | null;
};

type Entry = {
  id: number;
  submitted_at?: string | null;
  registration_type?: "upgrade" | "renew" | string;
  user_id?: number | null;
  user_name?: string | null;
  username?: string | null;
  nric_asset_id?: number | null;
  regis_member_id?: number | null;
  nric?: string | null;
  status?: "process" | "paid" | "reject" | string;
  target_expiry_date?: string | null;
  facebook_profile_url?: string | null;
  nric_address?: string | null;
  ancestral_home?: string | null;
  occupation?: string | null;
  refuge_taken?: boolean | null;
  refuge_year?: number | null;
  refuge_master?: string | null;
  dharma_name?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  recommender_name?: string | null;
  membership_role?: string | null;
  selected_fee?: FeeOptionRecord | null;
  payment_url?: string | null;
  latest_payment?: PaymentRecord | null;
  payments?: PaymentRecord[];
};

type Settings = {
  id?: number | null;
  description?: string | null;
  image_path?: string | null;
  fees?: FeeDraft[];
  fee_options?: FeeDraft[];
};

type Notice = {
  tone: "success" | "error";
  text: string;
};

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    error?: string;
    status?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "请求失败");
  }
  return payload;
}

async function fetchEntries() {
  const response = await apiFetch("/api/user_control/membership/entries", {
    credentials: "include",
  });
  return parseJson<{ entries?: Entry[] }>(response);
}

async function fetchSettings() {
  const response = await apiFetch("/api/user_control/membership/settings", {
    credentials: "include",
  });
  return parseJson<{ settings?: Settings }>(response);
}

async function saveSettings(payload: Settings) {
  const response = await apiFetch("/api/user_control/membership/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<{ message?: string; settings?: Settings }>(response);
}

async function updatePaymentStatus(paymentId: number, status: string) {
  const response = await apiFetch(`/api/user_control/membership/payment/${paymentId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ status }),
  });
  return parseJson<{ message?: string }>(response);
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function formatAmount(amount: number | string | undefined | null) {
  return `RM ${Number(amount || 0).toFixed(2)}`;
}

function paymentStatusLabel(status: string | undefined) {
  if (status === "checked") return "已确认";
  if (status === "fail") return "已拒绝";
  return "审核中";
}

function registrationStatusLabel(status: string | undefined) {
  if (status === "paid") return "已生效";
  if (status === "reject") return "已退回";
  return "处理中";
}

function registrationTypeLabel(type: string | undefined) {
  return type === "renew" ? "会员续费" : "升级会员";
}

function boolLabel(value: boolean | null | undefined) {
  if (value == null) return "未填写";
  return value ? "是" : "否";
}

export function MembershipRegistrationPage() {
  ensureDesignTokens();

  const { isMobile } = useUserState();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [settings, setSettings] = useState<Settings>({ fees: [] });
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [updatingPaymentId, setUpdatingPaymentId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [entryPayload, settingsPayload] = await Promise.all([fetchEntries(), fetchSettings()]);
      setEntries(Array.isArray(entryPayload.entries) ? entryPayload.entries : []);
      const nextSettings = settingsPayload.settings || {};
      setSettings({
        id: nextSettings.id ?? null,
        fees: normalizeFeeDrafts(nextSettings.fees || nextSettings.fee_options),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const stats = useMemo(() => {
    const upgrades = entries.filter((entry) => entry.registration_type !== "renew").length;
    const renewals = entries.filter((entry) => entry.registration_type === "renew").length;
    const approved = entries.filter((entry) => entry.status === "paid").length;
    const processing = entries.filter((entry) => entry.status === "process").length;
    return { upgrades, renewals, approved, processing };
  }, [entries]);

  async function handleCopyLink(url: string | null | undefined) {
    if (!url) {
      setNotice({ tone: "error", text: "这位成员还没有付款链接。" });
      return;
    }

    try {
      await copyText(url);
      setNotice({ tone: "success", text: "付款链接已复制，可以重新发给对方。" });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "复制失败" });
    }
  }

  async function handleSaveSettings() {
    setSavingSettings(true);
    setNotice(null);
    try {
      const result = await saveSettings(settings);
      const nextSettings = result.settings || settings;
      setSettings({
        id: nextSettings.id ?? null,
        fees: normalizeFeeDrafts(nextSettings.fees || nextSettings.fee_options),
      });
      setNotice({ tone: "success", text: result.message || "会员费率已更新" });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handlePaymentStatus(paymentId: number, status: string) {
    setUpdatingPaymentId(paymentId);
    setNotice(null);
    try {
      const result = await updatePaymentStatus(paymentId, status);
      setNotice({ tone: "success", text: result.message || "会员付款状态已更新" });
      await loadData();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "更新失败" });
    } finally {
      setUpdatingPaymentId(null);
    }
  }

  function createLocalFeeId() {
    return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function handleAddFee(payload: FeeDraft) {
    setSettings((prev) => ({
      ...prev,
      fees: [...(prev.fees || []), { ...payload, id: createLocalFeeId() }],
    }));
  }

  function handleEditFee(feeId: number | string, payload: FeeDraft) {
    setSettings((prev) => ({
      ...prev,
      fees: (prev.fees || []).map((fee) => (String(fee.id) === String(feeId) ? { ...payload, id: fee.id ?? feeId } : fee)),
    }));
  }

  function handleDeleteFee(feeId: number | string) {
    setSettings((prev) => ({
      ...prev,
      fees: (prev.fees || []).filter((fee) => String(fee.id) !== String(feeId)),
    }));
  }

  return (
    <div style={pageStyle}>
      <section style={heroStyle(isMobile)}>
        <div style={panelStyle(isMobile)}>
          <div style={eyebrowStyle}>CRM / 会员</div>
          <h1 style={titleStyle(isMobile)}>会员升级与续费</h1>
          <p style={descStyle}>这里可以设置按年龄分段的会员费率、上传付款二维码、查看申请资料，并在付款截图提交后完成审核生效。</p>
          <div style={statsRowStyle(isMobile)}>
            <MetricCard label="升级申请" value={String(stats.upgrades)} />
            <MetricCard label="续费申请" value={String(stats.renewals)} />
            <MetricCard label="已生效" value={String(stats.approved)} />
            <MetricCard label="处理中" value={String(stats.processing)} />
          </div>
        </div>

        <div style={panelStyle(isMobile)}>
          <div style={sectionTitleRowStyle(isMobile)}>
            <h2 style={sectionTitleStyle()}>用户入口</h2>
            <a href={APPLICATION_URL} target="_blank" rel="noreferrer" style={linkStyle}>打开会员申请页</a>
          </div>
          <div style={emptyPreviewStyle}>会员申请入口来自 Profile 的 Actions 按钮；这里保留直达链接方便后台测试。</div>
          <div style={urlBoxStyle}>{APPLICATION_URL}</div>
        </div>
      </section>

      <section style={panelStyle(isMobile)}>
        <div style={sectionTitleRowStyle(isMobile)}>
          <h2 style={sectionTitleStyle()}>会员年龄费率</h2>
          <button type="button" style={refreshButtonStyle} onClick={() => void loadData()}>刷新</button>
        </div>
        {notice ? <div style={notice.tone === "success" ? successStyle : errorStyle}>{notice.text}</div> : null}
        {error ? <div style={errorStyle}>{error}</div> : null}
        <FeePanel
          fees={(settings.fees || []).map((fee, index) => ({ ...fee, id: fee.id ?? `membership-fee-${index}` }))}
          onAdd={handleAddFee}
          onEdit={handleEditFee}
          onDelete={handleDeleteFee}
          addButtonLabel="添加费率"
          saveButtonLabel="保存费率"
          emptyText="还没有费率。可以先加一条所有年龄的通用费用，或直接拆成不同年龄段。"
          showCategory={false}
          enableImageUpload
          imageLabel="该费率付款二维码 / 付款资料"
          descriptionPlaceholder="例如：见习青芽年费 / 普通会员年费"
        />
        <div style={settingsFooterStyle}>
            <div style={amountHintStyle}>
            {settings.fees?.length
              ? `已配置 ${settings.fees.length} 条费率`
              : "尚未配置年龄费率"}
            </div>
          <button type="button" style={primaryButtonStyle} onClick={() => void handleSaveSettings()} disabled={savingSettings}>
            {savingSettings ? "保存中…" : "保存会员费率"}
          </button>
        </div>
      </section>

      <section style={panelStyle(isMobile)}>
        <div style={sectionTitleRowStyle(isMobile)}>
          <h2 style={sectionTitleStyle()}>会员申请工作台</h2>
          <div style={mutedStyle}>审核通过后会自动把用户标记为会员，并写入新的续费到期日。</div>
        </div>
        {loading ? <div style={emptyStyle}>加载中…</div> : null}
        {!loading && !entries.length ? <div style={emptyStyle}>还没有会员申请或续费记录。</div> : null}
        {!loading && entries.length ? (
          <div style={entryListStyle}>
            {entries.map((entry) => (
              <article key={entry.id} style={entryCardStyle}>
                <div style={entryHeaderStyle(isMobile)}>
                  <div style={entryTitleWrapStyle}>
                    <div style={entryNameStyle}>{entry.user_name || entry.username || `用户 #${entry.user_id}`}</div>
                    <div style={entrySubStyle}>
                      {registrationTypeLabel(entry.registration_type)} · {entry.submitted_at || "-"}
                    </div>
                  </div>
                  <div style={headerActionWrapStyle(isMobile)}>
                    <span style={statusChipStyle(entry.status === "paid" ? "success" : entry.status === "reject" ? "danger" : "info")}>
                      {registrationStatusLabel(entry.status)}
                    </span>
                    <button type="button" style={secondaryButtonStyle} onClick={() => entry.payment_url && window.open(entry.payment_url, "_blank", "noopener,noreferrer")}>
                      打开付款页
                    </button>
                    <button type="button" style={secondaryButtonStyle} onClick={() => void handleCopyLink(entry.payment_url)}>
                      复制付款链接
                    </button>
                  </div>
                </div>

                <div style={entryInfoGridStyle(isMobile)}>
                  <Fact label="NRIC" value={entry.nric || "-"} />
                  <Fact label="加入身份" value={entry.membership_role || "-"} />
                  <Fact label="下一次到期日" value={entry.target_expiry_date || "-"} />
                  <Fact label="适用费用" value={entry.selected_fee ? summarizeFee(entry.selected_fee) : "未匹配费率"} />
                </div>

                <div style={entryInfoGridStyle(isMobile)}>
                  <Fact label="推荐人" value={entry.recommender_name || "未填写"} />
                  <Fact label="籍贯 / 职业" value={`${entry.ancestral_home || "-"} / ${entry.occupation || "-"}`} />
                  <Fact label="是否皈依" value={boolLabel(entry.refuge_taken)} />
                  <Fact label="紧急联络人" value={`${entry.emergency_contact_name || "-"} / ${entry.emergency_contact_phone || "-"}`} />
                  <Fact label="监护人" value={entry.guardian_name ? `${entry.guardian_name} / ${entry.guardian_phone || "-"}` : "不需要 / 未填写"} />
                </div>

                <div style={detailGridStyle(isMobile)}>
                  <div style={addressStyle}>
                    <strong>Facebook：</strong>
                    {entry.facebook_profile_url ? (
                      <a href={entry.facebook_profile_url} target="_blank" rel="noreferrer" style={proofLinkStyle}>{entry.facebook_profile_url}</a>
                    ) : (
                      "未填写"
                    )}
                  </div>
                  <div style={addressStyle}>
                    <strong>NRIC_address：</strong>
                    {entry.nric_address || "-"}
                  </div>
                </div>

                {(entry.refuge_taken || entry.refuge_year || entry.refuge_master || entry.dharma_name) ? (
                  <div style={detailGridStyle(isMobile)}>
                    <Fact label="皈依年份" value={entry.refuge_year ? String(entry.refuge_year) : "未填写"} />
                    <Fact label="皈依证明法师" value={entry.refuge_master || "未填写"} />
                    <Fact label="法名" value={entry.dharma_name || "未填写"} />
                  </div>
                ) : null}

                {(entry.payments || []).length ? (
                  <div style={paymentListStyle}>
                    {(entry.payments || []).map((payment, index) => {
                      const isUpdating = updatingPaymentId === payment.id;
                      const proofUrl = payment.proof_image_url || "";
                      return (
                        <div key={payment.id} style={paymentRowStyle(isMobile, index === 0)}>
                          <div style={paymentMetaGridStyle(isMobile)}>
                            <Fact label="付款单号" value={`#${payment.id}`} />
                            <Fact label="金额" value={formatAmount(payment.amount)} />
                            <Fact label="状态" value={paymentStatusLabel(payment.status)} />
                            <Fact label="提交时间" value={payment.created_at || `${payment.date || "-"} ${payment.time || ""}`.trim()} />
                          </div>
                          <div style={paymentActionBarStyle(isMobile)}>
                            {proofUrl ? (
                              <a href={proofUrl} target="_blank" rel="noreferrer" style={proofLinkStyle}>
                                查看付款截图
                              </a>
                            ) : (
                              <span style={mutedStyle}>没有截图</span>
                            )}
                            <div style={paymentButtonGroupStyle()}>
                              <button type="button" style={miniButtonStyle} disabled={isUpdating} onClick={() => void handlePaymentStatus(payment.id, "process")}>
                                标记处理中
                              </button>
                              <button type="button" style={miniSuccessButtonStyle} disabled={isUpdating} onClick={() => void handlePaymentStatus(payment.id, "checked")}>
                                审核通过并生效
                              </button>
                              <button type="button" style={miniDangerButtonStyle} disabled={isUpdating} onClick={() => void handlePaymentStatus(payment.id, "fail")}>
                                退回付款
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={emptyInlineStyle}>这条记录还没有提交付款截图，可以直接复制上方链接重新发给对方。</div>
                )}
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={metricCardStyle}>
      <div style={metricLabelStyle}>{label}</div>
      <div style={metricValueStyle}>{value}</div>
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

const pageStyle: CSSProperties = { display: "grid", gap: "20px" };
const eyebrowStyle: CSSProperties = { fontSize: "12px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" };
const descStyle: CSSProperties = { margin: 0, lineHeight: 1.7, color: "var(--x-color-ink-muted)" };
const linkStyle: CSSProperties = { color: "var(--x-color-accent-strong)", textDecoration: "none", fontWeight: 700 };
const urlBoxStyle: CSSProperties = { padding: "12px 14px", borderRadius: "14px", background: "var(--x-color-panel-strong)", border: "1px solid var(--x-color-line-soft)", wordBreak: "break-all", fontSize: "13px" };
const refreshButtonStyle: CSSProperties = { padding: "10px 16px", borderRadius: "999px", border: "1px solid var(--x-color-line-soft)", cursor: "pointer", background: "var(--x-color-panel-strong)", fontWeight: 700 };
const errorStyle: CSSProperties = { padding: "14px 16px", borderRadius: "14px", background: "#fff1f2", border: "1px solid #fecdd3", color: "#b42318" };
const successStyle: CSSProperties = { padding: "14px 16px", borderRadius: "14px", background: "#ecfdf3", border: "1px solid #abefc6", color: "#027a48" };
const emptyStyle: CSSProperties = { padding: "20px", borderRadius: "16px", border: "1px dashed var(--x-color-line-soft)", textAlign: "center", color: "var(--x-color-ink-muted)" };
const inputStyle: CSSProperties = { width: "100%", minHeight: "46px", padding: "12px 14px", borderRadius: "14px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", boxSizing: "border-box" };
const fieldStyle: CSSProperties = { display: "grid", gap: "8px" };
const fieldLabelStyle: CSSProperties = { fontSize: "13px", fontWeight: 700, color: "var(--x-color-ink-muted)" };
const primaryButtonStyle: CSSProperties = { padding: "12px 18px", borderRadius: "999px", border: "none", background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))", color: "white", fontWeight: 800, cursor: "pointer" };
const secondaryButtonStyle: CSSProperties = { padding: "10px 14px", borderRadius: "999px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", color: "var(--x-color-ink)", fontWeight: 700, cursor: "pointer", textDecoration: "none" };
const miniButtonStyle: CSSProperties = { padding: "9px 12px", borderRadius: "999px", border: "1px solid var(--x-color-line-soft)", background: "white", color: "var(--x-color-ink)", fontWeight: 700, cursor: "pointer" };
const miniSuccessButtonStyle: CSSProperties = { ...miniButtonStyle, border: "1px solid rgba(2,122,72,0.22)", background: "#ecfdf3", color: "#027a48" };
const miniDangerButtonStyle: CSSProperties = { ...miniButtonStyle, border: "1px solid rgba(180,35,24,0.22)", background: "#fff1f2", color: "#b42318" };
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
const feeImagePreviewStyle: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: "100%", maxWidth: "280px", minHeight: "180px", borderRadius: "18px", border: "1px solid var(--x-color-line-soft)", background: "white", overflow: "hidden" };
const feeImageStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
const emptyPreviewStyle: CSSProperties = { minHeight: "180px", width: "100%", display: "grid", placeItems: "center", borderRadius: "18px", border: "1px dashed var(--x-color-line-soft)", color: "var(--x-color-ink-muted)", padding: "18px", textAlign: "center", lineHeight: 1.6 };
const amountHintStyle: CSSProperties = { fontSize: "15px", fontWeight: 700, color: "var(--x-color-accent-strong)" };
const settingsFooterStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "14px", flexWrap: "wrap" };
const paymentListStyle: CSSProperties = { display: "grid", gap: "12px" };
const entryListStyle: CSSProperties = { display: "grid", gap: "16px" };
const factStyle: CSSProperties = { padding: "12px 14px", borderRadius: "14px", background: "var(--x-color-panel-strong)", border: "1px solid var(--x-color-line-soft)", display: "grid", gap: "4px" };
const factLabelStyle: CSSProperties = { fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" };
const factValueStyle: CSSProperties = { fontSize: "14px", lineHeight: 1.55, wordBreak: "break-word", fontWeight: 700 };
const entryCardStyle: CSSProperties = { padding: "18px", borderRadius: "22px", border: "1px solid var(--x-color-line-soft)", background: "linear-gradient(180deg, var(--x-color-panel), var(--x-color-panel-strong))", display: "grid", gap: "14px", boxShadow: "0 18px 36px var(--x-color-shadow-soft)" };
const entryTitleWrapStyle: CSSProperties = { display: "grid", gap: "6px" };
const entryNameStyle: CSSProperties = { fontSize: "18px", fontWeight: 800, lineHeight: 1.35 };
const entrySubStyle: CSSProperties = { fontSize: "13px", color: "var(--x-color-ink-muted)" };
const addressStyle: CSSProperties = { padding: "14px 16px", borderRadius: "16px", background: "rgba(255,255,255,0.78)", border: "1px solid var(--x-color-line-soft)", lineHeight: 1.7, wordBreak: "break-word" };
const proofLinkStyle: CSSProperties = { color: "var(--x-color-accent-strong)", textDecoration: "none", fontWeight: 700, wordBreak: "break-all" };
const emptyInlineStyle: CSSProperties = { padding: "14px 16px", borderRadius: "16px", border: "1px dashed var(--x-color-line-soft)", color: "var(--x-color-ink-muted)" };
const metricCardStyle: CSSProperties = { padding: "16px", borderRadius: "18px", background: "var(--x-color-panel-strong)", border: "1px solid var(--x-color-line-soft)" };
const metricLabelStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", marginBottom: "8px" };
const metricValueStyle: CSSProperties = { fontSize: "30px", fontWeight: 900 };

function heroStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.15fr) minmax(320px, 0.85fr)",
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
  return { margin: "6px 0 10px", fontSize: isMobile ? "24px" : "30px", lineHeight: 1.15 };
}

function statsRowStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: "12px", marginTop: "8px" };
}

function sectionTitleRowStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", gap: "12px", flexWrap: "wrap", flexDirection: isMobile ? "column" : "row" };
}

function sectionTitleStyle(): CSSProperties {
  return { margin: 0, fontSize: "22px" };
}

function settingsGridStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: "14px" };
}

function settingsImageRowStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 280px", gap: "16px", alignItems: "start" };
}

function imageUploadStyle(): CSSProperties {
  return { display: "grid", gap: "8px" };
}

function entryHeaderStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", gap: "14px", flexWrap: "wrap", flexDirection: isMobile ? "column" : "row" };
}

function headerActionWrapStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: isMobile ? "flex-start" : "flex-end" };
}

function entryInfoGridStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: "10px" };
}

function detailGridStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: "10px" };
}

function paymentRowStyle(isMobile: boolean, latest: boolean): CSSProperties {
  return {
    padding: "14px",
    borderRadius: "18px",
    border: latest ? "1px solid rgba(15,118,110,0.22)" : "1px solid var(--x-color-line-soft)",
    background: latest ? "rgba(240,253,250,0.72)" : "rgba(255,255,255,0.82)",
    display: "grid",
    gap: "12px",
  };
}

function paymentMetaGridStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: "10px" };
}

function paymentActionBarStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", gap: "12px", flexWrap: "wrap", flexDirection: isMobile ? "column" : "row" };
}

function paymentButtonGroupStyle(): CSSProperties {
  return { display: "flex", gap: "8px", flexWrap: "wrap" };
}

function statusChipStyle(tone: "success" | "danger" | "info"): CSSProperties {
  const palette =
    tone === "success"
      ? { background: "#ecfdf3", color: "#027a48" }
      : tone === "danger"
        ? { background: "#fff1f2", color: "#b42318" }
        : { background: "#eff6ff", color: "#1d4ed8" };
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 12px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 800,
    ...palette,
  };
}
