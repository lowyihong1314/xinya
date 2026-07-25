import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch } from "../../../js/apiFetch";
import { showConfirmDialog } from "../../../js/dialogs";
import { useUserState } from "../../../app/UserState";
import { hasUserPermission } from "../../../app/permissions";
import { ClaimCreateModal } from "../../Account/react/claim/ClaimCreateModal";

type BudgetClaim = { id: number; status: "pending" | "approved" | "rejected"; amount?: number };
type BudgetStats = { total: number; paid: number; approved: number };
type BudgetItem = {
  id: number | string;
  no: number;
  type?: "income" | "expense";
  category: string;
  budget_amount: number;
  actual_amount: number | null;
  remark: string | null;
  claim?: BudgetClaim | null;
  locked?: boolean;
  source?: string;
  editable?: boolean;
  form_id?: number;
  stats?: BudgetStats;
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return `RM ${Number(n).toFixed(2)}`;
}

function claimTone(status?: string): { bg: string; border: string; label: string; color: string } | null {
  if (status === "approved") return { bg: "var(--x-color-accent-tint)", border: "var(--x-color-accent-border)", label: "已批准", color: "var(--x-color-accent-strong)" };
  if (status === "pending") return { bg: "var(--x-color-success-soft)", border: "rgba(21,128,61,0.30)", label: "已提交", color: "var(--x-color-success)" };
  if (status === "rejected") return { bg: "var(--x-color-danger-soft)", border: "var(--x-color-danger-border)", label: "被拒", color: "var(--x-color-danger)" };
  return null;
}

