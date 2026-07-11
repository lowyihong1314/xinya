import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import type { CSSProperties } from "react";

import { useUserState } from "../../app/UserState";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import {
  CRM_MODULES,
  type CRMModuleKey,
  buildCRMModulePath,
  buildCRMModuleHref,
} from "./crmModules";

export function CRMPage() {
  useEnsureDesignTokens();

  const { isAuthenticated, openLogin, isMobile } = useUserState();
  const location = useLocation();
  const navigate = useNavigate();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const searchParams = new URLSearchParams(location.search);
  const isMobileHome = isMobile && location.pathname === "/crm/home";
  const activeModule = CRM_MODULES.find((module) => isModulePathActive(location.pathname, module.key)) ?? null;
  const loginRedirectPath = `${location.pathname}${location.search}`;

  if (!isAuthenticated) {
    return (
      <section style={gatePageStyle}>
        <section style={gateStyle(isMobile)}>
          <div style={eyebrowStyle}>CRM Access</div>
          <h1 style={gateTitleStyle}>请先登录后台</h1>
          <p style={gateBodyStyle}>CRM 入口已经切到 React Router，模块切换和状态同步现在由 React 负责。</p>
          <div style={gateActionsStyle}>
            <button type="button" style={primaryButtonStyle} onClick={() => openLogin(loginRedirectPath || "/crm")}>
              打开登录框
            </button>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section style={crmRootStyle(isMobile)}>
      {!isMobile ? (
        <nav style={moduleNavStyle}>
          <div style={navHeaderStyle}>
            <span style={navHeaderKickerStyle}>ERP Console</span>
            <span style={navHeaderTitleStyle}>CRM 工作台</span>
          </div>
          {CRM_MODULES.map((module) => {
            // 「报名表格」并入下面的「特别活动」分组，这里不单独渲染。
            if (module.key === "register") {
              return null;
            }

            const isSpecialEvent = module.key === "event_table";
            const groupKey = isSpecialEvent ? SPECIAL_EVENT_GROUP_KEY : module.key;
            const groupTitle = isSpecialEvent ? "特别活动" : module.title;
            const groupIcon = isSpecialEvent ? "fas fa-star" : module.icon;
            const active = isSpecialEvent
              ? SPECIAL_EVENT_MODULE_KEYS.some((key) => isModulePathActive(location.pathname, key))
              : isModulePathActive(location.pathname, module.key);
            const children = isSpecialEvent
              ? getSpecialEventChildren(location.pathname)
              : getSidebarChildren(module.key, searchParams, active);
            const hasChildren = children.length > 0;
            const expanded = hasChildren && (active || Boolean(expandedGroups[groupKey]));

            if (hasChildren) {
              return (
                <div key={groupKey} style={navGroupStyle(active)}>
                  <button
                    type="button"
                    style={navParentButtonStyle(active, expanded)}
                    aria-expanded={expanded}
                    onClick={() =>
                      setExpandedGroups((current) => ({
                        ...current,
                        [groupKey]: !current[groupKey],
                      }))
                    }
                  >
                    <span style={navIconStyle(active)}>
                      <i className={groupIcon} />
                    </span>
                    <span style={navTextWrapStyle}>
                      <span style={navTitleStyle}>{groupTitle}</span>
                      <span style={navMetaStyle}>{children.length} 个子模块</span>
                    </span>
                    <i className={`fas fa-chevron-${expanded ? "down" : "right"}`} style={navChevronStyle} />
                  </button>
                  {expanded ? (
                    <div style={navChildrenStyle}>
                      {children.map((child) => (
                        <Link
                          key={child.key}
                          to={child.to}
                          title={child.description}
                          aria-label={`${groupTitle} · ${child.title}`}
                          style={navChildLinkStyle(child.active)}
                        >
                          <span style={navChildIconStyle(child.active)}>
                            <i className={child.icon} />
                          </span>
                          <span style={navChildTitleStyle}>{child.title}</span>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            }

            return (
              <Link
                key={module.key}
                to={buildCRMModuleHref(module.key, searchParams)}
                title={module.description}
                aria-label={module.description ? `${module.title} · ${module.description}` : module.title}
                style={navParentLinkStyle(active)}
              >
                <span style={navIconStyle(active)}>
                  <i className={module.icon} />
                </span>
                <span style={navTextWrapStyle}>
                  <span style={navTitleStyle}>{module.title}</span>
                  <span style={navMetaStyle}>模块入口</span>
                </span>
              </Link>
            );
          })}
        </nav>
      ) : null}

      <main style={workspaceStyle(isMobile)}>
        {isMobile && !isMobileHome && activeModule ? (
          <header style={mobileModuleHeaderStyle}>
            <div style={mobileModuleHeaderTopStyle}>
              <button
                type="button"
                onClick={() => navigate("/crm/home")}
                style={mobileBackButtonStyle}
              >
                <i className="fas fa-arrow-left" />
              </button>
              <div style={mobileHeaderCopyStyle}>
                <div style={mobileHeaderTitleStyle}>{activeModule.title}</div>
              </div>
            </div>
          </header>
        ) : null}
        <Outlet />
      </main>
    </section>
  );
}

const gatePageStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
  display: "grid",
  placeItems: "start center",
  padding: "16px",
  background: "var(--x-color-canvas)",
  color: "var(--x-color-ink)",
  fontFamily: "var(--x-font-sans)",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  opacity: 0.72,
};

function crmRootStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "220px minmax(0, 1fr)",
    gap: isMobile ? "0" : "8px",
    alignItems: "start",
    minHeight: "calc(100vh - 60px)",
    background: "var(--x-color-canvas)",
    color: "var(--x-color-ink)",
    fontFamily: "var(--x-font-sans)",
  };
}

const moduleNavStyle: CSSProperties = {
  display: "grid",
  alignContent: "start",
  gap: "4px",
  width: "220px",
  maxWidth: "100%",
  minHeight: "calc(100vh - 60px)",
  justifySelf: "stretch",
  position: "sticky",
  top: "60px",
  padding: "8px 6px",
  borderRight: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  boxShadow: "none",
  boxSizing: "border-box",
};

const navHeaderStyle: CSSProperties = {
  display: "grid",
  gap: "2px",
  padding: "6px 8px 8px",
  borderBottom: "1px solid var(--x-color-line-soft)",
  marginBottom: "2px",
};

const navHeaderKickerStyle: CSSProperties = {
  fontSize: "10px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};

const navHeaderTitleStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

const navGroupStyle = (active: boolean): CSSProperties => ({
  display: "grid",
  gap: "2px",
  padding: 0,
  borderRadius: 0,
  background: active ? "var(--x-color-panel-alt)" : "transparent",
});

const navParentBaseStyle: CSSProperties = {
  width: "100%",
  minHeight: "34px",
  display: "grid",
  gridTemplateColumns: "28px minmax(0, 1fr) 14px",
  gap: "8px",
  alignItems: "center",
  padding: "6px 8px",
  borderRadius: "6px",
  color: "var(--x-color-ink)",
  textDecoration: "none",
  textAlign: "left",
  cursor: "pointer",
  boxSizing: "border-box",
};

function navParentButtonStyle(active: boolean, expanded: boolean): CSSProperties {
  return {
    ...navParentBaseStyle,
    appearance: "none",
    WebkitAppearance: "none",
    border: active || expanded ? "1px solid var(--x-color-accent-border)" : "1px solid transparent",
    borderLeft: active ? "3px solid var(--x-color-accent)" : "3px solid transparent",
    background: active || expanded ? "var(--x-color-accent-tint)" : "transparent",
  };
}

function navParentLinkStyle(active: boolean): CSSProperties {
  return {
    ...navParentBaseStyle,
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid transparent",
    borderLeft: active ? "3px solid var(--x-color-accent)" : "3px solid transparent",
    background: active ? "var(--x-color-accent-tint)" : "transparent",
  };
}

function navIconStyle(active: boolean): CSSProperties {
  return {
    width: "28px",
    height: "28px",
    display: "grid",
    placeItems: "center",
    borderRadius: "6px",
    background: active ? "var(--x-color-accent)" : "var(--x-color-panel-alt)",
    color: active ? "white" : "var(--x-color-ink-muted)",
    fontSize: "12px",
  };
}

const navTextWrapStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: "1px",
};

const navTitleStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.2,
  fontWeight: 800,
  color: "var(--x-color-ink)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const navMetaStyle: CSSProperties = {
  fontSize: "10px",
  lineHeight: 1.15,
  color: "var(--x-color-ink-muted)",
};

const navChevronStyle: CSSProperties = {
  fontSize: "10px",
  color: "var(--x-color-ink-muted)",
};

const navChildrenStyle: CSSProperties = {
  display: "grid",
  gap: "2px",
  padding: "0 0 2px 34px",
};

function navChildLinkStyle(active: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "22px minmax(0, 1fr)",
    gap: "6px",
    alignItems: "center",
    minHeight: "28px",
    padding: "4px 6px",
    borderRadius: "6px",
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid transparent",
    background: active ? "var(--x-color-panel)" : "transparent",
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink)",
    textDecoration: "none",
    boxSizing: "border-box",
  };
}

function navChildIconStyle(active: boolean): CSSProperties {
  return {
    width: "22px",
    height: "22px",
    display: "grid",
    placeItems: "center",
    borderRadius: "5px",
    background: active ? "var(--x-color-accent-tint-strong)" : "transparent",
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)",
    fontSize: "10px",
  };
}

const navChildTitleStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  lineHeight: 1.2,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function workspaceStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    alignContent: "start",
    gap: "8px",
    padding: "8px",
    background: "transparent",
    border: "none",
    boxShadow: "none",
    minWidth: 0,
    boxSizing: "border-box",
  };
}

const mobileModuleHeaderStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  padding: "8px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  boxShadow: "none",
};

const mobileModuleHeaderTopStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  alignItems: "center",
  gap: "8px",
};

const mobileBackButtonStyle: CSSProperties = {
  width: "34px",
  height: "32px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  padding: 0,
  borderRadius: "6px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  fontSize: "13px",
  cursor: "pointer",
  boxShadow: "none",
};

const mobileHeaderCopyStyle: CSSProperties = {
  display: "grid",
  gap: "2px",
  minWidth: 0,
};

const mobileHeaderTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 900,
  lineHeight: 1.1,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function gateStyle(isMobile: boolean): CSSProperties {
  return {
    maxWidth: "520px",
    margin: "24px auto",
    padding: isMobile ? "16px" : "20px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
    boxShadow: "0 1px 2px var(--x-color-shadow-soft)",
  };
}

const gateTitleStyle: CSSProperties = {
  margin: "8px 0 8px",
  fontSize: "24px",
  color: "var(--x-color-ink)",
};

