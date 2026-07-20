import { useEffect, useMemo, useState } from "react";

import { fetchGLAccountLedger, fetchGLTrialBalance } from "./api";
import {
  ACCOUNT_TYPE_LABELS,
  btnStyle,
  emptyStyle,
  filterBarStyle,
  inputStyle,
  labelStyle,
  money,
  monoCellStyle,
  subTabStyle,
  tabBarStyle,
  tableWrapStyle,
  toolbarStyle,
  typeChipStyle,
} from "./glStyles";
import type { GLAccount, GLAccountLedger, GLTrialBalance } from "./types";

type ReportsTabProps = {
  accounts: GLAccount[];
  onNotify: (message: string, isError?: boolean) => void;
};

type ReportView = "trial" | "ledger";

export function ReportsTab({ accounts, onNotify }: ReportsTabProps) {
  const [view, setView] = useState<ReportView>("trial");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const [trial, setTrial] = useState<GLTrialBalance | null>(null);
  const [loadingTrial, setLoadingTrial] = useState(false);

  const [accountId, setAccountId] = useState<number | null>(accounts[0]?.id ?? null);
  const [ledger, setLedger] = useState<GLAccountLedger | null>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);

  const activeAccounts = useMemo(() => accounts.filter((a) => a.status === "active"), [accounts]);

  useEffect(() => {
    if (accountId == null && activeAccounts.length) {
      setAccountId(activeAccounts[0].id);
    }
  }, [activeAccounts, accountId]);

  async function loadTrial() {
    setLoadingTrial(true);
    try {
      const data = await fetchGLTrialBalance({ start: start || undefined, end: end || undefined });
      setTrial(data);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "载入试算平衡失败", true);
    } finally {
      setLoadingTrial(false);
    }
  }

  async function loadLedger() {
    if (accountId == null) return;
    setLoadingLedger(true);
    try {
      const data = await fetchGLAccountLedger(accountId, { start: start || undefined, end: end || undefined });
      setLedger(data);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "载入明细账失败", true);
    } finally {
      setLoadingLedger(false);
    }
  }

  useEffect(() => {
    if (view === "trial") void loadTrial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (view === "ledger" && accountId != null) void loadLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, accountId]);

  return (
    <>
      <div style={toolbarStyle}>
        <div>
          <div style={{ fontSize: "15px", fontWeight: 800, color: "var(--x-color-ink)" }}>财务报表 Reports</div>
          <div style={{ fontSize: "12px", color: "var(--x-color-ink-muted)" }}>试算平衡与科目明细账</div>
        </div>
        <div style={tabBarStyle}>
          <button type="button" style={subTabStyle(view === "trial")} onClick={() => setView("trial")}>
            试算平衡
          </button>
          <button type="button" style={subTabStyle(view === "ledger")} onClick={() => setView("ledger")}>
            明细账
          </button>
        </div>
      </div>

      <div style={filterBarStyle}>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "end" }}>
          {view === "ledger" ? (
            <div style={{ display: "grid", gap: "4px" }}>
              <div style={labelStyle}>科目</div>
              <select style={{ ...inputStyle, minWidth: 220 }} value={accountId ?? ""} onChange={(e) => setAccountId(Number(e.target.value))}>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div style={{ display: "grid", gap: "4px" }}>
            <div style={labelStyle}>起始日期</div>
            <input type="date" style={inputStyle} value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div style={{ display: "grid", gap: "4px" }}>
            <div style={labelStyle}>结束日期</div>
            <input type="date" style={inputStyle} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <button type="button" style={btnStyle} onClick={() => (view === "trial" ? void loadTrial() : void loadLedger())}>
            应用
          </button>
        </div>
      </div>

      {view === "trial" ? (
        loadingTrial ? (
          <div style={emptyStyle}>载入试算平衡中…</div>
        ) : !trial || !trial.rows.length ? (
          <div style={emptyStyle}>暂无数据</div>
        ) : (
          <div style={tableWrapStyle}>
            <table className="gl-table">
              <thead>
                <tr>
                  <th>编号</th>
                  <th>科目</th>
                  <th>类型</th>
                  <th className="gl-num">借方余额</th>
                  <th className="gl-num">贷方余额</th>
                </tr>
              </thead>
              <tbody>
                {trial.rows.map((row) => (
                  <tr key={row.account_id}>
                    <td style={monoCellStyle}>{row.code}</td>
                    <td style={{ fontWeight: 700 }}>{row.name}</td>
                    <td>
                      <span style={typeChipStyle(row.account_type)}>{ACCOUNT_TYPE_LABELS[row.account_type]}</span>
                    </td>
                    <td className="gl-num">{row.debit_balance ? money(row.debit_balance) : "—"}</td>
                    <td className="gl-num">{row.credit_balance ? money(row.credit_balance) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>
                    合计 {trial.balanced ? "（借贷平衡 ✓）" : "（不平衡 ⚠）"}
                  </td>
                  <td className="gl-num">{money(trial.total_debit)}</td>
                  <td className="gl-num">{money(trial.total_credit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      ) : loadingLedger ? (
        <div style={emptyStyle}>载入明细账中…</div>
      ) : !ledger ? (
        <div style={emptyStyle}>选择科目查看明细账</div>
      ) : (
        <>
          <div style={{ padding: "10px 14px", fontSize: "13px", color: "var(--x-color-ink-muted)" }}>
            {ledger.account.code} {ledger.account.name} · 期初 RM {money(ledger.opening_balance)} · 期末{" "}
            <strong style={{ color: "var(--x-color-accent-strong)" }}>RM {money(ledger.closing_balance)}</strong>
          </div>
          {!ledger.entries.length ? (
            <div style={emptyStyle}>该科目在所选期间没有分录</div>
          ) : (
            <div style={tableWrapStyle}>
              <table className="gl-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>凭证号</th>
                    <th>摘要 / 说明</th>
                    <th className="gl-num">借方</th>
                    <th className="gl-num">贷方</th>
                    <th className="gl-num">余额</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.entries.map((row) => (
                    <tr key={row.line_id}>
                      <td style={monoCellStyle}>{row.entry_date}</td>
                      <td style={monoCellStyle}>{row.entry_no}</td>
                      <td>{row.description || row.memo || "—"}</td>
                      <td className="gl-num">{row.debit ? money(row.debit) : "—"}</td>
                      <td className="gl-num">{row.credit ? money(row.credit) : "—"}</td>
                      <td className="gl-num" style={{ fontWeight: 700 }}>{money(row.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>合计</td>
                    <td className="gl-num">{money(ledger.total_debit)}</td>
                    <td className="gl-num">{money(ledger.total_credit)}</td>
                    <td className="gl-num">{money(ledger.closing_balance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
