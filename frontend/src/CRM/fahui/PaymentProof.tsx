import { useState, type CSSProperties } from "react";

import { API_BASE } from "../../js/apiBase";

// 付款凭证查看：只要这笔付款有上传档（不分付款方式）就能点开看。
// 走带权限的 /api/payment/payments/<id>/document —— 凭证上常有账户与姓名，不能走公开路径。
export function paymentProofUrl(paymentId: number) {
  const path = `/api/payment/payments/${paymentId}/document`;
  return API_BASE ? `${API_BASE}${path}` : path;
}

function isPdf(document?: string | null) {
  return /\.pdf$/i.test(String(document || ""));
}

export type PaymentProofTarget = {
  id: number;
  document?: string | null;
  payment_mode?: string | null;
  total_price?: number | string | null;
};

/** 有凭证才渲染的小按钮；点开后在浮层里看图 / PDF。 */
export function PaymentProofButton({
  payment,
  label = "凭证",
  style,
}: {
  payment: PaymentProofTarget;
  label?: string;
  style?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  if (!payment.document) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        style={{ ...styles.trigger, ...style }}
        title={`查看付款 #${payment.id} 的凭证`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <i className={isPdf(payment.document) ? "fa-regular fa-file-pdf" : "fa-regular fa-image"} aria-hidden="true" />
        {label ? <span style={{ marginLeft: 4 }}>{label}</span> : null}
      </button>

      {open ? (
        <div style={styles.overlay} onClick={() => setOpen(false)}>
          <div style={styles.panel} onClick={(event) => event.stopPropagation()}>
            <header style={styles.head}>
              <span style={styles.title}>
                付款 #{payment.id}
                {payment.total_price != null ? `　RM ${Number(payment.total_price).toFixed(2)}` : ""}
                {payment.payment_mode ? `　${payment.payment_mode}` : ""}
              </span>
              <span style={styles.actions}>
                <a href={paymentProofUrl(payment.id)} target="_blank" rel="noreferrer" style={styles.linkButton}>
                  新窗口
                </a>
                <button type="button" style={styles.closeButton} onClick={() => setOpen(false)}>
                  关闭
                </button>
              </span>
            </header>
            {isPdf(payment.document) ? (
              <iframe title={`付款 ${payment.id} 凭证`} src={paymentProofUrl(payment.id)} style={styles.frame} />
            ) : (
              <img src={paymentProofUrl(payment.id)} alt="付款凭证" style={styles.image} />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

const styles: Record<string, CSSProperties> = {
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 9px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-accent-strong)",
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 70,
    background: "rgba(15, 23, 42, 0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
  },
  panel: {
    width: "min(720px, 100%)",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "12px",
    borderRadius: "14px",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line)",
    boxShadow: "0 24px 60px var(--x-color-shadow)",
    overflow: "hidden",
    fontFamily: "var(--x-font-sans)",
    color: "var(--x-color-ink)",
  },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" },
  title: { fontSize: "13px", fontWeight: 800 },
  actions: { display: "flex", gap: "6px", alignItems: "center" },
  linkButton: {
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-accent-border)",
    background: "var(--x-color-accent-soft)",
    color: "var(--x-color-accent-strong)",
    fontSize: "12px",
    fontWeight: 700,
    textDecoration: "none",
  },
  closeButton: {
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink-muted)",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  image: { maxWidth: "100%", maxHeight: "78vh", objectFit: "contain", alignSelf: "center" },
  frame: { width: "100%", height: "78vh", border: "none", borderRadius: "8px" },
};
