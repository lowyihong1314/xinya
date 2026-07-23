import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { apiFetch } from "../../../js/apiFetch";
import { showConfirmDialog } from "../../../js/dialogs";

type BudgetItem = {
  id: number;
  no: number;
  category: string;
  budget_amount: number;
  actual_amount: number | null;
  remark: string | null;
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return `RM ${Number(n).toFixed(2)}`;
}

export function EventBudgetTab({ eventId, canEdit, isMobile }: { eventId: number; canEdit: boolean; isMobile: boolean }) {
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ni, setNi] = useState({ category: "", budget_amount: "", actual_amount: "" });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/event_data/event_budget/list/${eventId}`, { credentials: "include" });
      const data = await res.json();
      setItems(Array.isArray(data.data) ? data.data : []);
    } catch {
      setError("读取预算失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function add() {
    const category = ni.category.trim();
    if (!category) return;
    try {
      const res = await apiFetch(`/api/event_data/event_budget/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: eventId, category, budget_amount: ni.budget_amount, actual_amount: ni.actual_amount }),
      });
      const data = await res.json();
      if (data.data) {
        setItems((cur) => [...cur, data.data]);
        setNi({ category: "", budget_amount: "", actual_amount: "" });
      }
    } catch {
      setError("添加失败");
    }
  }

  async function patch(id: number, body: Record<string, unknown>) {
    setItems((cur) => cur.map((it) => (it.id === id ? { ...it, ...body } : it)));
    try {
      await apiFetch(`/api/event_data/event_budget/update/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      void load();
    }
  }

  async function remove(id: number) {
    if (!(await showConfirmDialog({ message: "删除这条预算？", tone: "danger" }))) return;
    setItems((cur) => cur.filter((it) => it.id !== id));
    try {
      await apiFetch(`/api/event_data/event_budget/delete/${id}`, { method: "POST" });
    } catch {
      void load();
    }
  }

  const totals = useMemo(() => {
    const budget = items.reduce((s, it) => s + (Number(it.budget_amount) || 0), 0);
    const actual = items.reduce((s, it) => s + (Number(it.actual_amount) || 0), 0);
    return { budget, actual, diff: budget - actual };
  }, [items]);

  return (
    <div style={wrapStyle}>
      <div style={headRowStyle}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>财政预算</div>
        <div style={mutedStyle}>{items.length} 项</div>
      </div>
      {error ? <div style={errorStyle}>{error}</div> : null}

      {canEdit ? (
        <div style={addRowStyle(isMobile)}>
          <input style={{ ...inputStyle, flex: "2 1 160px" }} placeholder="类别，例如：交通·巴士" value={ni.category}
            onChange={(e) => setNi((v) => ({ ...v, category: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
          <input type="number" step="0.01" style={{ ...inputStyle, flex: "1 1 110px" }} placeholder="预算 RM" value={ni.budget_amount}
            onChange={(e) => setNi((v) => ({ ...v, budget_amount: e.target.value }))} />
          <input type="number" step="0.01" style={{ ...inputStyle, flex: "1 1 110px" }} placeholder="实际 RM（可空）" value={ni.actual_amount}
            onChange={(e) => setNi((v) => ({ ...v, actual_amount: e.target.value }))} />
          <button type="button" style={primaryBtnStyle} disabled={!ni.category.trim()} onClick={() => void add()}>添加</button>
        </div>
      ) : null}

      {loading ? <div style={emptyStyle}>加载中…</div> : null}
      {!loading && !items.length ? <div style={emptyStyle}>还没有预算明细。</div> : null}

      {items.length ? (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ ...rowStyle, fontWeight: 700, color: "var(--x-color-ink-muted)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            <span style={{ flex: "2 1 140px" }}>类别</span>
            <span style={amtHeadStyle}>预算</span>
            <span style={amtHeadStyle}>实际</span>
            {!isMobile ? <span style={{ flex: "1 1 120px" }}>备注</span> : null}
            {canEdit ? <span style={{ width: 44 }} /> : null}
          </div>
          {items.map((it) => (
            <div key={it.id} style={rowStyle}>
              {canEdit ? (
                <input style={{ ...cellInputStyle, flex: "2 1 140px", fontWeight: 600 }} defaultValue={it.category}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.category) void patch(it.id, { category: v }); }} />
              ) : <span style={{ flex: "2 1 140px", fontWeight: 600 }}>{it.category}</span>}
              {canEdit ? (
                <input type="number" step="0.01" style={{ ...cellInputStyle, ...amtCellStyle }} defaultValue={String(it.budget_amount ?? "")}
                  onBlur={(e) => { const v = e.target.value.trim(); if (Number(v || 0) !== Number(it.budget_amount || 0)) void patch(it.id, { budget_amount: v }); }} />
              ) : <span style={amtCellStyle}>{fmt(it.budget_amount)}</span>}
              {canEdit ? (
                <input type="number" step="0.01" style={{ ...cellInputStyle, ...amtCellStyle }} placeholder="—" defaultValue={it.actual_amount == null ? "" : String(it.actual_amount)}
                  onBlur={(e) => { const v = e.target.value.trim(); void patch(it.id, { actual_amount: v }); }} />
              ) : <span style={amtCellStyle}>{fmt(it.actual_amount)}</span>}
              {!isMobile ? (
                canEdit ? (
                  <input style={{ ...cellInputStyle, flex: "1 1 120px" }} placeholder="备注" defaultValue={it.remark || ""}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (it.remark || "")) void patch(it.id, { remark: v }); }} />
                ) : <span style={{ flex: "1 1 120px", color: "var(--x-color-ink-muted)", fontSize: 12 }}>{it.remark || ""}</span>
              ) : null}
              {canEdit ? <button type="button" style={delBtnStyle} onClick={() => void remove(it.id)}>删</button> : null}
            </div>
          ))}
          <div style={totalRowStyle}>
            <span style={{ flex: "2 1 140px", fontWeight: 800 }}>合计</span>
            <span style={{ ...amtCellStyle, fontWeight: 800 }}>{fmt(totals.budget)}</span>
            <span style={{ ...amtCellStyle, fontWeight: 800 }}>{fmt(totals.actual)}</span>
            {!isMobile ? <span style={{ flex: "1 1 120px", fontSize: 12, color: totals.diff < 0 ? "var(--x-color-danger)" : "var(--x-color-ink-muted)" }}>差额 {fmt(totals.diff)}</span> : null}
            {canEdit ? <span style={{ width: 44 }} /> : null}
          </div>
          {isMobile ? <div style={mutedStyle}>差额（预算−实际）：{fmt(totals.diff)}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

const wrapStyle: CSSProperties = { display: "grid", gap: "10px" };
const headRowStyle: CSSProperties = { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 };
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
function addRowStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", gap: "6px", flexWrap: "wrap", padding: "10px", borderRadius: "9px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)", flexDirection: isMobile ? "column" : "row" };
}
const inputStyle: CSSProperties = { padding: "8px 10px", borderRadius: "7px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontSize: "13px", boxSizing: "border-box" };
const primaryBtnStyle: CSSProperties = { padding: "8px 16px", borderRadius: "7px", border: "1px solid var(--x-color-accent-strong)", background: "var(--x-color-accent)", color: "white", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "8px", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)" };
const totalRowStyle: CSSProperties = { ...rowStyle, background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line)" };
const amtHeadStyle: CSSProperties = { flex: "0 1 100px", textAlign: "right" };
const amtCellStyle: CSSProperties = { flex: "0 1 100px", textAlign: "right", fontFamily: "var(--x-font-mono)", fontSize: "12.5px" };
const cellInputStyle: CSSProperties = { padding: "5px 8px", borderRadius: "6px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink)", fontSize: "12.5px", boxSizing: "border-box", minWidth: 0 };
const delBtnStyle: CSSProperties = { width: 44, flexShrink: 0, padding: "5px 0", borderRadius: "6px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 700, fontSize: "12px", cursor: "pointer" };
const emptyStyle: CSSProperties = { padding: "22px", borderRadius: "10px", border: "1px dashed var(--x-color-line)", textAlign: "center", color: "var(--x-color-ink-muted)" };
const errorStyle: CSSProperties = { padding: "9px 12px", borderRadius: "8px", background: "var(--x-color-danger-soft)", border: "1px solid var(--x-color-danger-border)", color: "var(--x-color-danger)", fontSize: "13px" };
