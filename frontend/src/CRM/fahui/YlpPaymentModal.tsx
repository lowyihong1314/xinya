// 新增付款记录弹窗：原本写在 FahuiPage 里，抽出来给订单摘要抽屉一起用。
// 金额默认订单总额，有 account_edit 权限时多一颗「保存 + 批准」。
import { useState, type CSSProperties } from "react";

import { approvePayment, createYlpOrderPayment } from "./api";

const YLP_PAYMENT_MODES: { value: string; label: string }[] = [
  { value: "bank", label: "银行转账" },
  { value: "qr", label: "扫码" },
  { value: "cash", label: "现金" },
];

export function YlpPaymentModal({
  orderId,
  defaultAmount,
  canApprove,
  onClose,
  onSaved,
}: {
  orderId: number;
  defaultAmount: number;
  canApprove: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState("bank");
  const [file, setFile] = useState<File | null>(null);
  // 金额默认就是订单总额，需要补款/少收时可以改
  const [amount, setAmount] = useState(() => (defaultAmount ? String(defaultAmount) : ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(approve = false) {
    if (!amount.trim() || Number(amount) <= 0) {
      setError("请输入大于 0 的金额");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await createYlpOrderPayment(orderId, mode, file, amount.trim());
      if (res.success === false) {
        setError(res.message || "保存失败");
        return;
      }
      if (approve) {
        const paymentId = res.payment_id;
        if (!paymentId) {
          setError("已保存，但拿不到付款编号，请到列表手动审核");
          return;
        }
        const approved = await approvePayment(paymentId);
        if (approved.success === false || approved.status === "error") {
          setError(approved.message || "已保存，但批准失败");
          return;
        }
      }
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.overlay} onClick={saving ? undefined : onClose}>
      <div style={styles.content} onClick={(event) => event.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>新增付款记录</span>
          <button type="button" style={styles.close} onClick={onClose} disabled={saving}>
            关闭
          </button>
        </div>

        {error ? <div style={styles.error}>{error}</div> : null}

        <div style={styles.body}>
          <div>
            <span style={styles.label}>付款方式</span>
            <div style={styles.modeRow}>
              {YLP_PAYMENT_MODES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={saving}
                  style={{
                    ...styles.modeButton,
                    ...(mode === option.value ? styles.modeButtonActive : null),
                  }}
                  onClick={() => setMode(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span style={styles.label}>金额 (RM)</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              disabled={saving}
              style={styles.input}
              onChange={(event) => setAmount(event.target.value)}
            />
            <p style={styles.hint}>
              默认为订单总额 RM {Number(defaultAmount || 0).toFixed(2)}
              {Number(amount || 0) !== Number(defaultAmount || 0) ? "　（已改动）" : ""}
            </p>
          </div>

          <div>
            <span style={styles.label}>付款凭证（选填，图片）</span>
            <input
              type="file"
              accept="image/*,application/pdf"
              disabled={saving}
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            {file ? <p style={styles.hint}>已选择:{file.name}</p> : null}
          </div>
        </div>

        <div style={styles.footer}>
          <button
            type="button"
            style={{ ...styles.secondary, ...(saving ? styles.disabled : null) }}
            disabled={saving}
            onClick={() => void submit(false)}
          >
            {saving ? "保存中…" : "保存"}
          </button>
          {canApprove ? (
            <button
              type="button"
              style={{ ...styles.primary, ...(saving ? styles.disabled : null) }}
              disabled={saving}
              title="保存后立刻审核通过，订单直接变成已付款"
              onClick={() => void submit(true)}
            >
              {saving ? "处理中…" : "保存 + 批准"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 60,
    background: "rgba(15, 23, 42, 0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px",
  },
  content: {
    width: "min(420px, 100%)",
    maxHeight: "88vh",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px",
    borderRadius: "14px",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line)",
    boxShadow: "0 24px 60px var(--x-color-shadow)",
    fontFamily: "var(--x-font-sans)",
    color: "var(--x-color-ink)",
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" },
  title: { fontSize: "15px", fontWeight: 800 },
  close: {
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink-muted)",
    fontWeight: 700,
    fontSize: "12px",
    cursor: "pointer",
  },
  error: {
    padding: "8px 10px",
    borderRadius: "8px",
    background: "var(--x-color-danger-soft)",
    border: "1px solid var(--x-color-danger-border)",
    color: "var(--x-color-danger)",
    fontSize: "12.5px",
  },
  body: { display: "flex", flexDirection: "column", gap: "10px" },
  label: { display: "block", marginBottom: "4px", fontSize: "12px", fontWeight: 700, color: "var(--x-color-ink-muted)" },
  modeRow: { display: "flex", gap: "6px", flexWrap: "wrap" },
  modeButton: {
    padding: "6px 12px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "12.5px",
    fontWeight: 700,
    cursor: "pointer",
  },
  modeButtonActive: {
    border: "1px solid var(--x-color-accent-border)",
    background: "var(--x-color-accent-soft)",
    color: "var(--x-color-accent-strong)",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "13px",
  },
  hint: { margin: "4px 0 0", fontSize: "11.5px", color: "var(--x-color-ink-muted)" },
  footer: { display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" },
  primary: {
    padding: "8px 14px",
    borderRadius: "8px",
    border: "none",
    background: "var(--x-color-accent)",
    color: "#fff",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
  },
  secondary: {
    padding: "8px 14px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
  },
  disabled: { opacity: 0.6, cursor: "not-allowed" },
};
