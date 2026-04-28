import { useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";

import { useUserState } from "../../../app/UserState";
import { CRMNavigationTile } from "../../shared/CRMNavigationTile";
import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { AssetWorkspace } from "./asset/AssetWorkspace";
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
  | "asset"
  | "sales_income";

const FINANCE_TABS: Array<{
  key: FinanceTabKey;
  title: string;
  icon: string;
  description: string;
}> = [
  {
    key: "claim_req",
    title: "报销申请",
    icon: "fa-solid fa-money-bill-wave",
    description: "查看支出申请、提交报销、处理审批详情。",
  },
  {
    key: "register",
    title: "收款审核",
    icon: "fa-solid fa-clipboard-check",
    description: "按报名表查看付款记录，并切换 process、checked、fail。",
  },
  {
    key: "income_req",
    title: "报名收入",
    icon: "fa-solid fa-chart-line",
    description: "只统计 checked 的 RegisPayment，并按活动、表单看收入图表。",
  },
  {
    key: "summarize_expense",
    title: "支出分析",
    icon: "fa-solid fa-chart-pie",
    description: "按活动归类支出，没有活动的申请统一归到未关联活动。",
  },
  {
    key: "asset",
    title: "资产库存",
    icon: "fa-solid fa-boxes-stacked",
    description: "仓库、size 库存、库存单据和流动确认。",
  },
  {
    key: "sales_income",
    title: "销售收入",
    icon: "fa-solid fa-cash-register",
    description: "从仓库库存直接销售或退回，并自动联动库存流水。",
  },
];

function isFinanceTabKey(value: string | null): value is FinanceTabKey {
  return FINANCE_TABS.some((tab) => tab.key === value);
}

export function FinancePage() {
  useEnsureDesignTokens();

  const { isMobile } = useUserState();
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
    <div className="finance-page" style={pageStyle}>
      <section className="finance-page__tabs" style={tabsStyle(isMobile)}>
        {FINANCE_TABS.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <CRMNavigationTile
              key={tab.key}
              onClick={() => {
                const nextParams = new URLSearchParams(searchParams);
                nextParams.set("account_router", tab.key);
                setSearchParams(nextParams);
              }}
              icon={tab.icon}
              title={tab.title}
              description={tab.description}
              active={active}
              isMobile={isMobile}
            />
          );
        })}
      </section>

      <section className="finance-page__workspace" style={workspaceStyle(isMobile)}>
        {activeTab === "claim_req" ? <ClaimWorkspace /> : null}
        {activeTab === "register" ? <RegisterWorkspace /> : null}
        {activeTab === "income_req" ? <IncomeWorkspace /> : null}
        {activeTab === "summarize_expense" ? <SummarizeExpenseWorkspace /> : null}
        {activeTab === "asset" ? <AssetWorkspace /> : null}
        {activeTab === "sales_income" ? <SalesIncomeWorkspace /> : null}
      </section>
    </div>
  );
}

const pageStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
};

function tabsStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(min(100%, 180px), 180px))",
    gap: "14px",
    justifyContent: "start",
  };
}

function workspaceStyle(isMobile: boolean): CSSProperties {
  return {
    minHeight: 0,
    height: isMobile ? "auto" : "800px",
    maxHeight: isMobile ? "none" : "800px",
    overflow: "hidden",
  };
}