export function EventBudgetTab({
  eventId,
  eventName,
  canEdit,
  isMobile,
}: {
  eventId: number;
  eventName?: string;
  canEdit: boolean;
  isMobile: boolean;
}) {
  const { user } = useUserState();
  const canSubmitClaim = hasUserPermission(user, "account_submit_claim");
  const navigate = useNavigate();

  const [items, setItems] = useState<BudgetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [niE, setNiE] = useState({ category: "", budget_amount: "", actual_amount: "" });
  const [niI, setNiI] = useState({ category: "", budget_amount: "", actual_amount: "" });
  const [newClaimOpen, setNewClaimOpen] = useState(false);

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

  async function add(type: "income" | "expense") {
    const ni = type === "income" ? niI : niE;
    const category = ni.category.trim();
    if (!category) return;
    try {
      const res = await apiFetch(`/api/event_data/event_budget/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: eventId, type, category, budget_amount: ni.budget_amount, actual_amount: ni.actual_amount }),
      });
      const data = await res.json();
      if (data.data) {
        setItems((cur) => [...cur, data.data]);
        (type === "income" ? setNiI : setNiE)({ category: "", budget_amount: "", actual_amount: "" });
      }
    } catch {
      setError("添加失败");
    }
  }

  async function patch(id: number | string, body: Record<string, unknown>) {
    if (typeof id !== "number") return;
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

  async function remove(id: number | string) {
    if (typeof id !== "number") return;
    if (!(await showConfirmDialog({ message: "删除这条预算？", tone: "danger" }))) return;
    setItems((cur) => cur.filter((it) => it.id !== id));
    try {
      await apiFetch(`/api/event_data/event_budget/delete/${id}`, { method: "POST" });
    } catch {
      void load();
    }
  }

  const income = items.filter((i) => i.type === "income");
  const expense = items.filter((i) => (i.type ?? "expense") === "expense");

  const totals = useMemo(() => {
    const sum = (arr: BudgetItem[], key: "budget_amount" | "actual_amount") =>
      arr.reduce((s, it) => s + (Number(it[key]) || 0), 0);
    const incB = sum(income, "budget_amount");
    const incA = sum(income, "actual_amount");
    const expB = sum(expense, "budget_amount");
    const expA = sum(expense, "actual_amount");
    return { incB, incA, expB, expA, netB: incB - expB, netA: incA - expA };
  }, [income, expense]);

  // 报销行（source=claim，只读）：显示「查看」跳到报销详情。手动支出行无按钮。
  function claimView(it: BudgetItem): ReactNode {
    if (it.source !== "claim" || !it.claim) return null;
    return (
      <button type="button" style={linkBtnStyle} onClick={() => navigate(`/crm/finance?account_router=claim_req&claim_id=${it.claim!.id}`)}>查看</button>
    );
  }

  return (
    <div style={wrapStyle}>
      {error ? <div style={errorStyle}>{error}</div> : null}
      {loading ? <div style={emptyStyle}>加载中…</div> : null}

      {/* ===== 收入 ===== */}
      <section style={sectionStyle}>
        <div style={headRowStyle}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>收入</div>
          <div style={mutedStyle}>预算 {fmt(totals.incB)} · 实际 {fmt(totals.incA)}</div>
        </div>

        {income.filter((it) => it.source === "registration").map((it) => (
          <div key={it.id} style={regCardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700 }}>{it.category}</span>
              <span style={{ fontFamily: "var(--x-font-mono)", fontSize: 12.5 }}>预期 {fmt(it.budget_amount)} · 已收 {fmt(it.actual_amount)}</span>
            </div>
            {it.stats ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span style={statChipStyle}>总人数 {it.stats.total}</span>
                <span style={{ ...statChipStyle, background: "var(--x-color-warning-soft)", color: "var(--x-color-warning)" }}>已支付 {it.stats.paid}</span>
                <span style={{ ...statChipStyle, background: "var(--x-color-success-soft)", color: "var(--x-color-success)" }}>已批准 {it.stats.approved}</span>
              </div>
            ) : null}
          </div>
        ))}

        {income.filter((it) => it.source !== "registration").length ? (
          <div style={{ display: "grid", gap: 6 }}>
            {income.filter((it) => it.source !== "registration").map((it) => (
              <EditableRow key={it.id} it={it} isMobile={isMobile} canEdit={canEdit} locked={false} tone={null}
                onPatch={patch} onRemove={remove} action={null} />
            ))}
          </div>
        ) : null}

        {canEdit ? (
          <AddRow isMobile={isMobile} ni={niI} setNi={setNiI} onAdd={() => void add("income")} placeholder="收入类别，例如：赞助 / 义卖" />
        ) : null}
        {!income.length && !canEdit ? <div style={mutedStyle}>暂无收入。</div> : null}
      </section>

      {/* ===== 支出 ===== */}
      <section style={sectionStyle}>
        <div style={headRowStyle}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>支出</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={mutedStyle}>预算 {fmt(totals.expB)} · 实际 {fmt(totals.expA)}</div>
            {canSubmitClaim ? <button type="button" style={claimBtnStyle} onClick={() => setNewClaimOpen(true)}>+ 新建报销</button> : null}
          </div>
        </div>

        {expense.length ? (
          <div style={{ display: "grid", gap: 6 }}>
            {expense.map((it) => {
              const tone = claimTone(it.claim?.status);
              return (
                <EditableRow key={it.id} it={it} isMobile={isMobile} canEdit={canEdit} locked={!!it.locked} tone={tone}
                  onPatch={patch} onRemove={remove} action={claimView(it)} />
              );
            })}
          </div>
        ) : null}

        {canEdit ? (
          <AddRow isMobile={isMobile} ni={niE} setNi={setNiE} onAdd={() => void add("expense")} placeholder="支出类别，例如：交通·巴士" />
        ) : null}
        {!expense.length && !canEdit ? <div style={mutedStyle}>暂无支出。</div> : null}
      </section>

      {/* ===== 合计 ===== */}
      <div style={totalRowStyle}>
        <span style={{ fontWeight: 800 }}>结余（收入−支出）</span>
        <span style={{ fontFamily: "var(--x-font-mono)", fontWeight: 800, color: totals.netA < 0 ? "var(--x-color-danger)" : "var(--x-color-success)" }}>
          实际 {fmt(totals.netA)}
        </span>
        <span style={{ fontFamily: "var(--x-font-mono)", fontSize: 12.5, color: "var(--x-color-ink-muted)" }}>预算 {fmt(totals.netB)}</span>
      </div>

      {newClaimOpen ? (
        <ClaimCreateModal
          eventId={eventId}
          eventName={eventName}
          onClose={() => setNewClaimOpen(false)}
          onSuccess={() => void load()}
        />
      ) : null}
    </div>
  );
}

function EditableRow({
  it,
  isMobile,
  canEdit,
  locked,
  tone,
  onPatch,
  onRemove,
  action,
}: {
  it: BudgetItem;
  isMobile: boolean;
  canEdit: boolean;
  locked: boolean;
  tone: { bg: string; border: string; label: string; color: string } | null;
  onPatch: (id: number | string, body: Record<string, unknown>) => void;
  onRemove: (id: number | string) => void;
  action: ReactNode;
}) {
  const editable = canEdit && !locked;
  const rowExtra: CSSProperties = tone ? { background: tone.bg, borderColor: tone.border } : {};
  return (
    <div style={{ ...rowStyle, ...rowExtra }}>
      {editable ? (
        <input style={{ ...cellInputStyle, flex: "2 1 140px", fontWeight: 600 }} defaultValue={it.category}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.category) onPatch(it.id, { category: v }); }} />
      ) : (
        <span style={{ flex: "2 1 140px", fontWeight: 600, minWidth: 0 }}>
          {it.category}
          {tone ? <span style={{ ...toneChipStyle, color: tone.color }}>{tone.label}</span> : null}
        </span>
      )}
      {editable ? (
        <input type="number" step="0.01" style={{ ...cellInputStyle, ...amtCellStyle }} defaultValue={String(it.budget_amount ?? "")}
          onBlur={(e) => { const v = e.target.value.trim(); if (Number(v || 0) !== Number(it.budget_amount || 0)) onPatch(it.id, { budget_amount: v }); }} />
      ) : <span style={amtCellStyle}>{fmt(it.budget_amount)}</span>}
      {editable ? (
        <input type="number" step="0.01" style={{ ...cellInputStyle, ...amtCellStyle }} placeholder="—" defaultValue={it.actual_amount == null ? "" : String(it.actual_amount)}
          onBlur={(e) => { const v = e.target.value.trim(); onPatch(it.id, { actual_amount: v }); }} />
      ) : <span style={amtCellStyle}>{fmt(it.actual_amount)}</span>}
      {!isMobile ? (
        editable ? (
          <input style={{ ...cellInputStyle, flex: "1 1 100px" }} placeholder="备注" defaultValue={it.remark || ""}
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (it.remark || "")) onPatch(it.id, { remark: v }); }} />
        ) : <span style={{ flex: "1 1 100px", color: "var(--x-color-ink-muted)", fontSize: 12 }}>{it.remark || ""}</span>
      ) : null}
      {action}
      {editable ? <button type="button" style={delBtnStyle} onClick={() => onRemove(it.id)}>删</button> : null}
    </div>
  );
}

function AddRow({
  isMobile,
  ni,
  setNi,
  onAdd,
  placeholder,
}: {
  isMobile: boolean;
  ni: { category: string; budget_amount: string; actual_amount: string };
  setNi: (v: { category: string; budget_amount: string; actual_amount: string }) => void;
  onAdd: () => void;
  placeholder: string;
}) {
  return (
    <div style={addRowStyle(isMobile)}>
      <input style={{ ...inputStyle, flex: "2 1 160px" }} placeholder={placeholder} value={ni.category}
        onChange={(e) => setNi({ ...ni, category: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }} />
      <input type="number" step="0.01" style={{ ...inputStyle, flex: "1 1 100px" }} placeholder="预算 RM" value={ni.budget_amount}
        onChange={(e) => setNi({ ...ni, budget_amount: e.target.value })} />
      <input type="number" step="0.01" style={{ ...inputStyle, flex: "1 1 100px" }} placeholder="实际 RM（可空）" value={ni.actual_amount}
        onChange={(e) => setNi({ ...ni, actual_amount: e.target.value })} />
      <button type="button" style={primaryBtnStyle} disabled={!ni.category.trim()} onClick={onAdd}>添加</button>
    </div>
  );
}

const wrapStyle: CSSProperties = { display: "grid", gap: "14px" };
const sectionStyle: CSSProperties = { display: "grid", gap: "8px" };
const headRowStyle: CSSProperties = { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" };
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
function addRowStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", gap: "6px", flexWrap: "wrap", padding: "10px", borderRadius: "9px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)", flexDirection: isMobile ? "column" : "row" };
}
const inputStyle: CSSProperties = { padding: "8px 10px", borderRadius: "7px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontSize: "13px", boxSizing: "border-box" };
const primaryBtnStyle: CSSProperties = { padding: "8px 16px", borderRadius: "7px", border: "1px solid var(--x-color-accent-strong)", background: "var(--x-color-accent)", color: "white", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "8px", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", flexWrap: "wrap" };
const regCardStyle: CSSProperties = { display: "grid", gap: 6, padding: "10px 12px", borderRadius: "9px", border: "1px solid var(--x-color-accent-border)", background: "var(--x-color-accent-tint)" };
const totalRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: "9px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line)", flexWrap: "wrap" };
const amtCellStyle: CSSProperties = { flex: "0 1 96px", textAlign: "right", fontFamily: "var(--x-font-mono)", fontSize: "12.5px" };
const cellInputStyle: CSSProperties = { padding: "5px 8px", borderRadius: "6px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink)", fontSize: "12.5px", boxSizing: "border-box", minWidth: 0 };
const delBtnStyle: CSSProperties = { flexShrink: 0, padding: "5px 9px", borderRadius: "6px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 700, fontSize: "12px", cursor: "pointer" };
const claimBtnStyle: CSSProperties = { flexShrink: 0, padding: "5px 10px", borderRadius: "6px", border: "1px solid var(--x-color-accent-strong)", background: "var(--x-color-accent)", color: "white", fontWeight: 700, fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap" };
const linkBtnStyle: CSSProperties = { flexShrink: 0, padding: "5px 10px", borderRadius: "6px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 700, fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap" };
const toneChipStyle: CSSProperties = { marginLeft: 8, fontSize: 11, fontWeight: 800 };
const statChipStyle: CSSProperties = { padding: "2px 9px", borderRadius: 999, background: "var(--x-color-panel)", border: "1px solid var(--x-color-line-soft)", fontSize: 11.5, fontWeight: 700 };
const emptyStyle: CSSProperties = { padding: "16px", borderRadius: "10px", border: "1px dashed var(--x-color-line)", textAlign: "center", color: "var(--x-color-ink-muted)" };
const errorStyle: CSSProperties = { padding: "9px 12px", borderRadius: "8px", background: "var(--x-color-danger-soft)", border: "1px solid var(--x-color-danger-border)", color: "var(--x-color-danger)", fontSize: "13px" };
