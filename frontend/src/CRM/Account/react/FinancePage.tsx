import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { ClaimWorkspace } from "./claim/ClaimWorkspace";
import { LedgerWorkspace } from "./gl/LedgerWorkspace";
import { IncomeWorkspace } from "./income/IncomeWorkspace";
import { RegisterWorkspace } from "./register/RegisterWorkspace";
import { SalesIncomeWorkspace } from "./sales/SalesIncomeWorkspace";
import { SummarizeExpenseWorkspace } from "./summarize_expense/SummarizeExpenseWorkspace";

type FinanceTabKey =
  | "claim_req"
  | "income_req"
  | "register"
  | "summarize_expense"
  | "sales_income"
  | "gl"
  | "gl_cash"
  | "gl_accounts"
  | "gl_reports";

const FINANCE_TABS: Array<{
  key: FinanceTabKey;
}> = [
  {
    key: "claim_req",
  },
  {
    key: "register",
  },
  {
    key: "income_req",
  },
  {
    key: "summarize_expense",
  },
  {
    key: "sales_income",
  },
  {
    key: "gl",
  },
  {
    key: "gl_cash",
  },
  {
    key: "gl_accounts",
  },
  {
    key: "gl_reports",
  },
];

function isFinanceTabKey(value: string | null): value is FinanceTabKey {
  return FINANCE_TABS.some((tab) => tab.key === value);
}

export function FinancePage() {
  useEnsureDesignTokens();

  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = useMemo(() => {
    const nextKey = searchParams.get("account_router");
    return isFinanceTabKey(nextKey) ? nextKey : "claim_req";
  }, [searchParams]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextParams.get("account_router") === activeTab) {
      return;
    }
    nextParams.set("account_router", activeTab);
    setSearchParams(nextParams, { replace: true });
  }, [activeTab, searchParams, setSearchParams]);

  return (
    <>
      {activeTab === "claim_req" ? <ClaimWorkspace /> : null}
      {activeTab === "register" ? <RegisterWorkspace /> : null}
      {activeTab === "income_req" ? <IncomeWorkspace /> : null}
      {activeTab === "summarize_expense" ? <SummarizeExpenseWorkspace /> : null}
      {activeTab === "sales_income" ? <SalesIncomeWorkspace /> : null}
      {activeTab === "gl" ? <LedgerWorkspace view="journal" /> : null}
      {activeTab === "gl_cash" ? <LedgerWorkspace view="cash" /> : null}
      {activeTab === "gl_accounts" ? <LedgerWorkspace view="accounts" /> : null}
      {activeTab === "gl_reports" ? <LedgerWorkspace view="reports" /> : null}
    </>
  );
}
