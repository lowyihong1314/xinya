import { useEffect, useState } from "react";

import { fetchGLAccountLedger } from "./api";
import {
  cardStyle,
  emptyStyle,
  filterBarStyle,
  money,
  monoCellStyle,
  tableWrapStyle,
  toolbarStyle,
} from "./glStyles";
import type { GLAccountLedger, GLCashSummary } from "./types";

type CashBookTabProps = {
  cash: GLCashSummary;
  onNotify: (message: string, isError?: boolean) => void;
};

export function CashBookTab({ cash, onNotify }: CashBookTabProps) {
  const cashAccounts = cash.accounts;
  const [selectedId, setSelectedId] = useState<number | null>(cashAccounts[0]?.id ?? null);
  const [ledger, setLedger] = useState<GLAccountLedger | null>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);

  useEffect(() => {
    if (selectedId == null && cashAccounts.length) {
      setSelectedId(cashAccounts[0].id);
    }
  }, [cashAccounts, selectedId]);

  useEffect(() => {
    if (selectedId == null) {
      setLedger(null);
      return;
    }
    let cancelled = false;
    setLoadingLedger(true);
    void (async () => {
      try {
        const data = await fetchGLAccountLedger(selectedId);
        if (!cancelled) setLedger(data);
      } catch (error) {
        if (!cancelled) onNotify(error instanceof Error ? error.message : "载入现金账失败", true);
      } finally {
        if (!cancelled) setLoadingLedger(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, onNotify]);

  if (!cashAccounts.length) {
    return (
      <>
        <div style={toolbarStyle}>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 800, color: "var(--x-color-ink)" }}>现金账 Cash Book</div>
            <div style={{ fontSize: "12px", color: "var(--x-color-ink-muted)" }}>现金 / 银行账户的收付流水与余额</div>
          </div>
        </div>
        <div style={emptyStyle}>还没有资金账户。请到「科目表」把某个科目勾选为「资金账户」。</div>
      </>
    );
  }

  return (
    <>
      <div style={toolbarStyle}>
        <div>
          <div style={{ fontSize: "15px", fontWeight: 800, color: "var(--x-color-ink)" }}>现金账 Cash Book</div>
          <div style={{ fontSize: "12px", color: "var(--x-color-ink-muted)" }}>
            资金合计余额 RM {money(cash.total_balance)} · 流水由报销申请 / 收款审核写入
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 14px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
        {cashAccounts.map((account) => (
          <button
            key={account.id}
            type="button"
            onClick={() => setSelectedId(account.id)}
            style={{
              ...cardStyle,
              textAlign: "left",
              cursor: "pointer",
              border: account.id === selectedId ? "1px solid var(--x-color-accent-strong)" : "1px solid var(--x-color-line-soft)",
              boxShadow: account.id === selectedId ? "0 1px 2px var(--x-color-shadow-soft)" : "none",
            }}
          >
            <div style={{ fontSize: "12px", color: "var(--x-color-ink-muted)", fontWeight: 700 }}>
              {account.cash_kind === "bank" ? "银行" : "现金"} · {account.code}
            </div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--x-color-ink)" }}>{account.name}</div>
            <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--x-color-accent-strong)" }}>RM {money(account.balance)}</div>
          </button>
        ))}
      </div>

      <div style={filterBarStyle}>
        <div style={{ fontWeight: 700, color: "var(--x-color-ink)" }}>
          {ledger ? `${ledger.account.code} ${ledger.account.name} 流水` : "选择账户查看流水"}
        </div>
        {ledger ? (
          <div style={{ fontSize: "13px", color: "var(--x-color-ink-muted)" }}>
            期初 RM {money(ledger.opening_balance)} · 结余 <strong style={{ color: "var(--x-color-accent-strong)" }}>RM {money(ledger.closing_balance)}</strong>
          </div>
        ) : null}
      </div>

      {loadingLedger ? (
        <div style={emptyStyle}>载入流水中…</div>
      ) : !ledger || !ledger.entries.length ? (
        <div style={emptyStyle}>该账户暂无流水</div>
      ) : (
        <div style={tableWrapStyle}>
          <table className="gl-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>凭证号</th>
                <th>摘要</th>
                <th className="gl-num">收入</th>
                <th className="gl-num">支出</th>
                <th className="gl-num">余额</th>
              </tr>
            </thead>
            <tbody>
              {ledger.entries.map((row) => (
                <tr key={row.line_id}>
                  <td style={monoCellStyle}>{row.entry_date}</td>
                  <td style={monoCellStyle}>{row.entry_no}</td>
                  <td>{row.description || row.memo || "—"}</td>
                  <td className="gl-num" style={{ color: row.debit ? "var(--x-color-success)" : undefined }}>{row.debit ? money(row.debit) : "—"}</td>
                  <td className="gl-num" style={{ color: row.credit ? "var(--x-color-danger)" : undefined }}>{row.credit ? money(row.credit) : "—"}</td>
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
  );
}
