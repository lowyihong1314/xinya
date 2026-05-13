import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { ClaimWorkspace } from "./claim/ClaimWorkspace";
import { IncomeWorkspace } from "./income/IncomeWorkspace";
import { RegisterWorkspace } from "./register/RegisterWorkspace";
import { SalesIncomeWorkspace } from "./sales/SalesIncomeWorkspace";
import { SummarizeExpenseWorkspace } from "./summarize_expense/SummarizeExpenseWorkspace";

type FinanceTabKey =
  | "claim_req"
  | "income_req"
  | "register"
  | "summarize_expense"
  | "sales_income";

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
    </>
  );
}