const gateBodyStyle: CSSProperties = {
  margin: 0,
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

const gateActionsStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  marginTop: "14px",
  flexWrap: "wrap",
};

const primaryButtonStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: "6px",
  border: "none",
  background: "var(--x-color-accent)",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

type SidebarChild = {
  active: boolean;
  description: string;
  icon: string;
  key: string;
  title: string;
  to: string;
};

const FINANCE_CHILD_ITEMS = [
  {
    key: "claim_req",
    title: "报销申请",
    icon: "fa-solid fa-money-bill-wave",
    description: "支出申请、审批与付款凭证。",
  },
  {
    key: "register",
    title: "收款审核",
    icon: "fa-solid fa-clipboard-check",
    description: "报名 / 会员 / 青少年佛学班付款审核。",
  },
  {
    key: "income_req",
    title: "报名收入",
    icon: "fa-solid fa-chart-line",
    description: "报名收入统计。",
  },
  {
    key: "summarize_expense",
    title: "支出分析",
    icon: "fa-solid fa-chart-pie",
    description: "活动支出汇总分析。",
  },
  {
    key: "sales_income",
    title: "销售收入",
    icon: "fa-solid fa-cash-register",
    description: "库存销售与退回。",
  },
] as const;

const ASSET_CHILD_ITEMS = [
  {
    key: "master",
    title: "基础资料",
    icon: "fa-solid fa-database",
    description: "仓库、Item、规格和往来对象。",
  },
  {
    key: "documents",
    title: "库存单据",
    icon: "fa-solid fa-file-invoice",
    description: "入库、出库、调拨和调整单据。",
  },
  {
    key: "inventory",
    title: "库存明细",
    icon: "fa-solid fa-warehouse",
    description: "按仓库和规格查看库存。",
  },
  {
    key: "low_stock",
    title: "低库存",
    icon: "fa-solid fa-triangle-exclamation",
    description: "低于安全库存的规格。",
  },
  {
    key: "item_summary",
    title: "品项汇总",
    icon: "fa-solid fa-chart-simple",
    description: "按 Item 汇总库存数量。",
  },
  {
    key: "movements",
    title: "库存流水",
    icon: "fa-solid fa-clock-rotate-left",
    description: "确认单据后的库存流动记录。",
  },
] as const;

const USER_CONTROL_CHILD_ITEMS = [
  {
    key: "members",
    title: "用户管理",
    icon: "fa-solid fa-id-badge",
    description: "用户名片、资料编辑与会员续费。",
  },
  {
    key: "departments",
    title: "部门管理",
    icon: "fa-solid fa-sitemap",
    description: "部门、权限与成员维护。",
  },
] as const;

const PERMANENT_REGISTRATION_CHILD_ITEMS = [
  {
    key: "membership",
    title: "会员",
    icon: "fa-solid fa-id-card",
    description: "会员报名、续费与费率审核。",
  },
  {
    key: "youth_class",
    title: "青少年佛学班",
    icon: "fa-solid fa-graduation-cap",
    description: "青少年佛学班报名与付款审核。",
  },
] as const;

function isModulePathActive(pathname: string, moduleKey: CRMModuleKey) {
  if (pathname === buildCRMModulePath(moduleKey)) {
    return true;
  }
  if (moduleKey === "permanent_registration") {
    return (
      pathname === "/crm/permanent_registration" ||
      pathname === "/crm/membership_registration" ||
      pathname === "/crm/youth_class_registration"
    );
  }
  return false;
}

