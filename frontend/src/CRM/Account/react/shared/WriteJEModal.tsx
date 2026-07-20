import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { createGLEntryFromSource, fetchGLAccounts, fetchGLEntryBySource } from "../gl/api";
import type { GLAccount, GLJournalEntry } from "../gl/types";

export type WriteJEModalProps = {
  open: boolean;
  onClose: () => void;
  /** logical source, e.g. "reimbursement" | "register_payment" */
  source: string;
  sourceRefType: string;
  sourceId: number;
  /** template hint: income => Dr cash / Cr income; expense => Dr expense / Cr cash */
  direction: "income" | "expense";
  defaultAmount?: number | null;
  defaultDate?: string | null;
  defaultMemo?: string;
  canEdit: boolean;
  onCreated?: (entry: GLJournalEntry) => void;
};

function normalizeDate(value?: string | null) {
  if (value) {
    const iso = String(value).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  }
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function money(value?: number | null) {
  return Number(value ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function WriteJEModal({
  open,
  onClose,
  source,
  sourceRefType,
  sourceId,
  direction,
  defaultAmount,
  defaultDate,
  defaultMemo,
  canEdit,
  onCreated,
}: WriteJEModalProps) {
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [existing, setExisting] = useState<GLJournalEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [entryDate, setEntryDate] = useState(normalizeDate(defaultDate));
  const [memo, setMemo] = useState(defaultMemo || "");
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : "");
  const [debitId, setDebitId] = useState("");
  const [creditId, setCreditId] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntryDate(normalizeDate(defaultDate));
    setMemo(defaultMemo || "");
    setAmount(defaultAmount ? String(defaultAmount) : "");
    void (async () => {
      try {
        const [accountList, existingEntry] = await Promise.all([
          fetchGLAccounts(),
          fetchGLEntryBySource(sourceRefType, sourceId).catch(() => null),
        ]);
        if (cancelled) return;
        setAccounts(accountList);
        setExisting(existingEntry);
        // default account selection
        const active = accountList.filter((a) => a.status === "active");
        const cash = active.find((a) => a.is_cash) || null;
        const income = active.find((a) => a.account_type === "income") || null;
        const expense = active.find((a) => a.account_type === "expense") || null;
        if (direction === "income") {
          setDebitId(cash ? String(cash.id) : "");
          setCreditId(income ? String(income.id) : "");
        } else {
          setDebitId(expense ? String(expense.id) : "");
          setCreditId(cash ? String(cash.id) : "");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "载入科目失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sourceRefType, sourceId, direction, defaultAmount, defaultDate, defaultMemo]);

  const activeAccounts = useMemo(() => accounts.filter((a) => a.status === "active"), [accounts]);

  if (!open) return null;

  async function handleCreate() {
    const amountNum = Number(amount);
    if (!(amountNum > 0)) {
      setError("金额必须大于 0");
      return;
    }
    if (!debitId || !creditId) {
      setError("请选择借方和贷方科目");
      return;
    }
    if (debitId === creditId) {
      setError("借方和贷方科目不能相同");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const entry = await createGLEntryFromSource({
        source,
        source_ref_type: sourceRefType,
        source_ref_id: sourceId,
        entry_date: entryDate,
        memo: memo || undefined,
        lines: [
          { account_id: Number(debitId), debit: amountNum, credit: 0 },
          { account_id: Number(creditId), debit: 0, credit: amountNum },
        ],
      });
      setExisting(entry);
      onCreated?.(entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建凭证失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <div style={{ fontWeight: 800, fontSize: "16px", color: "var(--x-color-ink)" }}>写会计凭证 JE</div>
          <button type="button" style={closeBtnStyle} onClick={onClose}>
            ✕
          </button>
        </div>

        {loading ? (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--x-color-ink-muted)" }}>载入中…</div>
        ) : existing ? (
          <div style={{ display: "grid", gap: "12px" }}>
            <div style={existingBannerStyle}>
              该单据已生成凭证 <strong>{existing.entry_no}</strong>（{existing.status === "posted" ? "已过账" : existing.status}）
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>科目</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>借方</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>贷方</th>
                  </tr>
                </thead>
                <tbody>
                  {(existing.lines || []).map((line) => (
                    <tr key={line.id}>
                      <td style={tdStyle}>
                        {line.account_code} {line.account_name}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{line.debit ? money(line.debit) : "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{line.credit ? money(line.credit) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: "12px", color: "var(--x-color-ink-muted)" }}>
              如需修改，请到「财务 / 总账 / 会计凭证」作废后重录。
            </div>
            <div style={footerStyle}>
              <button type="button" style={primaryBtnStyle} onClick={onClose}>
                关闭
              </button>
            </div>
          </div>
        ) : !canEdit ? (
          <div style={{ padding: "20px", textAlign: "center", color: "var(--x-color-ink-muted)" }}>
            你没有 account_edit 权限，无法创建凭证。
          </div>
        ) : (
          <div style={{ display: "grid", gap: "12px" }}>
            <div style={hintStyle}>
              {direction === "income"
                ? "收入：借「现金 / 银行」，贷「收入科目」。"
                : "支出：借「费用科目」，贷「现金 / 银行」。"}
            </div>

            <div style={gridStyle}>
              <Field label="凭证日期">
                <input type="date" style={inputStyle} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </Field>
              <Field label="金额 RM">
                <input
                  style={{ ...inputStyle, textAlign: "right" }}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                />
              </Field>
            </div>

            <Field label="摘要 Memo">
              <input style={inputStyle} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="选填" />
            </Field>

            <div style={gridStyle}>
              <Field label="借方科目 Debit">
                <select style={inputStyle} value={debitId} onChange={(e) => setDebitId(e.target.value)}>
                  <option value="">选择科目</option>
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="贷方科目 Credit">
                <select style={inputStyle} value={creditId} onChange={(e) => setCreditId(e.target.value)}>
                  <option value="">选择科目</option>
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {error ? <div style={errorStyle}>{error}</div> : null}

            <div style={footerStyle}>
              <button type="button" style={ghostBtnStyle} onClick={onClose} disabled={saving}>
                取消
              </button>
              <button type="button" style={primaryBtnStyle} onClick={() => void handleCreate()} disabled={saving}>
                {saving ? "创建中…" : "创建并过账"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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

const existingBannerStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-success)",
  background: "var(--x-color-success-soft)",
  border: "1px solid var(--x-color-success-strong)",
  borderRadius: "8px",
  padding: "10px 12px",
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

const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "13px" };
const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid var(--x-color-line)",
  color: "var(--x-color-ink-muted)",
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};
const tdStyle: CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--x-color-line-soft)", color: "var(--x-color-ink)" };
