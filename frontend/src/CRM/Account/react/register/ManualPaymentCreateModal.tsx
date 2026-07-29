import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { showEventPicker, type EventPickerRecord } from "../../../shared/showEventPicker";
import { createManualFinancePayment } from "./api";
import { MANUAL_INCOME_TYPES } from "./types";

// 收款审核「新建收款」弹窗：手动录入一笔收款（暂时只有捐赠收入），
// 可选关联活动（event_id，与报销一致），提交后进入收款审核流程（状态=处理中）。
export type ManualPaymentCreateModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (message?: string) => void;
};

const PAYMENT_MODES = ["现金", "QR", "银行转账", "支票", "其他"];

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function ManualPaymentCreateModal({ open, onClose, onCreated }: ManualPaymentCreateModalProps) {
  const [incomeType, setIncomeType] = useState(MANUAL_INCOME_TYPES[0].key);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState(PAYMENT_MODES[0]);
  const [date, setDate] = useState(today());
  const [selectedEvent, setSelectedEvent] = useState<EventPickerRecord | null>(null);
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setIncomeType(MANUAL_INCOME_TYPES[0].key);
    setName("");
    setPhone("");
    setAmount("");
    setPaymentMode(PAYMENT_MODES[0]);
    setDate(today());
    setSelectedEvent(null);
    setRemark("");
    setError(null);
  }

  async function handlePickEvent() {
    const event = await showEventPicker();
    if (event) setSelectedEvent(event);
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setError("请填写付款人姓名");
      return;
    }
    const amountNum = Number(amount);
    if (!(amountNum > 0)) {
      setError("金额必须大于 0");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await createManualFinancePayment({
        income_type: incomeType,
        name: name.trim(),
        phone: phone.trim() || undefined,
        amount: amountNum,
        payment_mode: paymentMode || undefined,
        date: date || undefined,
        event_id: selectedEvent?.id ?? null,
        remark: remark.trim() || undefined,
      });
      reset();
      onCreated(result.message || "收款已新建");
    } catch (err) {
      setError(err instanceof Error ? err.message : "新建收款失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <div style={{ fontWeight: 800, fontSize: "16px", color: "var(--x-color-ink)" }}>新建收款</div>
          <button type="button" style={closeBtnStyle} onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={hintStyle}>手动录入一笔收款，提交后进入「处理中」，确认后再切换为「已确认」。</div>

        <div style={gridStyle}>
          <Field label="类型">
            <select style={inputStyle} value={incomeType} onChange={(e) => setIncomeType(e.target.value)}>
              {MANUAL_INCOME_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="日期">
            <input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>

        <div style={gridStyle}>
          <Field label="付款人姓名 *">
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="必填" />
          </Field>
          <Field label="电话">
            <input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="选填" />
          </Field>
        </div>

        <div style={gridStyle}>
          <Field label="金额 RM *">
            <input
              style={{ ...inputStyle, textAlign: "right" }}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
            />
          </Field>
          <Field label="付款方式">
            <select style={inputStyle} value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
              {PAYMENT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="关联活动">
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={ghostBtnStyle} onClick={() => void handlePickEvent()}>
              选择活动
            </button>
            <span style={{ fontSize: "13px", color: "var(--x-color-ink)" }}>
              {selectedEvent ? `${selectedEvent.event_name || "未命名活动"} #${selectedEvent.id}` : "未关联活动"}
            </span>
            {selectedEvent ? (
              <button type="button" style={ghostBtnStyle} onClick={() => setSelectedEvent(null)}>
                清除
              </button>
            ) : null}
          </div>
        </Field>

        <Field label="备注">
          <textarea
            style={{ ...inputStyle, minHeight: "64px", resize: "vertical" }}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="选填"
          />
        </Field>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <div style={footerStyle}>
          <button type="button" style={ghostBtnStyle} onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" style={primaryBtnStyle} onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? "提交中…" : "新建收款"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: "4px" }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "16px",
  zIndex: 1000,
};

const modalStyle: CSSProperties = {
  width: "min(560px, 100%)",
  maxHeight: "90vh",
  overflowY: "auto",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  borderRadius: "14px",
  boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
  padding: "16px 18px 18px",
  display: "grid",
  gap: "14px",
};

const modalHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center" };

const closeBtnStyle: CSSProperties = {
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  borderRadius: "8px",
  width: "30px",
  height: "30px",
  cursor: "pointer",
  fontSize: "14px",
};

const hintStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
  borderRadius: "8px",
  padding: "8px 10px",
};

const gridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px" };
const labelStyle: CSSProperties = { fontSize: "12px", fontWeight: 700, color: "var(--x-color-ink-muted)" };
const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "34px",
  padding: "7px 10px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontSize: "13px",
  boxSizing: "border-box",
};

const footerStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "8px" };

const primaryBtnStyle: CSSProperties = {
  padding: "8px 16px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-accent-strong)",
  background: "var(--x-color-accent)",
  color: "white",
  fontWeight: 700,
  fontSize: "13px",
  cursor: "pointer",
};

const ghostBtnStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 600,
  fontSize: "13px",
  cursor: "pointer",
};

const errorStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-danger)",
  background: "var(--x-color-danger-soft)",
  border: "1px solid var(--x-color-danger-border)",
  borderRadius: "8px",
  padding: "8px 10px",
  fontWeight: 600,
};