function buildPathWithParams(pathname: string, params: Record<string, string>) {
  const nextParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    nextParams.set(key, value);
  }
  const query = nextParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export const SPECIAL_EVENT_GROUP_KEY = "special_event";
export const SPECIAL_EVENT_MODULE_KEYS: CRMModuleKey[] = ["event_table", "register"];
const SPECIAL_EVENT_CHILD_ICONS: Partial<Record<CRMModuleKey, string>> = {
  event_table: "fa-solid fa-calendar-plus",
  register: "fa-solid fa-clipboard-list",
};

// 「特别活动」分组：把 创建活动 + 报名表格 两个模块作为子项，各自链接到自己的路由。
function getSpecialEventChildren(pathname: string): SidebarChild[] {
  return SPECIAL_EVENT_MODULE_KEYS.map((key) => {
    const module = CRM_MODULES.find((item) => item.key === key);
    return {
      key,
      title: module?.title ?? key,
      icon: SPECIAL_EVENT_CHILD_ICONS[key] ?? module?.icon ?? "fa-solid fa-circle",
      description: module?.description ?? "",
      to: buildCRMModulePath(key),
      active: isModulePathActive(pathname, key),
    };
  });
}

export function getSidebarChildren(
  moduleKey: CRMModuleKey,
  searchParams: URLSearchParams,
  moduleActive: boolean,
): SidebarChild[] {
  if (moduleKey === "dharma_event") {
    const workspace = searchParams.get("fahui_workspace");
    const view = searchParams.get("fahui_view");
    const fahuiPath = buildCRMModulePath("dharma_event");
    return [
      {
        key: "ylp",
        title: "盂兰盆",
        icon: "fa-solid fa-table-list",
        description: "盂兰盆订单查询与付款审核。",
        to: buildPathWithParams(fahuiPath, {
          fahui_view: "workspace",
          fahui_workspace: "ylp",
          fahui_section: "orders",
        }),
        active: moduleActive && (workspace === "ylp" || view === "ylp_order"),
      },
      {
        key: "lamp",
        title: "点灯",
        icon: "fa-solid fa-lightbulb",
        description: "点灯付款审核。",
        to: buildPathWithParams(fahuiPath, {
          fahui_view: "workspace",
          fahui_workspace: "lamp",
          fahui_section: "payments",
        }),
        active: moduleActive && workspace === "lamp",
      },
    ];
  }

  if (moduleKey === "finance") {
    const activeFinanceKey = searchParams.get("account_router") || "claim_req";
    const financePath = buildCRMModulePath("finance");
    return FINANCE_CHILD_ITEMS.map((item) => ({
      ...item,
      to: buildPathWithParams(financePath, { account_router: item.key }),
      active: moduleActive && activeFinanceKey === item.key,
    }));
  }

  if (moduleKey === "asset") {
    const requestedAssetKey = searchParams.get("asset_panel");
    const activeAssetKey = ASSET_CHILD_ITEMS.some((item) => item.key === requestedAssetKey)
      ? requestedAssetKey
      : "master";
    const assetPath = buildCRMModulePath("asset");
    return ASSET_CHILD_ITEMS.map((item) => ({
      ...item,
      to: buildPathWithParams(assetPath, { asset_panel: item.key }),
      active: moduleActive && activeAssetKey === item.key,
    }));
  }

  if (moduleKey === "user_control") {
    const requestedUserControlView = searchParams.get("user_control_view");
    const activeUserControlView = USER_CONTROL_CHILD_ITEMS.some(
      (item) => item.key === requestedUserControlView,
    )
      ? requestedUserControlView
      : "members";
    const userControlPath = buildCRMModulePath("user_control");
    return USER_CONTROL_CHILD_ITEMS.map((item) => ({
      ...item,
      to: buildPathWithParams(userControlPath, { user_control_view: item.key }),
      active: moduleActive && activeUserControlView === item.key,
    }));
  }

  if (moduleKey === "permanent_registration") {
    const requestedRegistrationSection = searchParams.get("registration_section");
    const activeRegistrationSection = PERMANENT_REGISTRATION_CHILD_ITEMS.some(
      (item) => item.key === requestedRegistrationSection,
    )
      ? requestedRegistrationSection
      : "membership";
    const registrationPath = buildCRMModulePath("permanent_registration");
    return PERMANENT_REGISTRATION_CHILD_ITEMS.map((item) => ({
      ...item,
      to: buildPathWithParams(registrationPath, { registration_section: item.key }),
      active: moduleActive && activeRegistrationSection === item.key,
    }));
  }

  return [];
}
