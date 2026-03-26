import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties } from "react";

import type { FormPayment } from "../../../form/react/types";
import { designTokens } from "../../../../theme/designTokens";
import { deleteRegisterPayment, replaceRegisterPaymentProof } from "./api";
import type { RegisterPaymentStatus } from "./types";

type PaymentDetailPanelProps = {
  payment: FormPayment | null;
  updatingStatus?: boolean;
  onStatusChange: (status: Exclude<RegisterPaymentStatus, "all">) => Promise<void> | void;
  onPaymentUpdated: (payment: FormPayment) => void;
  onPaymentRemoved: (paymentId: number) => void;
};

export function PaymentDetailPanel({
  payment,
  updatingStatus = false,
  onStatusChange,
  onPaymentUpdated,
  onPaymentRemoved,
}: PaymentDetailPanelProps) {
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [proofVersion, setProofVersion] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const proofBaseUrl = useMemo(() => {
    if (!payment) {
      return "";
    }
    if (typeof payment.proof_image_url === "string" && payment.proof_image_url) {
      return payment.proof_image_url;
    }
    return typeof payment.proof_image_path === "string" ? payment.proof_image_path : "";
  }, [payment]);

  const proofUrl = useMemo(() => {
    if (!proofBaseUrl) {
      return "";
    }
    const separator = proofBaseUrl.includes("?") ? "&" : "?";
    return `${proofBaseUrl}${separator}t=${proofVersion}`;
  }, [proofBaseUrl, proofVersion]);

  useEffect(() => {
    setActionError("");
    setProofVersion(0);
    setReplacing(false);
    setRemoving(false);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, [payment?.id, proofBaseUrl]);

  async function handleProofChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!payment || !file) {
      return;
    }

    setReplacing(true);
    setActionError("");
    try {
      const payload = await replaceRegisterPaymentProof(payment.id, file);
      if (!payload.payment) {
        throw new Error("付款截图更新失败");
      }
      onPaymentUpdated(payload.payment);
      setProofVersion(Date.now());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "付款截图更新失败");
    } finally {
      setReplacing(false);
      event.target.value = "";
    }
  }

  async function handleRemove() {
    if (!payment || removing) {
      return;
    }
    const shouldContinue = window.confirm(`确认移除付款记录 #${payment.id}？这个动作无法撤回。`);
    if (!shouldContinue) {
      return;
    }

    setRemoving(true);
    setActionError("");
    try {
      await deleteRegisterPayment(payment.id);
      setRemoving(false);
      onPaymentRemoved(payment.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "移除付款记录失败");
      setRemoving(false);
    }
  }

  if (!payment) {
    return <div style={emptyStyle}>先从左边选一笔 payment。</div>;
  }

  const statusMeta = getStatusMeta(payment.status);
  const busy = updatingStatus || replacing || removing;
  const canReplaceProof = payment.status === "process";
  const canRemove = payment.status === "fail";

  return (
    <div style={detailPanelStyle}>
      <div style={detailHeaderStyle}>
        <div>
          <div style={panelEyebrowStyle}>Payment Detail</div>
          <h4 style={detailTitleStyle}>{payment.name || payment.nric}</h4>
        </div>
        <div style={{ ...statusTagStyle, color: statusMeta.text, background: statusMeta.background }}>{statusMeta.label}</div>
      </div>

      {actionError ? <div style={errorStyle}>{actionError}</div> : null}

      <div style={detailMetaGridStyle}>
        <MetaItem label="Payment ID" value={payment.id} />
        <MetaItem label="NRIC" value={payment.nric} />
        <MetaItem label="电话" value={payment.phone} />
        <MetaItem label="金额" value={`RM ${Number(payment.price || 0).toFixed(2)}`} />
        <MetaItem label="方式" value={payment.payment_mode} />
        <MetaItem label="日期" value={payment.date} />
        <MetaItem label="时间" value={payment.time} />
        <MetaItem label="柜台" value={payment.counter || "-"} />
      </div>

      <div style={statusActionWrapStyle}>
        <div style={detailSectionTitleStyle}>切换状态</div>
        <div style={statusActionRowStyle}>
          {(["process", "checked", "fail"] as const).map((status) => {
            const active = payment.status === status;
            const meta = getStatusMeta(status);
            return (
              <button
                key={status}
                type="button"
                style={statusActionButtonStyle(active, meta.background, meta.text)}
                disabled={busy}
                onClick={() => void onStatusChange(status)}
              >
                {updatingStatus && active ? "更新中" : meta.label}
              </button>
            );
          })}
        </div>
      </div>

      {proofUrl ? (
        <div style={proofWrapStyle}>
          <div style={proofHeaderStyle}>
            <div style={detailSectionTitleStyle}>付款截图</div>
            <a href={proofUrl} target="_blank" rel="noreferrer" style={proofLinkStyle}>
              查看原图
            </a>
          </div>
          <img src={proofUrl} alt={`payment-proof-${payment.id}`} style={proofImageStyle} />
        </div>
      ) : (
        <div style={emptyStyle}>这个 payment 没有上传付款截图。</div>
      )}

      <div style={detailActionAreaStyle}>
        {canReplaceProof ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/heic,image/heif"
              style={{ display: "none" }}
              onChange={(event) => void handleProofChange(event)}
            />
            <button type="button" style={secondaryActionButtonStyle} disabled={busy} onClick={() => inputRef.current?.click()}>
              {replacing ? "替换中…" : proofBaseUrl ? "替换付款截图" : "上传付款截图"}
            </button>
          </>
        ) : null}

        {canRemove ? (
          <button type="button" style={dangerActionButtonStyle} disabled={busy} onClick={() => void handleRemove()}>
            {removing ? "移除中…" : "移除记录"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div style={metaItemStyle}>
      <div style={metaLabelStyle}>{label}</div>
      <div style={metaValueStyle}>{value == null || value === "" ? "-" : String(value)}</div>
    </div>
  );
}

function getStatusMeta(status: FormPayment["status"]) {
  if (status === "checked") {
    return { label: "已确认", text: colors.success, background: colors.successSoft };
  }
  if (status === "fail") {
    return { label: "失败", text: colors.danger, background: colors.dangerSoft };
  }
  return { label: "处理中", text: colors.warning, background: colors.warningSoft };
}

const colors = designTokens.colors;
const radius = designTokens.radius;

const detailPanelStyle: CSSProperties = {
  display: "grid",
  alignContent: "start",
  gap: "14px",
  padding: "16px",
  borderRadius: radius.md,
  background: colors.panelAlt,
  border: `1px solid ${colors.lineSoft}`,
};

const panelEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: colors.accent,
  fontWeight: 700,
};

const detailHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "start",
};

const detailTitleStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: "22px",
  color: colors.ink,
};

const statusTagStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "5px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 800,
};

const errorStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: radius.sm,
  background: colors.dangerSoft,
  color: colors.danger,
  fontWeight: 700,
};

const detailMetaGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
  gap: "10px",
};

const metaItemStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: radius.sm,
  background: colors.panel,
  border: `1px solid ${colors.lineSoft}`,
};

const metaLabelStyle: CSSProperties = {
  color: colors.inkMuted,
  fontSize: "11px",
  fontWeight: 700,
  marginBottom: "4px",
};

const metaValueStyle: CSSProperties = {
  color: colors.ink,
  fontSize: "13px",
  wordBreak: "break-word",
};

const statusActionWrapStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const detailSectionTitleStyle: CSSProperties = {
  color: colors.ink,
  fontSize: "14px",
  fontWeight: 800,
};

const statusActionRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
};

const statusActionButtonStyle = (active: boolean, background: string, color: string): CSSProperties => ({
  padding: "8px 12px",
  borderRadius: radius.sm,
  border: active ? `1px solid ${color}` : `1px solid ${colors.line}`,
  background: active ? background : colors.panel,
  color,
  cursor: "pointer",
  fontWeight: 800,
});

const proofWrapStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const proofHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
  flexWrap: "wrap",
};

const proofLinkStyle: CSSProperties = {
  width: "fit-content",
  color: colors.info,
  fontSize: "12px",
  fontWeight: 700,
  textDecoration: "none",
};

const proofImageStyle: CSSProperties = {
  width: "100%",
  maxHeight: "440px",
  objectFit: "contain",
  borderRadius: radius.md,
  border: `1px solid ${colors.line}`,
  background: colors.panel,
};

const detailActionAreaStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

const secondaryActionButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: radius.sm,
  border: `1px solid ${colors.line}`,
  background: colors.panel,
  color: colors.ink,
  cursor: "pointer",
  fontWeight: 800,
};

const dangerActionButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: radius.sm,
  border: `1px solid ${colors.danger}`,
  background: colors.dangerSoft,
  color: colors.danger,
  cursor: "pointer",
  fontWeight: 800,
};

const emptyStyle: CSSProperties = {
  padding: "14px",
  borderRadius: radius.sm,
  background: colors.panel,
  border: `1px solid ${colors.lineSoft}`,
  color: colors.inkMuted,
};
