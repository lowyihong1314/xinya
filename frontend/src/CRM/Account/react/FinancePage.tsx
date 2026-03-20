import { useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";

import { useUserState } from "../../../app/UserState";
import { designTokens, ensureDesignTokens } from "../../../theme/designTokens";
import { ClaimWorkspace } from "./claim/ClaimWorkspace";
import { IncomeWorkspace } from "./income/IncomeWorkspace";
import { RegisterWorkspace } from "./register/RegisterWorkspace";
import { SummarizeExpenseWorkspace } from "./summarize_expense/SummarizeExpenseWorkspace";

type FinanceTabKey = "claim_req" | "income_req" | "register" | "summarize_expense";

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
];

function isFinanceTabKey(value: string | null): value is FinanceTabKey {
  return FINANCE_TABS.some((tab) => tab.key === value);
}

export function FinancePage() {
  ensureDesignTokens();

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
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                const nextParams = new URLSearchParams(searchParams);
                nextParams.set("account_router", tab.key);
                setSearchParams(nextParams);
              }}
              style={tabButtonStyle(active, isMobile)}
            >
              <span style={tabIconStyle(active)}>
                <i className={tab.icon} />
              </span>
              <span style={tabCopyStyle}>
                <span style={tabTitleStyle(active)}>{tab.title}</span>
                <span style={tabDescriptionStyle}>{tab.description}</span>
              </span>
            </button>
          );
        })}
      </section>

      <section className="finance-page__workspace" style={workspaceStyle(isMobile)}>
        {activeTab === "claim_req" ? <ClaimWorkspace /> : null}
        {activeTab === "register" ? <RegisterWorkspace /> : null}
        {activeTab === "income_req" ? <IncomeWorkspace /> : null}
        {activeTab === "summarize_expense" ? <SummarizeExpenseWorkspace /> : null}
      </section>
    </div>
  );
}

const colors = designTokens.colors;
const radius = designTokens.radius;

const pageStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
};

function tabsStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "14px",
  };
}

function tabButtonStyle(active: boolean, isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "44px minmax(0, 1fr)" : "52px minmax(0, 1fr)",
    gap: "14px",
    alignItems: "start",
    padding: isMobile ? "14px" : "16px",
    borderRadius: radius.md,
    border: active ? `1px solid ${colors.accentBorder}` : `1px solid ${colors.lineSoft}`,
    background: active
      ? `linear-gradient(145deg, ${colors.accentTint}, ${colors.infoTint})`
      : colors.panelStrong,
    cursor: "pointer",
    textAlign: "left",
  };
}

function tabIconStyle(active: boolean): CSSProperties {
  return {
    width: "52px",
    height: "52px",
    display: "grid",
    placeItems: "center",
    borderRadius: radius.md,
    background: active
      ? `linear-gradient(135deg, ${colors.accent}, ${colors.info})`
      : colors.panelAlt,
    color: active ? colors.panel : colors.ink,
    fontSize: "18px",
  };
}

const tabCopyStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

function tabTitleStyle(active: boolean): CSSProperties {
  return {
    fontSize: "16px",
    fontWeight: 700,
    color: active ? colors.accentStrong : colors.ink,
  };
}

const tabDescriptionStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.55,
  color: colors.inkMuted,
};

function workspaceStyle(isMobile: boolean): CSSProperties {
  return {
    minHeight: 0,
    height: isMobile ? "auto" : "800px",
    maxHeight: isMobile ? "none" : "800px",
    overflow: "hidden",
  };
}
