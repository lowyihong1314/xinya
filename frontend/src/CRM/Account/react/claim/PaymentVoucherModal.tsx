import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { showPromptDialog } from "../../../../js/dialogs";
import { designTokens, useEnsureDesignTokens } from "../../../../theme/designTokens";
import { fetchPaymentVoucherShare } from "./api";
import type { PaymentVoucherSharePayload } from "./types";

export function PaymentVoucherModal({
  claimId,
  onClose,
}: {
  claimId: number;
  onClose: () => void;
}) {
  useEnsureDesignTokens();

  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<PaymentVoucherSharePayload | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void loadVoucher(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [claimId]);

  async function loadVoucher(isCancelled?: () => boolean) {
    setLoading(true);
    setError("");
    setCopied(false);
    try {
      const next = await fetchPaymentVoucherShare(claimId);
      if (isCancelled?.()) {
        return;
      }
      setPayload(next);
    } catch (err) {
      if (isCancelled?.()) {
        return;
      }
      setError(err instanceof Error ? err.message : "载入失败");
    } finally {
      if (!isCancelled?.()) {
        setLoading(false);
      }
    }
  }

  async function handleCopy() {
    if (!payload?.share_url) {
      return;
    }
    try {
      await navigator.clipboard?.writeText(payload.share_url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      await showPromptDialog({
        title: "分享链接",
        message: "请复制下面的链接",
        initialValue: payload.share_url,
        readOnly: true,
        confirmText: "关闭",
      });
    }
  }

  const claim = payload?.claim;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <div style={heroStyle}>
          <div>
            <div style={eyebrowStyle}>Payment Voucher</div>
            <div style={titleStyle}>付款凭证分享与签名</div>
            <div style={subtitleStyle}>先把基础内容确认好，再把公开链接发给对方填写全名和签名。</div>
          </div>
          <button type="button" style={ghostButtonStyle} onClick={onClose}>
            关闭
          </button>
        </div>

        {loading ? <div style={infoCardStyle}>正在读取 Payment Voucher…</div> : null}
        {error ? <div style={{ ...infoCardStyle, color: "var(--x-color-danger)" }}>{error}</div> : null}

        {!loading && !error && payload && claim ? (
          <div style={gridStyle}>
            <section style={panelStyle}>
              <div style={sectionTitleStyle}>基础内容</div>
              <div style={factGridStyle}>
                <Fact label="申请单号" value={`#${claim.id}`} />
                <Fact label="申请人" value={claim.applicant_name || "-"} />
                <Fact label="金额" value={`RM ${safeMoney(claim.amount)}`} />
                <Fact label="日期" value={claim.request_date || "-"} />
                <Fact label="部门" value={claim.department_name || "-"} />
                <Fact label="活动" value={claim.event_name || (claim.event_id ? `#${claim.event_id}` : "-")} />
                <Fact label="当前状态" value={payload.is_signed ? "已完成签名" : "等待对方签名"} />
                <Fact label="签名人全名" value={claim.voucher_recipient_name || "-"} />
              </div>
              <div style={purposeCardStyle}>
                <div style={miniTitleStyle}>用途说明</div>
                <div style={purposeTextStyle}>{claim.purpose || "-"}</div>
              </div>
              <div style={purposeCardStyle}>
                <div style={miniTitleStyle}>附件</div>
                <div style={{ display: "grid", gap: "6px" }}>
                  {(claim.attachments || []).length ? (
                    (claim.attachments || []).map((attachment, index) => (
                      <div key={`${attachment.file_path}-${index}`} style={attachmentRowStyle}>
                        {index + 1}. {attachment.file_name || attachment.file_path}
                      </div>
                    ))
                  ) : (
                    <div style={mutedTextStyle}>没有附件</div>
                  )}
                </div>
              </div>
            </section>

            <section style={panelStyle}>
              <div style={sectionTitleStyle}>分享操作</div>
              <div style={shareCardStyle}>
                <div style={miniTitleStyle}>公开签名链接</div>
                <div style={urlStyle}>{payload.share_url}</div>
                <div style={badgeRowStyle}>
                  <span style={statusPillStyle(payload.is_signed)}>{payload.is_signed ? "签名已完成" : "等待签名"}</span>
                  {copied ? <span style={copiedPillStyle}>已复制</span> : null}
                </div>
              </div>

              <div style={actionGridStyle}>
                <button type="button" style={primaryButtonStyle} onClick={handleCopy}>
                  复制链接
                </button>
                <button type="button" style={secondaryButtonStyle} onClick={() => window.open(payload.share_url, "_blank")}>
                  打开签名页
                </button>

                <button
                  type="button"
                  style={payload.is_signed ? primaryButtonStyle : disabledButtonStyle}
                  disabled={!payload.is_signed}
                  onClick={() =>
                    window.open(`/api/account/print_payment_voucher/download_payment_voucher/${claimId}`, "_blank")
                  }
                >
                  下载完整 Voucher
                </button>
              </div>

              <div style={hintCardStyle}>
                对方打开链接后，需要填写全名并完成签名。保存成功后，这里就能下载包含中文基础内容和签名的完整 Payment Voucher。
              </div>
            </section>
          </div>
        ) : null}
      </div>
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

function safeMoney(value?: number | string) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

const colors = designTokens.colors;
const radius = designTokens.radius;

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10030,
  background: "rgba(10, 18, 32, 0.58)",
  padding: "12px",
  display: "grid",
  placeItems: "center",
};

const modalStyle: CSSProperties = {
  width: "min(1120px, 100%)",
  maxHeight: "92vh",
  overflow: "auto",
  display: "grid",
  gap: "10px",
  padding: "12px",
  borderRadius: radius.sm,
  background: colors.panelStrong,
  border: `1px solid ${colors.lineSoft}`,
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.18)",
};

const heroStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
  alignItems: "start",
  flexWrap: "wrap",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: colors.accentStrong,
};

const titleStyle: CSSProperties = {
  fontSize: "20px",
  fontWeight: 800,
  color: colors.ink,
};

const subtitleStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "14px",
  color: colors.inkMuted,
  maxWidth: "720px",
};

const ghostButtonStyle: CSSProperties = {
  border: `1px solid ${colors.lineSoft}`,
  borderRadius: "6px",
  padding: "7px 10px",
  background: "rgba(255,255,255,0.82)",
  color: colors.ink,
  cursor: "pointer",
  fontWeight: 700,
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: "8px",
};

const panelStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  padding: "10px",
  borderRadius: "8px",
  background: colors.panel,
  border: `1px solid ${colors.lineSoft}`,
};

const infoCardStyle: CSSProperties = {
  padding: "10px",
  borderRadius: radius.sm,
  background: "rgba(255,255,255,0.86)",
  border: `1px solid ${colors.lineSoft}`,
  color: colors.ink,
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 800,
  color: colors.ink,
};

const factGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: "6px",
};

const factStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
  background: colors.panel,
  border: `1px solid ${colors.lineSoft}`,
  display: "grid",
  gap: "6px",
};

const factLabelStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  color: colors.inkMuted,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const factValueStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: colors.ink,
};

const purposeCardStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
  background: "rgba(247, 250, 252, 0.92)",
  border: `1px solid ${colors.lineSoft}`,
  display: "grid",
  gap: "8px",
};

const miniTitleStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  color: colors.ink,
};

const purposeTextStyle: CSSProperties = {
  whiteSpace: "pre-wrap",
  lineHeight: 1.6,
  color: colors.ink,
};

const mutedTextStyle: CSSProperties = {
  color: colors.inkMuted,
};

const attachmentRowStyle: CSSProperties = {
  fontSize: "13px",
  color: colors.ink,
  lineHeight: 1.5,
};

const shareCardStyle: CSSProperties = {
  padding: "10px",
  borderRadius: "6px",
  background: colors.accentTint,
  border: `1px solid ${colors.accentBorder}`,
  display: "grid",
  gap: "10px",
};

const urlStyle: CSSProperties = {
  wordBreak: "break-all",
  fontFamily: designTokens.fonts.mono,
  fontSize: "12px",
  color: colors.ink,
};

const badgeRowStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  flexWrap: "wrap",
};

function statusPillStyle(isSigned: boolean): CSSProperties {
  return {
    padding: "4px 7px",
    borderRadius: "999px",
    background: isSigned ? colors.successSoft : colors.warningSoft,
    color: isSigned ? colors.success : colors.warning,
    fontWeight: 800,
    fontSize: "12px",
  };
}

const copiedPillStyle: CSSProperties = {
  padding: "4px 7px",
  borderRadius: "999px",
  background: colors.infoSoft,
  color: colors.info,
  fontWeight: 800,
  fontSize: "12px",
};

const actionGridStyle: CSSProperties = {
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
  cursor: "pointer",
  fontWeight: 800,
};

const secondaryButtonStyle: CSSProperties = {
  border: `1px solid ${colors.lineSoft}`,
  borderRadius: "6px",
  padding: "7px 10px",
  background: "rgba(255,255,255,0.88)",
  color: colors.ink,
  cursor: "pointer",
  fontWeight: 800,
};

const disabledButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  opacity: 0.55,
  cursor: "not-allowed",
};

const hintCardStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
  background: "rgba(219,234,254,0.56)",
  border: `1px solid ${colors.infoTintStrong}`,
  color: colors.ink,
  lineHeight: 1.6,
};
