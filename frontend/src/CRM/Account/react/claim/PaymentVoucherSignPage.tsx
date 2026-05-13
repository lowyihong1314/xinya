import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useParams } from "react-router-dom";

import { renderSignPreviewSvg, render_sign_modal } from "../../../../../../static/js/sign_tools.js";
import { fetchPublicPaymentVoucher, submitPublicPaymentVoucherSign } from "./api";
import type { ClaimRecord, PaymentVoucherPublicPayload } from "./types";
import { designTokens, useEnsureDesignTokens } from "../../../../theme/designTokens";

type SignShape = { strokes?: Array<{ points?: Array<{ x: number; y: number; t?: number }> }> } | null;

export function PaymentVoucherSignPage() {
  useEnsureDesignTokens();

  const { token = "" } = useParams();
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [payload, setPayload] = useState<PaymentVoucherPublicPayload | null>(null);
  const [fullName, setFullName] = useState("");
  const [signData, setSignData] = useState<SignShape>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      setSuccess("");
      try {
        const next = await fetchPublicPaymentVoucher(token);
        if (cancelled) {
          return;
        }
        setPayload(next);
        setFullName(next.claim.voucher_recipient_name || "");
        setSignData(parseSignData(next.claim.voucher_recipient_sign_json));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "载入失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!previewRef.current) {
      return;
    }
    renderSignPreviewSvg(previewRef.current, signData || { strokes: [] });
  }, [signData]);

  async function handleSign() {
    const next = await render_sign_modal(signData || { strokes: [] });
    if (next) {
      setSignData(next);
    }
  }

  async function handleSubmit() {
    if (!fullName.trim()) {
      setError("请填写全名");
      return;
    }
    if (!signData?.strokes?.length) {
      setError("请先签名");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await submitPublicPaymentVoucherSign(token, {
        full_name: fullName.trim(),
        sign_json_data: signData,
      });
      const next = await fetchPublicPaymentVoucher(token);
      setPayload(next);
      setSignData(parseSignData(next.claim.voucher_recipient_sign_json) || signData);
      setFullName(next.claim.voucher_recipient_name || fullName.trim());
      setSuccess("签名已确认，完整 Payment Voucher 已可下载。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  const claim = payload?.claim;
  const downloadUrl = token ? `/api/account/print_payment_voucher/public/${token}/download` : "";

  return (
    <div style={pageShellStyle}>
      <div style={pageBackdropStyle} />
      <main style={pageContentStyle}>
        <section style={heroPanelStyle}>
          <div style={heroEyebrowStyle}>Payment Voucher</div>
          <h1 style={heroTitleStyle}>付款凭证签名确认</h1>
          <p style={heroCopyStyle}>请核对基础内容，填写全名并完成签名。确认后即可生成完整的 Payment Voucher。</p>
        </section>

        {loading ? <section style={panelStyle}>正在读取 Payment Voucher…</section> : null}
        {error ? <section style={{ ...panelStyle, color: "var(--x-color-danger)" }}>{error}</section> : null}
        {success ? <section style={{ ...panelStyle, color: "var(--x-color-success)" }}>{success}</section> : null}

        {!loading && !error && claim ? (
          <div style={layoutStyle}>
            <section style={panelStyle}>
              <div style={sectionTitleStyle}>基础内容</div>
              <div style={factGridStyle}>
                <Fact label="申请单号" value={`#${claim.id}`} />
                <Fact label="申请人" value={claim.applicant_name || "-"} />
                <Fact label="金额" value={`RM ${safeMoney(claim.amount)}`} />
                <Fact label="日期" value={claim.request_date || "-"} />
                <Fact label="部门" value={claim.department_name || "-"} />
                <Fact label="活动" value={claim.event_name || (claim.event_id ? `#${claim.event_id}` : "-")} />
              </div>

              <div style={copyCardStyle}>
                <div style={miniTitleStyle}>用途说明</div>
                <div style={bodyTextStyle}>{claim.purpose || "-"}</div>
              </div>

              <div style={copyCardStyle}>
                <div style={miniTitleStyle}>附件</div>
                {(claim.attachments || []).length ? (
                  <div style={{ display: "grid", gap: "6px" }}>
                    {(claim.attachments || []).map((attachment, index) => (
                      <div key={`${attachment.file_path}-${index}`} style={bodyTextStyle}>
                        {index + 1}. {attachment.file_name || attachment.file_path}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={mutedTextStyle}>没有附件</div>
                )}
              </div>
            </section>

            <section style={panelStyle}>
              <div style={sectionTitleStyle}>签名确认</div>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>全名</span>
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="请输入签署人全名"
                  style={inputStyle}
                />
              </label>

              <div style={fieldStyle}>
                <span style={fieldLabelStyle}>签名</span>
                <div ref={previewRef} />
                <button type="button" style={secondaryButtonStyle} onClick={() => void handleSign()}>
                  {signData?.strokes?.length ? "重新签名" : "点击签名"}
                </button>
              </div>

              <div style={noteStyle}>
                签名完成后，系统会把这份签名和你的全名写入 Payment Voucher，供内部下载完整 PDF。
              </div>

              <div style={actionRowStyle}>
                <button type="button" style={primaryButtonStyle} disabled={submitting} onClick={() => void handleSubmit()}>
                  {submitting ? "提交中…" : "确认签名"}
                </button>
                <button
                  type="button"
                  style={payload?.is_signed ? secondaryButtonStyle : disabledButtonStyle}
                  disabled={!payload?.is_signed}
                  onClick={() => window.open(downloadUrl, "_blank")}
                >
                  下载完整 Voucher
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={factCardStyle}>
      <div style={factLabelStyle}>{label}</div>
      <div style={factValueStyle}>{value}</div>
    </div>
  );
}

function parseSignData(value: unknown): SignShape {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as SignShape;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") {
    return value as SignShape;
  }
  return null;
}

function safeMoney(value?: number | string) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

const colors = designTokens.colors;
const radius = designTokens.radius;

const pageShellStyle: CSSProperties = {
  minHeight: "100vh",
  position: "relative",
  overflow: "hidden",
  background: "#edf4f7",
};

const pageBackdropStyle: CSSProperties = {
  position: "absolute",
  inset: "-10%",
  background: "transparent",
  pointerEvents: "none",
};

const pageContentStyle: CSSProperties = {
  position: "relative",
  maxWidth: "1160px",
  margin: "0 auto",
  padding: "12px",
  display: "grid",
  gap: "10px",
};

const heroPanelStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: radius.sm,
  background: colors.panel,
  border: `1px solid ${colors.lineSoft}`,
  boxShadow: "none",
};

const heroEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: colors.accentStrong,
};

const heroTitleStyle: CSSProperties = {
  margin: "4px 0 3px",
  fontSize: "22px",
  lineHeight: 1.05,
  color: colors.ink,
};

const heroCopyStyle: CSSProperties = {
  margin: 0,
  fontSize: "15px",
  lineHeight: 1.7,
  color: colors.inkMuted,
  maxWidth: "760px",
};

const layoutStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: "8px",
};

const panelStyle: CSSProperties = {
  padding: "10px",
  borderRadius: "8px",
  background: colors.panel,
  border: `1px solid ${colors.lineSoft}`,
  boxShadow: "none",
  display: "grid",
  gap: "8px",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 800,
  color: colors.ink,
};

const factGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: "6px",
};

const factCardStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
  background: colors.panel,
  border: `1px solid ${colors.lineSoft}`,
  display: "grid",
  gap: "4px",
};

const factLabelStyle: CSSProperties = {
  fontSize: "11px",
  color: colors.inkMuted,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const factValueStyle: CSSProperties = {
  fontSize: "14px",
  color: colors.ink,
  fontWeight: 700,
};

const copyCardStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
  background: "rgba(247,250,252,0.95)",
  border: `1px solid ${colors.lineSoft}`,
  display: "grid",
  gap: "8px",
};

const miniTitleStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  color: colors.ink,
};

const bodyTextStyle: CSSProperties = {
  whiteSpace: "pre-wrap",
  lineHeight: 1.65,
  color: colors.ink,
};

const mutedTextStyle: CSSProperties = {
  color: colors.inkMuted,
};

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  color: colors.ink,
};

const inputStyle: CSSProperties = {
  borderRadius: "6px",
  border: `1px solid ${colors.line}`,
  padding: "6px 8px",
  fontSize: "13px",
  color: colors.ink,
  background: "rgba(255,255,255,0.94)",
};

const noteStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
  background: "rgba(254,243,199,0.72)",
  border: `1px solid ${colors.warningBorder}`,
  lineHeight: 1.6,
  color: colors.ink,
};

const actionRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "6px",
};

const primaryButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "6px",
  padding: "7px 10px",
  background: "#0f766e",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  border: `1px solid ${colors.line}`,
  borderRadius: "6px",
  padding: "7px 10px",
  background: "rgba(255,255,255,0.92)",
  color: colors.ink,
  fontWeight: 800,
  cursor: "pointer",
};

const disabledButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  opacity: 0.55,
  cursor: "not-allowed",
};
