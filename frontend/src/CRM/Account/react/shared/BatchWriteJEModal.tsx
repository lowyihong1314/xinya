import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { createGLEntryFromSource, fetchGLAccounts, fetchGLSourceMap } from "../gl/api";
import type { GLAccount } from "../gl/types";

export type BatchJEDoc = {
  id: number;
  amount: number;
  date?: string | null;
  memo?: string;
};

export type BatchWriteJEModalProps = {
  open: boolean;
  onClose: () => void;
  source: string;
  sourceRefType: string;
  /** income => Dr cash / Cr income; expense => Dr expense / Cr cash */
  direction: "income" | "expense";
  docs: BatchJEDoc[];
  canEdit: boolean;
  onDone?: () => void;
};

type Phase = "form" | "running" | "done";
type RunResult = { created: number; skipped: number; failed: number; errors: string[] };

function normalizeDate(value?: string | null) {
  if (value) {
    const iso = String(value).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  }
  return "";
}

export function BatchWriteJEModal({ open, onClose, source, sourceRefType, direction, docs, canEdit, onDone }: BatchWriteJEModalProps) {
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [existingIds, setExistingIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [debitId, setDebitId] = useState("");
  const [creditId, setCreditId] = useState("");
  const [overrideDate, setOverrideDate] = useState("");

  const [phase, setPhase] = useState<Phase>("form");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPhase("form");
    setResult(null);
    setProgress(0);
    setOverrideDate("");
    void (async () => {
      try {
        const [accountList, map] = await Promise.all([
          fetchGLAccounts(),
          fetchGLSourceMap(sourceRefType, docs.map((d) => d.id)).catch(() => ({})),
        ]);
        if (cancelled) return;
        setAccounts(accountList);
        setExistingIds(new Set(Object.keys(map).map((k) => Number(k))));
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
  }, [open, sourceRefType, direction, docs]);

  const activeAccounts = useMemo(() => accounts.filter((a) => a.status === "active"), [accounts]);

  const buckets = useMemo(() => {
    const already: BatchJEDoc[] = [];
    const invalid: BatchJEDoc[] = [];
    const eligible: BatchJEDoc[] = [];
    for (const doc of docs) {
      if (existingIds.has(doc.id)) already.push(doc);
      else if (!(Number(doc.amount) > 0)) invalid.push(doc);
      else eligible.push(doc);
    }
    return { already, invalid, eligible };
  }, [docs, existingIds]);

  if (!open) return null;

  async function handleRun() {
    if (!debitId || !creditId) {
      setError("请选择借方和贷方科目");
      return;
    }
    if (debitId === creditId) {
      setError("借方和贷方科目不能相同");
      return;
    }
    if (!buckets.eligible.length) {
      setError("没有可写凭证的单据");
      return;
    }
    setError(null);
    setPhase("running");
    setProgress(0);
    const tally: RunResult = { created: 0, skipped: buckets.already.length + buckets.invalid.length, failed: 0, errors: [] };
    for (const doc of buckets.eligible) {
      try {
        await createGLEntryFromSource({
          source,
          source_ref_type: sourceRefType,
          source_ref_id: doc.id,
          entry_date: overrideDate || normalizeDate(doc.date) || undefined,
          memo: doc.memo,
          lines: [
            { account_id: Number(debitId), debit: Number(doc.amount), credit: 0 },
            { account_id: Number(creditId), debit: 0, credit: Number(doc.amount) },
          ],
        });
        tally.created += 1;
      } catch (err) {
        tally.failed += 1;
        tally.errors.push(`#${doc.id}: ${err instanceof Error ? err.message : "失败"}`);
      }
      setProgress((p) => p + 1);
    }
    setResult(tally);
    setPhase("done");
    onDone?.();
  }

  return (
    <div style={backdropStyle} onClick={phase === "running" ? undefined : onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerRowStyle}>
          <div style={{ fontWeight: 800, fontSize: "16px", color: "var(--x-color-ink)" }}>批量写会计凭证 JE</div>
          {phase !== "running" ? (
            <button type="button" style={closeBtnStyle} onClick={onClose}>
              ✕
            </button>
          ) : null}
        </div>

        {loading ? (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--x-color-ink-muted)" }}>载入中…</div>
        ) : !canEdit ? (
          <div style={{ padding: "20px", textAlign: "center", color: "var(--x-color-ink-muted)" }}>你没有 account_edit 权限,无法创建凭证。</div>
        ) : phase === "done" && result ? (
          <div style={{ display: "grid", gap: "12px" }}>
            <div style={result.failed ? warnBannerStyle : okBannerStyle}>
              完成:成功 {result.created} 笔 · 跳过 {result.skipped} 笔 · 失败 {result.failed} 笔
            </div>
            {result.errors.length ? (
              <div style={{ display: "grid", gap: "4px", maxHeight: "160px", overflowY: "auto" }}>
                {result.errors.map((msg, i) => (
                  <div key={i} style={errLineStyle}>
                    {msg}
                  </div>
                ))}
              </div>
            ) : null}
            <div style={footerStyle}>
              <button type="button" style={primaryBtnStyle} onClick={onClose}>
                关闭
              </button>
            </div>
          </div>
        ) : phase === "running" ? (
          <div style={{ display: "grid", gap: "10px", padding: "8px 0" }}>
            <div style={{ fontSize: "13px", color: "var(--x-color-ink-muted)" }}>
              正在写入 {progress} / {buckets.eligible.length} …
            </div>
            <div style={barTrackStyle}>
              <div style={{ ...barFillStyle, width: `${buckets.eligible.length ? (progress / buckets.eligible.length) * 100 : 0}%` }} />
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "12px" }}>
            <div style={summaryStyle}>
              选中 <strong>{docs.length}</strong> 笔 · 将创建 <strong style={{ color: "var(--x-color-accent-strong)" }}>{buckets.eligible.length}</strong> 笔
              {buckets.already.length ? ` · 已入账跳过 ${buckets.already.length}` : ""}
              {buckets.invalid.length ? ` · 金额无效跳过 ${buckets.invalid.length}` : ""}
            </div>
            <div style={hintStyle}>
              {direction === "income"
                ? "收入:借「现金 / 银行」,贷「收入科目」。每笔用各自的金额与日期。"
                : "支出:借「费用科目」,贷「现金 / 银行」。每笔用各自的金额与日期。"}
            </div>

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
            <Field label="统一凭证日期(留空则用各单据自己的日期)">
              <input type="date" style={inputStyle} value={overrideDate} onChange={(e) => setOverrideDate(e.target.value)} />
            </Field>

            {error ? <div style={errorStyle}>{error}</div> : null}

            <div style={footerStyle}>
              <button type="button" style={ghostBtnStyle} onClick={onClose}>
                取消
              </button>
              <button type="button" style={primaryBtnStyle} onClick={() => void handleRun()} disabled={!buckets.eligible.length}>
                创建并过账 {buckets.eligible.length} 笔
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

const headerRowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center" };

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

const summaryStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink)",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
  borderRadius: "8px",
  padding: "10px 12px",
};

const hintStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };

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

const okBannerStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-success)",
  background: "var(--x-color-success-soft)",
  border: "1px solid var(--x-color-success-strong)",
  borderRadius: "8px",
  padding: "10px 12px",
  fontWeight: 700,
};

const warnBannerStyle: CSSProperties = {
  ...okBannerStyle,
  color: "var(--x-color-warning)",
  background: "var(--x-color-warning-soft)",
  border: "1px solid var(--x-color-warning-border)",
};

const errLineStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-danger)",
  fontFamily: "var(--x-font-mono)",
};

const barTrackStyle: CSSProperties = { height: "8px", borderRadius: "999px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)", overflow: "hidden" };
const barFillStyle: CSSProperties = { height: "100%", background: "var(--x-color-accent)", transition: "width 0.2s ease" };
