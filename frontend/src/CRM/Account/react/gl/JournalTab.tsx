import { Fragment, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { createGLJournalEntry, deleteGLJournalEntry, postGLJournalEntry, voidGLJournalEntry } from "./api";
import {
  btnStyle,
  cardStyle,
  cellStrongStyle,
  dangerButtonStyle,
  emptyStyle,
  filterBarStyle,
  ghostButtonStyle,
  inputStyle,
  labelStyle,
  money,
  monoCellStyle,
  primaryButtonStyle,
  searchInputStyle,
  statusChipStyle,
  statusText,
  subTabStyle,
  tabBarStyle,
  tableWrapStyle,
  toolbarStyle,
} from "./glStyles";
import type { GLAccount, GLJournalEntry } from "./types";

type JournalTabProps = {
  entries: GLJournalEntry[];
  accounts: GLAccount[];
  canEdit: boolean;
  loading: boolean;
  onChanged: () => void;
  onNotify: (message: string, isError?: boolean) => void;
};

type StatusFilter = "all" | "posted" | "draft" | "void";

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "posted", label: "已过账" },
  { key: "draft", label: "草稿" },
  { key: "void", label: "已作废" },
];

type LineDraft = { key: string; accountId: string; debit: string; credit: string; description: string };

function newLine(): LineDraft {
  return { key: `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`, accountId: "", debit: "", credit: "", description: "" };
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function JournalTab({ entries, accounts, canEdit, loading, onChanged, onNotify }: JournalTabProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const [entryDate, setEntryDate] = useState(todayIso());
  const [memo, setMemo] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([newLine(), newLine()]);

  const activeAccounts = useMemo(() => accounts.filter((a) => a.status === "active"), [accounts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => statusFilter === "all" || e.status === statusFilter)
      .filter((e) => !q || `${e.entry_no} ${e.memo || ""} ${e.reference || ""} ${e.source}`.toLowerCase().includes(q));
  }, [entries, statusFilter, query]);

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const line of lines) {
      debit += Number(line.debit || 0);
      credit += Number(line.credit || 0);
    }
    return { debit, credit, balanced: debit === credit && debit > 0 };
  }, [lines]);

  function resetForm() {
    setEntryDate(todayIso());
    setMemo("");
    setReference("");
    setLines([newLine(), newLine()]);
  }

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function handleCreate() {
    const payloadLines = lines
      .filter((l) => l.accountId && (Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0))
      .map((l) => ({
        account_id: Number(l.accountId),
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
        description: l.description || undefined,
      }));
    if (payloadLines.length < 2) {
      onNotify("凭证至少需要两条有效分录", true);
      return;
    }
    if (!totals.balanced) {
      onNotify("借贷不平衡，无法保存", true);
      return;
    }
    setSaving(true);
    try {
      await createGLJournalEntry({ entry_date: entryDate, memo, reference, status: "posted", lines: payloadLines });
      onNotify("凭证已过账");
      resetForm();
      setCreating(false);
      onChanged();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "保存失败", true);
    } finally {
      setSaving(false);
    }
  }

  async function handleVoid(entry: GLJournalEntry) {
    if (!window.confirm(`确定作废凭证 ${entry.entry_no}?`)) return;
    try {
      await voidGLJournalEntry(entry.id);
      onNotify("凭证已作废");
      onChanged();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "作废失败", true);
    }
  }

  async function handlePost(entry: GLJournalEntry) {
    try {
      await postGLJournalEntry(entry.id);
      onNotify("凭证已过账");
      onChanged();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "过账失败", true);
    }
  }

  async function handleDelete(entry: GLJournalEntry) {
    if (!window.confirm(`确定删除草稿凭证 ${entry.entry_no}?`)) return;
    try {
      await deleteGLJournalEntry(entry.id);
      onNotify("草稿已删除");
      onChanged();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "删除失败", true);
    }
  }

  return (
    <>
      <div style={toolbarStyle}>
        <div>
          <div style={{ fontSize: "15px", fontWeight: 800, color: "var(--x-color-ink)" }}>会计凭证 Journal Entries</div>
          <div style={{ fontSize: "12px", color: "var(--x-color-ink-muted)" }}>共 {entries.length} 张凭证 · 借贷必须平衡</div>
        </div>
        {canEdit ? (
          <button type="button" style={creating ? btnStyle : primaryButtonStyle} onClick={() => setCreating((v) => !v)}>
            {creating ? "收起录入" : "新建凭证"}
          </button>
        ) : null}
      </div>

      {creating && canEdit ? (
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--x-color-line-soft)" }}>
          <div style={cardStyle}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
              <Field label="凭证日期">
                <input type="date" style={inputStyle} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </Field>
              <Field label="摘要 Memo">
                <input style={inputStyle} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="例如：收到乐捐" />
              </Field>
              <Field label="参考号 Reference">
                <input style={inputStyle} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="选填" />
              </Field>
            </div>

            <div style={{ width: "100%", overflowX: "auto" }}>
              <table className="gl-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 220 }}>科目</th>
                    <th className="gl-num" style={{ minWidth: 110 }}>借方 Debit</th>
                    <th className="gl-num" style={{ minWidth: 110 }}>贷方 Credit</th>
                    <th style={{ minWidth: 160 }}>说明</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={line.key}>
                      <td>
                        <select style={inputStyle} value={line.accountId} onChange={(e) => updateLine(index, { accountId: e.target.value })}>
                          <option value="">选择科目</option>
                          {activeAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          style={{ ...inputStyle, textAlign: "right" }}
                          value={line.debit}
                          onChange={(e) => updateLine(index, { debit: e.target.value, credit: e.target.value ? "" : line.credit })}
                          placeholder="0.00"
                          inputMode="decimal"
                        />
                      </td>
                      <td>
                        <input
                          style={{ ...inputStyle, textAlign: "right" }}
                          value={line.credit}
                          onChange={(e) => updateLine(index, { credit: e.target.value, debit: e.target.value ? "" : line.debit })}
                          placeholder="0.00"
                          inputMode="decimal"
                        />
                      </td>
                      <td>
                        <input style={inputStyle} value={line.description} onChange={(e) => updateLine(index, { description: e.target.value })} />
                      </td>
                      <td>
                        <button
                          type="button"
                          style={ghostButtonStyle}
                          onClick={() => setLines((c) => (c.length <= 2 ? c : c.filter((_, i) => i !== index)))}
                          disabled={lines.length <= 2}
                        >
                          删
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ fontWeight: 800 }}>合计</td>
                    <td className="gl-num">{money(totals.debit)}</td>
                    <td className="gl-num">{money(totals.credit)}</td>
                    <td colSpan={2} style={{ color: totals.balanced ? "var(--x-color-success)" : "var(--x-color-danger)", fontWeight: 700 }}>
                      {totals.balanced ? "借贷平衡 ✓" : `差额 ${money(totals.debit - totals.credit)}`}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button type="button" style={btnStyle} onClick={() => setLines((c) => [...c, newLine()])}>
                新增分录行
              </button>
              <button type="button" style={primaryButtonStyle} onClick={() => void handleCreate()} disabled={saving || !totals.balanced}>
                {saving ? "保存中…" : "保存并过账"}
              </button>
              <button type="button" style={btnStyle} onClick={resetForm} disabled={saving}>
                清空
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={filterBarStyle}>
        <div style={tabBarStyle}>
          {STATUS_TABS.map((tab) => (
            <button key={tab.key} type="button" style={subTabStyle(tab.key === statusFilter)} onClick={() => setStatusFilter(tab.key)}>
              {tab.label}
            </button>
          ))}
        </div>
        <input style={searchInputStyle} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索单号 / 摘要 / 来源" />
      </div>

      {loading ? (
        <div style={emptyStyle}>载入凭证中…</div>
      ) : !filtered.length ? (
        <div style={emptyStyle}>{query ? "没有匹配的凭证" : "暂无凭证"}</div>
      ) : (
        <div style={tableWrapStyle}>
          <table className="gl-table">
            <thead>
              <tr>
                <th>凭证号</th>
                <th>日期</th>
                <th>摘要</th>
                <th>来源</th>
                <th>状态</th>
                <th className="gl-num">金额</th>
                {canEdit ? <th>操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <Fragment key={entry.id}>
                  <tr className="gl-row-click" onClick={() => setExpanded((v) => (v === entry.id ? null : entry.id))}>
                    <td style={monoCellStyle}>{entry.entry_no}</td>
                    <td style={monoCellStyle}>{entry.entry_date}</td>
                    <td style={cellStrongStyle}>{entry.memo || "—"}</td>
                    <td>{entry.source}</td>
                    <td>
                      <span style={statusChipStyle(entry.status)}>{statusText(entry.status)}</span>
                    </td>
                    <td className="gl-num">{money(entry.total_debit)}</td>
                    {canEdit ? (
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: "6px" }}>
                          {entry.status === "draft" ? (
                            <button type="button" style={ghostButtonStyle} onClick={() => void handlePost(entry)}>
                              过账
                            </button>
                          ) : null}
                          {entry.status !== "void" ? (
                            <button type="button" style={dangerButtonStyle} onClick={() => void handleVoid(entry)}>
                              作废
                            </button>
                          ) : null}
                          {entry.status === "draft" ? (
                            <button type="button" style={dangerButtonStyle} onClick={() => void handleDelete(entry)}>
                              删除
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                  {expanded === entry.id && entry.lines?.length ? (
                    <tr>
                      <td colSpan={canEdit ? 7 : 6} style={{ background: "var(--x-color-panel-alt)", padding: "8px 12px" }}>
                        <table className="gl-table" style={{ background: "transparent" }}>
                          <thead>
                            <tr>
                              <th>科目</th>
                              <th>说明</th>
                              <th className="gl-num">借方</th>
                              <th className="gl-num">贷方</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entry.lines.map((line) => (
                              <tr key={line.id}>
                                <td>
                                  <span style={monoCellStyle}>{line.account_code}</span> {line.account_name}
                                </td>
                                <td>{line.description || "—"}</td>
                                <td className="gl-num">{line.debit ? money(line.debit) : "—"}</td>
                                <td className="gl-num">{line.credit ? money(line.credit) : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: "4px" } as CSSProperties}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}
