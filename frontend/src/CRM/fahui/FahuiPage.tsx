import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useEnsureDesignTokens } from "../../theme/designTokens";
import { useUserState } from "../../app/UserState";
import { getUserPermissionNames } from "../../app/permissions";
import { CachedImage } from "../../components/CachedMedia";
import { showConfirmDialog } from "../../js/dialogs";
import { copyTextToClipboard, downloadBlobOrShare, downloadUrlOrShare } from "../../js/browserActions";
import { correctPhoneInputMY } from "../../js/phone";
import { show_alert } from "../../js/show_alert";
import { LAMP_META } from "../../lamp/lampMeta";
import { useOptionalAppChrome } from "../../router/AppChromeContext";
import { LampWorkspacePage } from "../lamp/react/LampWorkspacePage";
import { PaymentChannelModal } from "./PaymentChannelModal";
import { RelationOptionModal } from "./RelationOptionModal";
import { OpenWindowModal } from "./OpenWindowModal";
import { PrintRecordsModal } from "./PrintRecordsModal";
import {
  approvePayment,
  copyYlpOrdersToCurrent,
  createYlpOrderItem,
  createYlpOrderPayment,
  createYlpShareLink,
  deleteYlpOrderItem,
  deleteYlpOrdersBatch,
  downloadYlpReceiptImage,
  downloadYlpPaiwei,
  fetchPayments,
  fetchYlpOrderDetail,
  fetchYlpPayments,
  fetchYlpVersions,
  fetchYlpVersionEvent,
  setYlpVersionEvent,
  downloadYlpPaiweiJob,
  getYlpPaiweiJobStatus,
  listYlpOrdersForExport,
  listYlpRelationOptions,
  startYlpPaiweiJob,
  withdrawPayment,
  removePayment,
  revokePayment,
  searchYlpOrders,
  updateYlpOrderCustomer,
  updateYlpOrderItem,
  updateYlpOrderStatus,
} from "./api";
import { showEventPicker } from "../shared/showEventPicker";
import { PaiweiPreviewGrid } from "./PaiweiPreview";
import { YlpDrawer } from "./YlpDrawer";
import { YlpItemModal } from "./YlpItemModal";
import { YlpPaymentModal } from "./YlpPaymentModal";
import { YlpOrderSummaryDrawer } from "./YlpOrderSummaryDrawer";
import { YlpAnalyticsPanel } from "./YlpAnalyticsPanel";
import { showPrintPlusDialog } from "./PrintPlusDialog";
import { PaymentProofButton } from "./PaymentProof";
import { PaiweiEditorModal } from "./intake/PaiweiEditorModal";
import { paiweiFieldLabel } from "./intake/paiwei";
import { buildYlpOrdersWorkbookBlob } from "./exportXlsx";
import { orderStatusLabel, paymentStatusLabel } from "./orderStatus";
import { connectFahuiSocket } from "./socket";
import type {
  PaymentRecord,
  RegistrationRecord,
  YlpOrderDetail,
  YlpOrderItem,
  YlpOrderSummary,
  YlpPagination,
  YlpPaymentRecord,
  YlpVersionEventBinding,
} from "./types";

const PAGE_SIZE = 8;
const YLP_ORDER_PAGE_SIZE = 15;

// 版本即年份（2025_YLP ↔ 2025 年）；只有今年版本的订单可以修改，历史版本只读、只能复制到今年。
const CURRENT_YLP_VERSION = `${new Date().getFullYear()}_YLP`;

function isCurrentYlpVersion(version?: string | null): boolean {
  return String(version || "") === CURRENT_YLP_VERSION;
}

type WorkspaceTab = "lamp" | "ylp";
type WorkspaceSection = "payments" | "orders" | "analysis";
type WorkspaceStateValue<T> = Record<WorkspaceTab, T>;

type ScreenState =
  | { kind: "workspace"; workspace: WorkspaceTab; section: WorkspaceSection }
  | { kind: "payment-detail"; workspace: WorkspaceTab; paymentId: number }
  | { kind: "ylp-order-detail"; orderId: number };

type YlpDetailState = {
  orderId: number;
  loading: boolean;
  error: string;
  order: YlpOrderDetail | null;
  payments: YlpPaymentRecord[];
  paymentsError: string;
};

type FahuiRouteState = {
  screen: ScreenState;
  paymentQueryByWorkspace: WorkspaceStateValue<string>;
  paymentPageByWorkspace: WorkspaceStateValue<number>;
  ylpVersion: string;
  ylpQuery: string;
  ylpPage: number;
};

const FAHUI_ROUTE_PARAM_KEYS = [
  "fahui_view",
  "fahui_workspace",
  "fahui_section",
  "fahui_payment_id",
  "fahui_order_id",
  "fahui_lamp_query",
  "fahui_lamp_page",
  "fahui_ylp_payment_query",
  "fahui_ylp_payment_page",
  "fahui_ylp_order_query",
  "fahui_ylp_order_page",
  "fahui_ylp_version",
] as const;

function getPaymentRecordId(payment: PaymentRecord) {
  return payment.id ?? payment.payment_id;
}

function isPaymentApproved(payment: PaymentRecord) {
  return payment.is_approved ?? Boolean(payment.submitter_id);
}

function getPaymentTypeLabel(payment: PaymentRecord) {
  return payment.type === "ylp" ? "YLP" : "Lamp";
}

function getPaymentPrimaryText(payment: PaymentRecord) {
  if (payment.type === "ylp") {
    return payment.payer_name || payment.order?.customer_name || payment.order?.name || "盂兰盆付款";
  }
  return payment.payer_name || "点灯付款";
}

function getPaymentSecondaryText(payment: PaymentRecord) {
  if (payment.type === "ylp") {
    const parts = [
      payment.order_id || payment.order?.id ? `订单 #${payment.order_id || payment.order?.id}` : null,
      payment.phone || payment.order?.phone || null,
      payment.order?.version || null,
    ].filter(Boolean);
    return parts.join(" · ") || "暂无订单信息";
  }

  return (
    (payment.registrations || [])
      .map((registration) => registration.devotee_name)
      .filter(Boolean)
      .join("、") || "暂无祈福者信息"
  );
}

function matchesPaymentWorkspace(payment: PaymentRecord, workspace: WorkspaceTab) {
  if (workspace === "ylp") {
    return payment.type === "ylp";
  }
  return payment.type !== "ylp";
}

function matchesPaymentQuery(payment: PaymentRecord, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  if ((payment.phone || "").toLowerCase().includes(normalizedQuery)) {
    return true;
  }

  if ((payment.payer_name || "").toLowerCase().includes(normalizedQuery)) {
    return true;
  }

  if ((payment.type || "").toLowerCase().includes(normalizedQuery)) {
    return true;
  }

  if (String(payment.order_id || payment.order?.id || "").includes(normalizedQuery)) {
    return true;
  }

  if ((payment.order?.customer_name || "").toLowerCase().includes(normalizedQuery)) {
    return true;
  }

  if ((payment.order?.name || "").toLowerCase().includes(normalizedQuery)) {
    return true;
  }

  if ((payment.order?.phone || "").toLowerCase().includes(normalizedQuery)) {
    return true;
  }

  return (payment.registrations || []).some((registration) =>
    (registration.devotee_name || "").toLowerCase().includes(normalizedQuery),
  );
}

function getWorkspaceDescription(workspace: WorkspaceTab) {
  return workspace === "ylp"
    ? "先锁定盂兰盆，再切到付款审核或订单查询。"
    : "Lamp 这边先聚焦在付款审核，流程保持轻一点。";
}

function getWorkspaceEyebrow(workspace: WorkspaceTab) {
  return workspace === "ylp" ? "YLP" : "LAMP";
}

function getSectionTitle(workspace: WorkspaceTab, section: WorkspaceSection) {
  if (workspace === "ylp" && section === "analysis") {
    return "数据统计";
  }
  if (workspace === "ylp" && section === "orders") {
    return "订单查询";
  }
  return "付款审核";
}

function getSectionDescription(workspace: WorkspaceTab, section: WorkspaceSection) {
  if (workspace === "ylp" && section === "analysis") {
    return "整个版本的订单、牌位和收款汇总，口径与导出 xlsx 一致。";
  }
  if (workspace === "ylp" && section === "orders") {
    return "按版本和关键字查订单，点进去直接看详情。";
  }
  return workspace === "ylp"
    ? "只看 YLP 付款记录，审核和撤销都在详情页完成。"
    : "只看 Lamp 付款记录，卡片进去就是详情页。";
}

function getPaymentStatusLabel(payment: PaymentRecord) {
  return isPaymentApproved(payment) ? "已审核" : "待审核";
}

function getValueText(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

function isWorkspaceTab(value: string | null): value is WorkspaceTab {
  return value === "lamp" || value === "ylp";
}

function isWorkspaceSection(value: string | null): value is WorkspaceSection {
  return value === "payments" || value === "orders" || value === "analysis";
}

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function screensEqual(left: ScreenState, right: ScreenState) {
  if (left.kind !== right.kind) {
    return false;
  }

  switch (left.kind) {
    case "workspace":
      return left.workspace === (right as Extract<ScreenState, { kind: "workspace" }>).workspace &&
        left.section === (right as Extract<ScreenState, { kind: "workspace" }>).section;
    case "payment-detail":
      return left.workspace === (right as Extract<ScreenState, { kind: "payment-detail" }>).workspace &&
        left.paymentId === (right as Extract<ScreenState, { kind: "payment-detail" }>).paymentId;
    case "ylp-order-detail":
      return left.orderId === (right as Extract<ScreenState, { kind: "ylp-order-detail" }>).orderId;
    default:
      return false;
  }
}

function workspaceStateEqual<T>(left: WorkspaceStateValue<T>, right: WorkspaceStateValue<T>) {
  return left.lamp === right.lamp && left.ylp === right.ylp;
}

function parseFahuiRouteState(search: string): FahuiRouteState {
  const params = new URLSearchParams(search);
  const view = params.get("fahui_view");
  const workspace = params.get("fahui_workspace");
  const section = params.get("fahui_section");
  const paymentId = parsePositiveInt(params.get("fahui_payment_id"), 0);
  const orderId = parsePositiveInt(params.get("fahui_order_id"), 0);

  // 法会付款审核已移至「财政 · 收款审核」；这里只保留订单查询。
  let screen: ScreenState = { kind: "workspace", workspace: "ylp", section: "orders" };
  if (view === "ylp_order" && orderId > 0) {
    screen = { kind: "ylp-order-detail", orderId };
  } else if (view === "workspace" && isWorkspaceTab(workspace)) {
    // 付款审核搬走了，剩下的两个 section：订单列表 orders / 数据统计 analysis
    screen = { kind: "workspace", workspace, section: section === "analysis" ? "analysis" : "orders" };
  }

  return {
    screen,
    paymentQueryByWorkspace: {
      lamp: params.get("fahui_lamp_query") || "",
      ylp: params.get("fahui_ylp_payment_query") || "",
    },
    paymentPageByWorkspace: {
      lamp: parsePositiveInt(params.get("fahui_lamp_page"), 1),
      ylp: parsePositiveInt(params.get("fahui_ylp_payment_page"), 1),
    },
    ylpVersion: params.get("fahui_ylp_version") || "",
    ylpQuery: params.get("fahui_ylp_order_query") || "",
    ylpPage: parsePositiveInt(params.get("fahui_ylp_order_page"), 1),
  };
}

function buildFahuiSearchParams(
  baseSearch: string,
  routeState: FahuiRouteState,
) {
  const params = new URLSearchParams(baseSearch);

  for (const key of FAHUI_ROUTE_PARAM_KEYS) {
    params.delete(key);
  }

  if (routeState.screen.kind === "workspace") {
    params.set("fahui_view", "workspace");
    params.set("fahui_workspace", routeState.screen.workspace);
    params.set("fahui_section", routeState.screen.section);
  } else if (routeState.screen.kind === "payment-detail") {
    params.set("fahui_view", "payment");
    params.set("fahui_workspace", routeState.screen.workspace);
    params.set("fahui_payment_id", String(routeState.screen.paymentId));
  } else if (routeState.screen.kind === "ylp-order-detail") {
    params.set("fahui_view", "ylp_order");
    params.set("fahui_workspace", "ylp");
    params.set("fahui_order_id", String(routeState.screen.orderId));
  }

  if (routeState.paymentQueryByWorkspace.lamp) {
    params.set("fahui_lamp_query", routeState.paymentQueryByWorkspace.lamp);
  }
  if (routeState.paymentPageByWorkspace.lamp > 1) {
    params.set("fahui_lamp_page", String(routeState.paymentPageByWorkspace.lamp));
  }
  if (routeState.paymentQueryByWorkspace.ylp) {
    params.set("fahui_ylp_payment_query", routeState.paymentQueryByWorkspace.ylp);
  }
  if (routeState.paymentPageByWorkspace.ylp > 1) {
    params.set("fahui_ylp_payment_page", String(routeState.paymentPageByWorkspace.ylp));
  }
  if (routeState.ylpQuery) {
    params.set("fahui_ylp_order_query", routeState.ylpQuery);
  }
  if (routeState.ylpPage > 1) {
    params.set("fahui_ylp_order_page", String(routeState.ylpPage));
  }
  if (routeState.ylpVersion) {
    params.set("fahui_ylp_version", routeState.ylpVersion);
  }

  return params;
}

type YlpSortKey = "status" | "order_status" | "id" | "customer" | "phone" | "total" | "maintainer" | "created_at";

// 工作区标题栏右边那组 tab：订单列表 ↔ 数据统计（对应 URL 的 fahui_section）
const YLP_SECTION_TABS: { key: Extract<WorkspaceSection, "orders" | "analysis">; label: string }[] = [
  { key: "orders", label: "订单列表" },
  { key: "analysis", label: "数据统计" },
];

const YLP_ORDER_COLUMNS: { key: YlpSortKey; label: string }[] = [
  // 两个状态分开列：订单流程 vs 付款汇总，之前只显示后者、表头却写「状态」，很容易误读
  { key: "order_status", label: "订单" },
  { key: "status", label: "付款" },
  { key: "id", label: "单号" },
  { key: "customer", label: "功德主" },
  { key: "phone", label: "电话" },
  { key: "total", label: "总额 (RM)" },
  // 维护人 / 创建时间不在列表里显示了：横向太挤，右侧抽屉要位置。
  // 两者仍在订单摘要抽屉、订单详情页和导出 xlsx 里，后端也照旧支持这两个 sort key。
];

export function FahuiPage() {
  useEnsureDesignTokens();

  const location = useLocation();
  const navigate = useNavigate();
  const { user, isMobile } = useUserState();
  // 顶部导航条是 sticky 的，右侧面板贴顶/算高度都要把它让出来（导航条藏起来时测得 0）。
  const navbarHeight = useOptionalAppChrome()?.navbarHeight ?? 60;
  // 审核付款要 account_edit，和后端 /api/payment/review/* 的权限一致
  const canReviewPayment = useMemo(() => getUserPermissionNames(user).has("account_edit"), [user]);
  const initialRouteState = parseFahuiRouteState(location.search);
  const [screen, setScreen] = useState<ScreenState>(initialRouteState.screen);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentQueryByWorkspace, setPaymentQueryByWorkspace] = useState<WorkspaceStateValue<string>>(
    initialRouteState.paymentQueryByWorkspace,
  );
  const [paymentPageByWorkspace, setPaymentPageByWorkspace] = useState<WorkspaceStateValue<number>>(
    initialRouteState.paymentPageByWorkspace,
  );
  const [paymentLoading, setPaymentLoading] = useState(true);
  const [paymentError, setPaymentError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [ylpVersions, setYlpVersions] = useState<string[]>([]);
  // 当前版本绑定的活动（绑定后该版本收入会进活动预算）
  const [versionEvent, setVersionEvent] = useState<YlpVersionEventBinding | null>(null);
  const [versionEventBusy, setVersionEventBusy] = useState(false);
  const [ylpVersion, setYlpVersion] = useState(initialRouteState.ylpVersion);
  const [ylpQueryInput, setYlpQueryInput] = useState(initialRouteState.ylpQuery);
  const [ylpQuery, setYlpQuery] = useState(initialRouteState.ylpQuery);
  const [ylpPage, setYlpPage] = useState(initialRouteState.ylpPage);
  const [ylpLoading, setYlpLoading] = useState(false);
  const [ylpError, setYlpError] = useState("");
  const [ylpOrders, setYlpOrders] = useState<YlpOrderSummary[]>([]);
  const [ylpSort, setYlpSort] = useState<{ key: YlpSortKey; dir: "asc" | "desc" } | null>(null);
  const [ylpSelected, setYlpSelected] = useState<number[]>([]);
  const [ylpSelectAllPages, setYlpSelectAllPages] = useState(false);
  const [ylpBulkBusy, setYlpBulkBusy] = useState(false);
  const [printPlusMenuOpen, setPrintPlusMenuOpen] = useState(false);
  const [ylpRowMenu, setYlpRowMenu] = useState<{ orderId: number; x: number; y: number } | null>(null);
  const [ylpRowBusy, setYlpRowBusy] = useState(false);
  const [ylpRowPreview, setYlpRowPreview] = useState<{ orderId: number } | null>(null);
  // 列表点行弹出的摘要：只记订单号，内容与编辑能力全交给共享的 YlpOrderSummaryDrawer
  // 记住「上一次自动打开抽屉用的是哪一组查询条件」，见 loadYlpOrders
  const ylpAutoOpenRef = useRef<string>("");
  // 键盘上下键翻页时，新一页要选头还是选尾（往下翻选头、往上翻选尾）
  const ylpPendingSelectRef = useRef<"first" | "last" | null>(null);
  const [ylpRowDetailId, setYlpRowDetailId] = useState<number | null>(null);
  const [paiweiJob, setPaiweiJob] = useState<{ percent: number; status: "running" | "done" | "error"; message?: string } | null>(null);
  const paiweiPollRef = useRef<number | null>(null);
  const [ylpPagination, setYlpPagination] = useState<YlpPagination | null>(null);
  const [ylpDetail, setYlpDetail] = useState<YlpDetailState | null>(null);
  const [orderForm, setOrderForm] = useState({ customer_name: "", phone: "", email: "" });
  const [orderSaving, setOrderSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [itemModal, setItemModal] = useState<{ item: YlpOrderItem | null } | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  // 预览牌位统一走 PaiweiPreviewGrid（后端裁好的单张图），这里只记要看哪张订单
  const [paiweiPreviewOrderId, setPaiweiPreviewOrderId] = useState<number | null>(null);
  const [intakeDrawerOpen, setIntakeDrawerOpen] = useState(false);
  const [paymentConfigOpen, setPaymentConfigOpen] = useState(false);
  const [relationConfigOpen, setRelationConfigOpen] = useState(false);
  const [openWindowConfigOpen, setOpenWindowConfigOpen] = useState(false);
  const [printRecordsOpen, setPrintRecordsOpen] = useState(false);
  const [relationOptions, setRelationOptions] = useState<string[]>([]);

  const currentWorkspace =
    screen.kind === "workspace" || screen.kind === "payment-detail" ? screen.workspace : screen.kind === "ylp-order-detail" ? "ylp" : null;
  const currentSection =
    screen.kind === "workspace" ? screen.section : screen.kind === "payment-detail" ? "payments" : screen.kind === "ylp-order-detail" ? "orders" : null;
  const paymentQuery = currentWorkspace ? paymentQueryByWorkspace[currentWorkspace] : "";
  const normalizedPaymentQuery = paymentQuery.trim().toLowerCase();
  const workspacePayments = currentWorkspace
    ? payments.filter(
        (payment) =>
          matchesPaymentWorkspace(payment, currentWorkspace) && matchesPaymentQuery(payment, normalizedPaymentQuery),
      )
    : [];
  const paymentTotalPages = Math.max(1, Math.ceil(workspacePayments.length / PAGE_SIZE));
  const paymentPage = currentWorkspace ? paymentPageByWorkspace[currentWorkspace] : 1;
  const safePaymentPage = Math.min(paymentPage, paymentTotalPages);
  const pagedPayments = workspacePayments.slice((safePaymentPage - 1) * PAGE_SIZE, safePaymentPage * PAGE_SIZE);
  const ylpTotalPages = Math.max(1, ylpPagination?.pages || 1);
  const ylpSafePage = Math.min(ylpPage, ylpTotalPages);
  const selectedPayment =
    screen.kind === "payment-detail"
      ? payments.find((item) => getPaymentRecordId(item) === screen.paymentId) || null
      : null;
  useEffect(() => {
    const nextRouteState = parseFahuiRouteState(location.search);

    setScreen((current) => (screensEqual(current, nextRouteState.screen) ? current : nextRouteState.screen));
    setPaymentQueryByWorkspace((current) =>
      workspaceStateEqual(current, nextRouteState.paymentQueryByWorkspace)
        ? current
        : nextRouteState.paymentQueryByWorkspace,
    );
    setPaymentPageByWorkspace((current) =>
      workspaceStateEqual(current, nextRouteState.paymentPageByWorkspace)
        ? current
        : nextRouteState.paymentPageByWorkspace,
    );
    setYlpQuery((current) => (current === nextRouteState.ylpQuery ? current : nextRouteState.ylpQuery));
    setYlpQueryInput((current) => (current === nextRouteState.ylpQuery ? current : nextRouteState.ylpQuery));
    setYlpPage((current) => (current === nextRouteState.ylpPage ? current : nextRouteState.ylpPage));
    setYlpVersion((current) => {
      if (!nextRouteState.ylpVersion || current === nextRouteState.ylpVersion) {
        return current;
      }
      return nextRouteState.ylpVersion;
    });
  }, [location.search]);

  // 选中订单后，上下键直接换上一张 / 下一张；走到头就自动翻页。
  // 只在订单列表页 + 抽屉开着的时候生效，输入框里打字不抢键。
  useEffect(() => {
    if (screen.kind !== "workspace" || screen.section !== "orders" || ylpRowDetailId == null) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = (target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
        return;
      }
      const ids = ylpOrders.map((order) => order.id);
      const index = ids.indexOf(ylpRowDetailId as number);
      if (index === -1) {
        return;
      }
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = index + step;
      if (next >= 0 && next < ids.length) {
        openYlpRowDetail(ids[next]);
        return;
      }
      // 到底 / 到顶：翻页，新一页由 loadYlpOrders 按 pending 选头或选尾
      if (step > 0 && ylpSafePage < ylpTotalPages) {
        ylpPendingSelectRef.current = "first";
        setYlpPage(ylpSafePage + 1);
      } else if (step < 0 && ylpSafePage > 1) {
        ylpPendingSelectRef.current = "last";
        setYlpPage(ylpSafePage - 1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [screen, ylpRowDetailId, ylpOrders, ylpSafePage, ylpTotalPages]);

  // 键盘换订单时把选中行滚进视野（鼠标点的那次滚动是多余的，但无害）
  useEffect(() => {
    if (ylpRowDetailId == null) {
      return;
    }
    document
      .querySelector(`[data-ylp-order-row="${ylpRowDetailId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [ylpRowDetailId]);

  // 行操作菜单是 fixed 定位的，页面一动（滚动/缩放）或点到别处就关掉。
  useEffect(() => {
    if (!ylpRowMenu) {
      return;
    }
    const close = () => setYlpRowMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("click", close);
    // 右键点到别处（包括别的行，那边会先 stopPropagation 换成自己的菜单）也要收起来。
    window.addEventListener("contextmenu", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [ylpRowMenu]);

  useEffect(() => {
    const nextSearchParams = buildFahuiSearchParams(location.search, {
      screen,
      paymentQueryByWorkspace,
      paymentPageByWorkspace,
      ylpVersion,
      ylpQuery,
      ylpPage,
    });
    const nextSearch = nextSearchParams.toString();
    const currentSearch = location.search.replace(/^\?/, "");

    if (nextSearch === currentSearch) {
      return;
    }

    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
      },
      { replace: true },
    );
  }, [
    location.pathname,
    location.search,
    navigate,
    paymentPageByWorkspace,
    paymentQueryByWorkspace,
    screen,
    ylpPage,
    ylpQuery,
    ylpVersion,
  ]);

  useEffect(() => {
    void loadYlpVersions();
  }, []);

  // 加载超度亡灵关系选项（关闭配置弹窗后刷新，保证新增/移除即时生效）。
  useEffect(() => {
    if (relationConfigOpen) {
      return;
    }
    listYlpRelationOptions()
      .then((res) => setRelationOptions((res.data || []).map((option) => option.label)))
      .catch(() => setRelationOptions([]));
  }, [relationConfigOpen]);

  useEffect(() => {
    if (screen.kind !== "workspace" || screen.workspace !== "ylp" || screen.section !== "orders" || !ylpVersion) {
      return;
    }
    void loadYlpOrders();
  }, [screen, ylpPage, ylpQuery, ylpVersion, ylpSort]);

  // 手机预览抽屉（或任何入口）提交新订单时，列表即时刷新插入，无需手动刷新。
  useEffect(() => {
    if (screen.kind !== "workspace" || screen.workspace !== "ylp" || screen.section !== "orders") {
      return;
    }
    const socket = connectFahuiSocket();
    socket.on("fahui:order_created", (payload: { order?: { version?: string } }) => {
      const version = payload?.order?.version;
      if (!version || version === ylpVersion) {
        void loadYlpOrders();
      }
    });
    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, ylpPage, ylpQuery, ylpVersion, ylpSort]);

  // 搜索框输入即搜（防抖 350ms），不再需要搜索按钮。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = ylpQueryInput.trim();
      setYlpQuery((current) => {
        if (current !== next) {
          setYlpPage(1);
        }
        return next;
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [ylpQueryInput]);

  useEffect(() => {
    if (!actionMessage) {
      return;
    }

    const timer = window.setTimeout(() => setActionMessage(""), 2400);
    return () => window.clearTimeout(timer);
  }, [actionMessage]);

  useEffect(() => {
    if (!currentWorkspace) {
      return;
    }

    if (paymentPageByWorkspace[currentWorkspace] !== safePaymentPage) {
      setPaymentPageByWorkspace((current) => ({
        ...current,
        [currentWorkspace]: safePaymentPage,
      }));
    }
  }, [currentWorkspace, paymentPageByWorkspace, safePaymentPage]);

  useEffect(() => {
    if (ylpPage !== ylpSafePage) {
      setYlpPage(ylpSafePage);
    }
  }, [ylpPage, ylpSafePage]);

  useEffect(() => {
    if (screen.kind !== "payment-detail" || paymentLoading) {
      return;
    }

    if (!selectedPayment) {
      setScreen({
        kind: "workspace",
        workspace: screen.workspace,
        section: "payments",
      });
    }
  }, [paymentLoading, screen, selectedPayment]);

  useEffect(() => {
    if (screen.kind !== "ylp-order-detail") {
      return;
    }
    if (ylpDetail?.orderId === screen.orderId) {
      return;
    }
    void loadYlpDetail(screen.orderId);
  }, [screen, ylpDetail]);

  useEffect(() => {
    const order = ylpDetail?.order;
    setOrderForm({
      customer_name: order?.customer_name || order?.name || "",
      phone: order?.phone || "",
      email: order?.email || "",
    });
    setItemModal(null);
    setPaiweiPreviewOrderId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ylpDetail?.order?.id]);

  async function loadPayments() {
    setPaymentLoading(true);
    setPaymentError("");

    try {
      const response = await fetchPayments();
      setPayments(response.data || []);
    } catch (loadError) {
      setPaymentError(loadError instanceof Error ? loadError.message : "加载失败");
    } finally {
      setPaymentLoading(false);
    }
  }

  async function loadYlpVersions() {
    try {
      const response = await fetchYlpVersions();
      const fetched = (response.data || []).filter(Boolean);
      // 今年版本始终在下拉里（哪怕还没有订单），并作为默认选中。
      const versions = fetched.includes(CURRENT_YLP_VERSION) ? fetched : [CURRENT_YLP_VERSION, ...fetched];

      setYlpVersions(versions);
      setYlpVersion((current) => current || CURRENT_YLP_VERSION);
    } catch (loadError) {
      setYlpError(loadError instanceof Error ? loadError.message : "版本加载失败");
    }
  }

  async function loadYlpOrders() {
    setYlpLoading(true);
    setYlpError("");

    try {
      const response = await searchYlpOrders({
        version: ylpVersion,
        value: ylpQuery,
        page: ylpPage,
        perPage: YLP_ORDER_PAGE_SIZE,
        sort: ylpSort?.key,
        dir: ylpSort?.dir,
      });
      const items = response.data?.items || [];
      setYlpOrders(items);
      setYlpPagination(response.data?.pagination || null);

      // 进来先把第一条订单的摘要抽屉带出来，省得为了看一张订单还要再点一下。
      // 用 版本|搜索词|页码|排序 做键：换了任意一个才重新自动选，
      // 所以手动关掉抽屉之后不会被下一次刷新（例如 socket 推的新订单）又顶开。
      const autoKey = `${ylpVersion}|${ylpQuery}|${ylpPage}|${ylpSort?.key || ""}${ylpSort?.dir || ""}`;
      const pending = ylpPendingSelectRef.current;
      ylpPendingSelectRef.current = null;
      if (items.length) {
        if (pending) {
          // 键盘翻过来的：往下翻落在第一条，往上翻落在最后一条，接着按方向键能继续走
          ylpAutoOpenRef.current = autoKey;
          openYlpRowDetail(pending === "last" ? items[items.length - 1].id : items[0].id);
        } else if (ylpAutoOpenRef.current !== autoKey) {
          ylpAutoOpenRef.current = autoKey;
          openYlpRowDetail(items[0].id);
        }
      }
    } catch (loadError) {
      setYlpError(loadError instanceof Error ? loadError.message : "订单加载失败");
    } finally {
      setYlpLoading(false);
    }
  }

  function goBack() {
    if (screen.kind === "payment-detail") {
      setScreen({
        kind: "workspace",
        workspace: screen.workspace,
        section: "payments",
      });
      return;
    }

    if (screen.kind === "ylp-order-detail") {
      setScreen({
        kind: "workspace",
        workspace: "ylp",
        section: "orders",
      });
    }
  }

  function openPaymentDetail(workspace: WorkspaceTab, paymentId: number) {
    setScreen({
      kind: "payment-detail",
      workspace,
      paymentId,
    });
  }

  function openSection(workspace: WorkspaceTab, section: WorkspaceSection) {
    setScreen({
      kind: "workspace",
      workspace,
      section,
    });
  }

  async function handleApprove(payment: PaymentRecord) {
    setPaymentError("");
    const paymentId = getPaymentRecordId(payment);

    try {
      const response = await approvePayment(paymentId);
      setPayments((current) =>
        current.map((item) => (getPaymentRecordId(item) === paymentId ? response.payment || item : item)),
      );
      setActionMessage("审核已通过");
    } catch (actionError) {
      setPaymentError(actionError instanceof Error ? actionError.message : "操作失败");
    }
  }

  async function handleRemove(payment: PaymentRecord, mode: "revoke" | "delete") {
    setPaymentError("");
    const paymentId = getPaymentRecordId(payment);

    const confirmed = await showConfirmDialog({
      message: mode === "delete" ? "确认删除这笔付款？" : "确认撤销审核？",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    try {
      if (mode === "delete") {
        await removePayment(paymentId);
        setPayments((current) => current.filter((item) => getPaymentRecordId(item) !== paymentId));
        setActionMessage("付款已删除");
        setScreen({
          kind: "workspace",
          workspace: payment.type === "ylp" ? "ylp" : "lamp",
          section: "payments",
        });
        return;
      }

      const response = await revokePayment(paymentId);
      setPayments((current) =>
        current.map((item) => (getPaymentRecordId(item) === paymentId ? response.payment || item : item)),
      );
      setActionMessage("审核已撤销");
    } catch (actionError) {
      setPaymentError(actionError instanceof Error ? actionError.message : "操作失败");
    }
  }

  async function loadYlpDetail(orderId: number) {
    setYlpDetail({
      orderId,
      loading: true,
      error: "",
      order: null,
      payments: [],
      paymentsError: "",
    });

    try {
      const detailResponse = await fetchYlpOrderDetail(orderId);
      let paymentRows: YlpPaymentRecord[] = [];
      let paymentsError = "";

      try {
        paymentRows = await fetchYlpPayments(orderId);
      } catch (paymentLoadError) {
        paymentsError = paymentLoadError instanceof Error ? paymentLoadError.message : "支付记录加载失败";
      }

      setYlpDetail({
        orderId,
        loading: false,
        error: "",
        order: detailResponse.data || null,
        payments: paymentRows,
        paymentsError,
      });
    } catch (loadError) {
      setYlpDetail({
        orderId,
        loading: false,
        error: loadError instanceof Error ? loadError.message : "详情加载失败",
        order: null,
        payments: [],
        paymentsError: "",
      });
    }
  }

  function openYlpDetail(orderId: number) {
    setScreen({
      kind: "ylp-order-detail",
      orderId,
    });
  }

  function updatePaymentQuery(workspace: WorkspaceTab, value: string) {
    setPaymentQueryByWorkspace((current) => ({
      ...current,
      [workspace]: value,
    }));
    setPaymentPageByWorkspace((current) => ({
      ...current,
      [workspace]: 1,
    }));
  }

  function updatePaymentPage(workspace: WorkspaceTab, nextPage: number) {
    setPaymentPageByWorkspace((current) => ({
      ...current,
      [workspace]: nextPage,
    }));
  }

  /** 撤回一条待审核的付款：只标成「已拒绝」，订单状态不动。 */
  async function handleWithdrawPayment(paymentId: number, orderId: number) {
    const confirmed = await showConfirmDialog({
      title: "撤回付款",
      message: `撤回付款 #${paymentId}？这条记录会变成「已拒绝」，凭证保留，**订单状态不变**，之后可以重新提交付款。`,
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setStatusSaving(true);
    try {
      const result = await withdrawPayment(paymentId);
      if (result.success === false || result.status === "error") {
        throw new Error(result.message || result.error || "撤回失败");
      }
      // 付款状态变了会连带影响订单的付款汇总，整份详情重载一次最稳
      await loadYlpDetail(orderId);
      setActionMessage(`付款 #${paymentId} 已撤回`);
    } catch (withdrawError) {
      show_alert("error", withdrawError instanceof Error ? withdrawError.message : "撤回失败");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleDownloadPaiwei(orderId: number) {
    try {
      const result = await downloadYlpPaiwei(orderId);
      await downloadBlobOrShare(result.blob, result.filename, {
        isMobile,
        title: result.filename,
        text: `订单 #${orderId} 牌位文件`,
      });
      setActionMessage(isMobile ? "牌位文件已打开系统分享" : "牌位文件已开始下载");
    } catch (downloadError) {
      show_alert("error", downloadError instanceof Error ? downloadError.message : "下载牌位失败");
    }
  }

  async function handleDownloadQuotation(orderId: number) {
    const filename = `ylp-order-${orderId}-quotation.pdf`;
    try {
      await downloadUrlOrShare(`/api/payment/orders/${orderId}/quotation`, filename, {
        isMobile,
        title: filename,
        text: `订单 #${orderId} 报价单`,
        fallbackUrl: `${window.location.origin}/api/payment/orders/${orderId}/quotation`,
        mimeType: "application/pdf",
      });
      setActionMessage(isMobile ? "报价单已打开系统分享" : "报价单已开始下载");
    } catch (downloadError) {
      show_alert("error", downloadError instanceof Error ? downloadError.message : "下载报价单失败");
    }
  }

  async function handleSaveOrderInfo(orderId: number) {
    setOrderSaving(true);
    try {
      await updateYlpOrderCustomer(orderId, {
        customer_name: orderForm.customer_name.trim(),
        phone: orderForm.phone.trim(),
        email: orderForm.email.trim(),
      });
      setYlpDetail((current) =>
        current && current.order
          ? {
              ...current,
              order: {
                ...current.order,
                customer_name: orderForm.customer_name.trim(),
                phone: orderForm.phone.trim(),
                email: orderForm.email.trim(),
              },
            }
          : current,
      );
      setActionMessage("订单资料已保存");
    } catch (saveError) {
      show_alert("error", saveError instanceof Error ? saveError.message : "保存资料失败");
    } finally {
      setOrderSaving(false);
    }
  }

  async function handleSetOrderStatus(orderId: number, nextStatus: string) {
    if (nextStatus === "cancel") {
      const ok = await showConfirmDialog({ message: `确认取消订单 #${orderId}？`, tone: "danger" });
      if (!ok) {
        return;
      }
    }
    setStatusSaving(true);
    try {
      const result = await updateYlpOrderStatus(orderId, nextStatus);
      const saved = result.status || nextStatus;
      setYlpDetail((current) =>
        current && current.order ? { ...current, order: { ...current.order, order_status: saved } } : current,
      );
      setActionMessage("订单状态已更新");
    } catch (saveError) {
      show_alert("error", saveError instanceof Error ? saveError.message : "更新状态失败");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleDeleteYlpOrder(orderId: number) {
    const confirmed = await showConfirmDialog({
      message: `确认删除订单 #${orderId}？订单会移入「DELETE」版本（软删除），切到 DELETE 版本还能找回或彻底删除。`,
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setStatusSaving(true);
    try {
      // 软删除只认一套约定：把版本改成 DELETE（deleteYlpOrdersBatch 就是这么做的），
      // 不能再去改 status —— 那样订单在自己版本里被藏起来、在 DELETE 版本里又找不到，会全版本隐身。
      const res = await deleteYlpOrdersBatch([orderId]);
      if (res.status === "error") {
        throw new Error(res.message || "删除订单失败");
      }
      setActionMessage("订单已移入 DELETE 版本");
      setScreen({ kind: "workspace", workspace: "ylp", section: "orders" });
      void loadYlpOrders();
    } catch (deleteError) {
      show_alert("error", deleteError instanceof Error ? deleteError.message : "删除订单失败");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleCopyYlpOrderToCurrent(orderId: number) {
    const ok = await showConfirmDialog({
      message: `把订单 #${orderId} 复制到今年（${CURRENT_YLP_VERSION}）？会生成一张新的 Draft 订单，原订单保持不变。`,
    });
    if (!ok) {
      return;
    }
    setStatusSaving(true);
    try {
      const res = await copyYlpOrdersToCurrent([orderId]);
      const newId = res.copied?.[0]?.new_id;
      if (newId) {
        show_alert("success", `已复制为今年订单 #${newId}`);
        openYlpDetail(newId);
      } else {
        show_alert("error", res.skipped?.[0]?.reason || res.message || "复制失败");
      }
    } catch (copyError) {
      show_alert("error", copyError instanceof Error ? copyError.message : "复制失败");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleBulkCopyToCurrent() {
    let ids: number[];
    try {
      ids = await resolveYlpSelectedIds();
    } catch {
      show_alert("error", "获取订单失败");
      return;
    }
    if (!ids.length) {
      show_alert("error", "请选择订单");
      return;
    }
    const ok = await showConfirmDialog({
      message: `把选中的 ${ids.length} 张订单复制到今年（${CURRENT_YLP_VERSION}）？每张都会生成新的 Draft 订单，原订单保持不变。`,
    });
    if (!ok) {
      return;
    }
    setYlpBulkBusy(true);
    try {
      const res = await copyYlpOrdersToCurrent(ids);
      show_alert("success", res.message || "复制完成");
      clearYlpSelection();
    } catch (copyError) {
      show_alert("error", copyError instanceof Error ? copyError.message : "批量复制失败");
    } finally {
      setYlpBulkBusy(false);
    }
  }

  async function handleDownloadReceipt(orderId: number) {
    try {
      const blob = await downloadYlpReceiptImage(orderId);
      await downloadBlobOrShare(blob, `收据_订单${orderId}.png`, { isMobile });
    } catch (receiptError) {
      show_alert("error", receiptError instanceof Error ? receiptError.message : "下载收据失败");
    }
  }

  async function handleCopyShareLink(orderId: number) {
    try {
      const res = await createYlpShareLink(orderId);
      if (!res.token) {
        show_alert("error", res.message || "生成公开链接失败");
        return;
      }
      const url = `${window.location.origin}/#/ylp-shared?token=${res.token}`;
      const days = Math.max(1, Math.round((res.expires_in || 0) / 86400));
      try {
        await copyTextToClipboard(url);
        show_alert("success", `公开链接已复制（${days} 天内有效）`);
      } catch {
        show_alert("error", `自动复制失败，请手动复制：${url}`);
      }
      setActionMessage(url);
    } catch (shareError) {
      show_alert("error", shareError instanceof Error ? shareError.message : "生成公开链接失败");
    }
  }

  // 右侧那一栏同一时间只放一块内容：填写页 / 牌位预览 / 订单摘要。
  function closePaiweiPreview() {
    setPaiweiPreviewOrderId(null);
  }

  function closeYlpRowPanels() {
    setIntakeDrawerOpen(false);
    setYlpRowDetailId(null);
    closeYlpRowPreview();
  }

  // 菜单是 fixed 定位的：夹在视窗内，贴不下就往锚点上方翻。
  function placeYlpRowMenu(orderId: number, x: number, anchorTop: number, anchorBottom: number) {
    const menuHeight = rowMenuHeight(!isCurrentYlpVersion(ylpVersion));
    const flipUp = anchorBottom + 4 + menuHeight > window.innerHeight;

    return {
      orderId,
      x: Math.max(8, Math.min(x, window.innerWidth - ROW_MENU_WIDTH - 8)),
      y: flipUp ? Math.max(8, anchorTop - 4 - menuHeight) : anchorBottom + 4,
    };
  }

  // 点行只在右侧看摘要，要改动再按「进入订单详情」。
  function openYlpRowDetail(orderId: number) {
    closeYlpRowPanels();
    setYlpRowDetailId(orderId);
  }

  // 列表行的「预览」＝订单详情那颗「预览牌位」，只是渲染进右侧抽屉而不是弹窗。
  function closeYlpRowPreview() {
    setYlpRowPreview(null);
  }

  async function handleRowConfirmOrder(orderId: number) {
    setYlpRowBusy(true);
    try {
      await updateYlpOrderStatus(orderId, "confirm");
      show_alert("success", `订单 #${orderId} 已确认`);
      void loadYlpOrders();
      if (ylpRowDetailId === orderId) {
        // 抽屉自己会重拉，这里只要保证它还开着即可
        setYlpRowDetailId(orderId);
      }
    } catch (confirmError) {
      show_alert("error", confirmError instanceof Error ? confirmError.message : "确认订单失败");
    } finally {
      setYlpRowBusy(false);
    }
  }

  async function handleRowCopyToCurrent(orderId: number) {
    const ok = await showConfirmDialog({
      message: `把订单 #${orderId} 复制到今年（${CURRENT_YLP_VERSION}）？会生成一张新的 Draft 订单，原订单保持不变。`,
    });
    if (!ok) {
      return;
    }
    setYlpRowBusy(true);
    try {
      const res = await copyYlpOrdersToCurrent([orderId]);
      const newId = res.copied?.[0]?.new_id;
      if (!newId) {
        show_alert("error", res.skipped?.[0]?.reason || res.message || "复制失败");
        return;
      }
      // 新单在今年版本里，当前这份历史版本列表不会有它，所以直接跳进新单详情。
      show_alert("success", `已复制为今年订单 #${newId}`);
      closeYlpRowPanels();
      openYlpDetail(newId);
    } catch (copyError) {
      show_alert("error", copyError instanceof Error ? copyError.message : "复制失败");
    } finally {
      setYlpRowBusy(false);
    }
  }

  async function handleRowRemoveOrder(orderId: number) {
    // 与批量移除同一套语义：今年版本是软删除（移入 DELETE），DELETE 版本再删才是彻底删除。
    const isPurge = ylpVersion === "DELETE";
    const ok = await showConfirmDialog({
      message: isPurge
        ? `彻底删除订单 #${orderId}？数据会从数据库移除，不可恢复！`
        : `移除订单 #${orderId}？订单会移入「DELETE」版本（软删除），切到 DELETE 版本再删除一次才会彻底删除。`,
      tone: "danger",
    });
    if (!ok) {
      return;
    }
    setYlpRowBusy(true);
    try {
      const res = await deleteYlpOrdersBatch([orderId]);
      show_alert("success", res.message || "已移除");
      if (ylpRowPreview?.orderId === orderId) {
        closeYlpRowPreview();
      }
      if (ylpRowDetailId === orderId) {
        setYlpRowDetailId(null);
      }
      setYlpSelected((current) => current.filter((id) => id !== orderId));
      void loadYlpOrders();
      void loadYlpVersions();
    } catch (removeError) {
      show_alert("error", removeError instanceof Error ? removeError.message : "移除订单失败");
    } finally {
      setYlpRowBusy(false);
    }
  }

  async function handleBulkDeleteYlpOrders() {
    let ids: number[];
    try {
      ids = await resolveYlpSelectedIds();
    } catch {
      show_alert("error", "获取订单失败");
      return;
    }
    if (!ids.length) {
      show_alert("error", "请选择订单");
      return;
    }
    const isPurge = ylpVersion === "DELETE";
    const ok = await showConfirmDialog({
      message: isPurge
        ? `彻底删除选中的 ${ids.length} 张订单？数据会从数据库移除，不可恢复！`
        : `移除选中的 ${ids.length} 张订单？订单会移入「DELETE」版本（软删除），切到 DELETE 版本再删除一次才会彻底删除。`,
      tone: "danger",
    });
    if (!ok) {
      return;
    }
    setYlpBulkBusy(true);
    try {
      const res = await deleteYlpOrdersBatch(ids);
      show_alert("success", res.message || "已处理");
      clearYlpSelection();
      void loadYlpOrders();
      void loadYlpVersions();
    } catch (deleteError) {
      show_alert("error", deleteError instanceof Error ? deleteError.message : "批量移除失败");
    } finally {
      setYlpBulkBusy(false);
    }
  }

  async function handleDeleteYlpItem(orderId: number, itemId: number) {
    const ok = await showConfirmDialog({ message: `确认删除项目 #${itemId}？`, tone: "danger" });
    if (!ok) {
      return;
    }
    try {
      await deleteYlpOrderItem(orderId, itemId);
      setActionMessage("项目已删除");
      void loadYlpDetail(orderId);
    } catch (deleteError) {
      show_alert("error", deleteError instanceof Error ? deleteError.message : "删除项目失败");
    }
  }

  function openYlpIntakePage() {
    closeYlpRowPanels();
    setIntakeDrawerOpen(true);
  }

  function renderWorkspaceHeader() {
    if (!currentWorkspace || !currentSection) {
      return null;
    }

    const title =
      screen.kind === "payment-detail"
        ? "付款详情"
        : screen.kind === "ylp-order-detail"
          ? "订单详情"
          : getSectionTitle(currentWorkspace, currentSection);
    const description =
      screen.kind === "payment-detail"
        ? "审核、撤销和删除都放在当前详情页，不再弹出窗口。"
        : screen.kind === "ylp-order-detail"
          ? "订单信息、付款记录和项目内容直接展开在页面里。"
          : getSectionDescription(currentWorkspace, currentSection);

    const isDetail = screen.kind === "payment-detail" || screen.kind === "ylp-order-detail";

    // 详情页保留返回按钮 + 标题，列表页压缩成紧凑的一排。
    if (isDetail) {
      return (
        <section style={styles.workspaceCard} className="fahui-workspace-headcard">
          <header style={styles.workspaceHeader(isMobile, true)} className="fahui-workspace-header">
            <button type="button" style={styles.backButton} onClick={goBack}>
              <i className="fas fa-arrow-left" />
              <span>返回列表</span>
            </button>

            <section style={styles.workspaceCopy} className="fahui-workspace-copy">
              <p style={styles.workspaceEyebrow}>{getWorkspaceEyebrow(currentWorkspace)}</p>
              <h2 style={styles.workspaceTitle}>{title}</h2>
              <p style={styles.workspaceDescription}>{description}</p>
            </section>
          </header>
        </section>
      );
    }

    return (
      <section style={styles.workspaceBar} className="fahui-workspace-bar">
        <section style={styles.workspaceCopy} className="fahui-workspace-copy">
          <p style={styles.workspaceEyebrow}>{getWorkspaceEyebrow(currentWorkspace)}</p>
          <h2 style={styles.workspaceTitle}>
            {currentWorkspace === "ylp" ? getSectionTitle("ylp", currentSection) : "法会"}
          </h2>
          {currentWorkspace === "ylp" ? null : (
            <p style={styles.workspaceHint}>法会付款审核已移至「财政 · 收款审核」统一管理。</p>
          )}
        </section>

        {currentWorkspace === "ylp" ? (
          <div style={styles.workspaceBarActions} className="fahui-workspace-bar-actions">
            <div style={styles.sectionTabs} className="fahui-workspace-tabs" role="tablist">
              {YLP_SECTION_TABS.map((tab) => {
                const active = currentSection === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    style={{ ...styles.sectionTab, ...(active ? styles.sectionTabActive : null) }}
                    onClick={() => setScreen({ kind: "workspace", workspace: "ylp", section: tab.key })}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <button type="button" style={styles.secondaryActionCompact} onClick={() => setPaymentConfigOpen(true)}>
              配置支付路径
            </button>
            <button type="button" style={styles.secondaryActionCompact} onClick={() => setRelationConfigOpen(true)}>
              超度亡灵关系配置
            </button>
            <button type="button" style={styles.secondaryActionCompact} onClick={() => setOpenWindowConfigOpen(true)}>
              开放时间设置
            </button>
            <button type="button" style={styles.secondaryActionCompact} onClick={() => setPrintRecordsOpen(true)}>
              查看打印记录
            </button>
            {/* 常驻入口：按订单号 / 牌位单号直接打印，不用先在列表里勾、也不用先挑类型。
                底部批量条那个「打印牌位 PLUS ▾」只在勾了订单之后才出现。 */}
            <button
              type="button"
              style={styles.secondaryActionCompact}
              onClick={() => void handleYlpPrintPlus(null)}
            >
              打印牌位 PLUS
            </button>
            <button type="button" style={styles.secondaryActionCompact} onClick={openYlpIntakePage}>
              打开牌位填写页
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  function renderPaymentList(workspace: WorkspaceTab) {
    return (
      <>
        <section style={styles.paymentToolbar(isMobile)}>
          <input
            value={paymentQueryByWorkspace[workspace]}
            onChange={(event) => updatePaymentQuery(workspace, event.target.value)}
            placeholder="搜索订单号 / 手机号 / 付款人 / 祈福者"
            style={styles.searchInput}
          />
          <p style={styles.summary}>{`共 ${workspacePayments.length} 条，当前第 ${safePaymentPage}/${paymentTotalPages} 页`}</p>
        </section>

        {paymentLoading ? <section style={styles.stateCard}>加载中…</section> : null}
        {!paymentLoading && paymentError ? <section style={styles.stateCard}>{paymentError}</section> : null}

        {!paymentLoading && !paymentError ? (
          <>
            <nav style={styles.pagination}>
              {Array.from({ length: paymentTotalPages }, (_, index) => {
                const nextPage = index + 1;
                const active = nextPage === safePaymentPage;

                return (
                  <button
                    key={nextPage}
                    type="button"
                    onClick={() => updatePaymentPage(workspace, nextPage)}
                    style={{
                      ...styles.pageButton,
                      ...(active ? styles.pageButtonActive : null),
                    }}
                  >
                    {nextPage}
                  </button>
                );
              })}
            </nav>

            <section style={styles.grid}>
              {pagedPayments.map((payment) => {
                const approved = isPaymentApproved(payment);

                return (
                  <article
                    key={getPaymentRecordId(payment)}
                    style={{
                      ...styles.card,
                      ...(approved ? styles.cardApproved : styles.cardPending),
                    }}
                  >
                    <header style={styles.cardHeader}>
                      <p style={styles.typeBadge(payment.type === "ylp")}>{getPaymentTypeLabel(payment)}</p>
                      {approved && payment.submitter_id ? (
                        <CachedImage
                          src={`/api/user_control/get_profile_image/${payment.submitter_id}`}
                          cacheKey={`fahui-submitter:${payment.submitter_id}`}
                          resolveRelativeToApi
                          alt=""
                          style={styles.avatar}
                        />
                      ) : null}
                    </header>

                    <h3 style={styles.cardTitle}>{getPaymentPrimaryText(payment)}</h3>
                    <p style={styles.cardMeta}>{getPaymentSecondaryText(payment)}</p>
                    <p style={styles.cardMeta}>{`金额：${payment.amount ?? payment.total_price ?? "-"} / ${payment.method || payment.payment_mode || "-"}`}</p>
                    <p style={styles.cardNote}>{payment.note || payment.valid_by || payment.status || "-"}</p>

                    <button
                      type="button"
                      style={styles.cardAction}
                      onClick={() => openPaymentDetail(workspace, getPaymentRecordId(payment))}
                    >
                      查看详情
                    </button>
                  </article>
                );
              })}
            </section>
          </>
        ) : null}
      </>
    );
  }

  function renderPaymentDetail(payment: PaymentRecord, workspace: WorkspaceTab) {
    const approved = isPaymentApproved(payment);

    return (
      <>
        {paymentError ? <section style={styles.stateCard}>{paymentError}</section> : null}

        <section style={styles.detailCard} className="fahui-payment-detail">
          <header style={styles.detailHero(isMobile)}>
            <section>
              <p style={styles.detailEyebrow}>{getPaymentTypeLabel(payment)}</p>
              <h3 style={styles.detailTitle}>{getPaymentPrimaryText(payment)}</h3>
              <p style={styles.detailLead}>{getPaymentSecondaryText(payment)}</p>
            </section>

            <nav style={styles.detailActions(isMobile)}>
              {approved ? (
                <button
                  type="button"
                  style={styles.secondaryAction}
                  onClick={() => void handleRemove(payment, "revoke")}
                >
                  撤销审核
                </button>
              ) : (
                <button type="button" style={styles.primaryAction} onClick={() => void handleApprove(payment)}>
                  审核通过
                </button>
              )}

              <button type="button" style={styles.dangerAction} onClick={() => void handleRemove(payment, "delete")}>
                删除付款
              </button>
            </nav>
          </header>

          <section style={styles.infoGrid}>
            <DetailField label="工作区" value={workspace === "ylp" ? "YLP" : "Lamp"} />
            <DetailField label="审核状态" value={payment.status || getPaymentStatusLabel(payment)} />
            <DetailField label="付款人姓名" value={payment.payer_name} />
            <DetailField label="付款电话" value={payment.phone || payment.order?.phone} />
            <DetailField label="付款金额" value={payment.amount || payment.total_price} />
            <DetailField label="付款方式" value={payment.method || payment.payment_mode} />
            <DetailField label="付款时间" value={payment.paid_at} />
            <DetailField label="创建时间" value={payment.created_at} />
            <DetailField label="审核人" value={payment.valid_by} />
            <DetailField label="审核时间" value={payment.valid_at} />
          </section>

          {payment.order ? (
            <section style={styles.detailSection} className="fahui-detail-section">
              <header style={styles.detailSectionHeader}>
                <h4 style={styles.detailSectionTitle}>订单信息</h4>
              </header>
              <section style={styles.infoGrid}>
                <DetailField label="订单编号" value={payment.order.id || payment.order_id} />
                <DetailField label="功德主" value={payment.order.customer_name || payment.order.name} />
                <DetailField label="电话" value={payment.order.phone} />
                <DetailField label="版本" value={payment.order.version} />
              </section>
            </section>
          ) : null}

          {(payment.registrations || []).length ? (
            <section style={styles.detailSection} className="fahui-detail-section">
              <header style={styles.detailSectionHeader}>
                <h4 style={styles.detailSectionTitle}>报名资料</h4>
              </header>
              {(payment.registrations || []).map(renderRegistration)}
            </section>
          ) : null}
        </section>
      </>
    );
  }

  // 排序 / 分页 / 搜索全部走后端；本地不再重排。
  const sortedYlpOrders = ylpOrders;

  function toggleYlpSort(key: YlpSortKey) {
    setYlpSort((current) =>
      current && current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
    setYlpPage(1);
  }

  // ---- 多选 / 批量操作 ----
  const ylpPageIds = sortedYlpOrders.map((order) => order.id);
  const ylpTotal = ylpPagination?.total ?? ylpOrders.length;
  const ylpAllPageSelected = ylpPageIds.length > 0 && ylpPageIds.every((id) => ylpSelected.includes(id));
  const ylpSelectionCount = ylpSelectAllPages ? ylpTotal : ylpSelected.length;
  const ylpSelectionActive = ylpSelectAllPages || ylpSelected.length > 0;
  const ylpCanSelectAllPages = ylpAllPageSelected && !ylpSelectAllPages && ylpTotal > ylpPageIds.length;

  useEffect(() => {
    setYlpSelected([]);
    setYlpSelectAllPages(false);
  }, [ylpVersion, ylpQuery]);

  function toggleYlpRow(id: number) {
    setYlpSelectAllPages(false);
    setYlpSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  function toggleYlpPageSelect() {
    setYlpSelectAllPages(false);
    setYlpSelected((current) => {
      if (ylpPageIds.every((id) => current.includes(id))) {
        return current.filter((id) => !ylpPageIds.includes(id));
      }
      const merged = new Set(current);
      ylpPageIds.forEach((id) => merged.add(id));
      return Array.from(merged);
    });
  }

  function clearYlpSelection() {
    setYlpSelected([]);
    setYlpSelectAllPages(false);
  }

  async function resolveYlpSelectedIds(): Promise<number[]> {
    if (!ylpSelectAllPages) {
      return ylpSelected;
    }
    const res = await listYlpOrdersForExport(ylpVersion, ylpQuery);
    return (res.data?.items || []).map((order) => order.id);
  }

  async function handleYlpExportXlsx() {
    setYlpBulkBusy(true);
    try {
      const res = await listYlpOrdersForExport(ylpVersion, ylpQuery);
      const all = res.data?.items || [];
      const rows = ylpSelectAllPages ? all : all.filter((order) => ylpSelected.includes(order.id));
      if (!rows.length) {
        show_alert("error", "没有可导出的订单");
        return;
      }
      // 多张工作表：订单总览 / 牌位明细 / 每个牌位类型一张 / 分类汇总 / 付款记录
      const blob = await buildYlpOrdersWorkbookBlob(rows);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `YLP订单_${ylpVersion}_${rows.length}条.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      show_alert("error", exportError instanceof Error ? exportError.message : "导出失败");
    } finally {
      setYlpBulkBusy(false);
    }
  }

  function stopPaiweiPoll() {
    if (paiweiPollRef.current !== null) {
      window.clearTimeout(paiweiPollRef.current);
      paiweiPollRef.current = null;
    }
  }

  useEffect(() => stopPaiweiPoll, []);

  async function downloadPaiweiJobResult(jobId: string, template: string) {
    try {
      const blob = await downloadYlpPaiweiJob(jobId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `牌位_${template}_${jobId.slice(0, 8)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (downloadError) {
      show_alert("error", downloadError instanceof Error ? downloadError.message : "下载失败");
    } finally {
      window.setTimeout(() => setPaiweiJob(null), 1500);
    }
  }

  /** template 传 null = 工具栏那个常驻入口：不挑类型、也不看列表勾选，只按单号打印。 */
  async function handleYlpPrintPlus(template: string | null) {
    setPrintPlusMenuOpen(false);
    let selectedIds: number[] = [];
    if (template) {
      setYlpBulkBusy(true);
      try {
        selectedIds = await resolveYlpSelectedIds();
      } catch {
        show_alert("error", "获取订单失败");
        return;
      } finally {
        setYlpBulkBusy(false);
      }
    }
    // 弹窗里挑范围（勾选 / 订单单号 / 牌位单号）+ 状态过滤 + 要不要跳过已注册的，
    // 张数由后端 /scope 算好，确认后原样提交回去。点遮罩 / 取消都返回 null，当作放弃打印。
    const choice = await showPrintPlusDialog(selectedIds, template, ylpVersion);
    if (!choice) {
      return;
    }
    const ids = choice.orderIds;
    const needBarcode = choice.needBarcode;
    // 用弹窗回传的类型，不是传进去的那个 —— 工具栏入口传的是 null，
    // 直接发给后端会被判「无效的牌位类型」
    const jobTemplate = choice.template;
    stopPaiweiPoll();
    setPaiweiJob({ percent: 0, status: "running" });
    try {
      const res = await startYlpPaiweiJob(ids, jobTemplate, needBarcode, {
        itemIds: choice.itemIds,
        pdfIds: choice.pdfIds,
      });
      if (res.status !== "success" || !res.job_id) {
        setPaiweiJob({ percent: 0, status: "error", message: res.message || "启动任务失败" });
        return;
      }
      const jobId = res.job_id;
      // 生产是 sync gunicorn（无 socket 服务），用轮询获取进度。
      const poll = async () => {
        try {
          const statusRes = await getYlpPaiweiJobStatus(jobId);
          const data = statusRes.data || {};
          const jobStatus = data.status;
          const percent = Number(data.progress || 0);
          if (jobStatus === "done") {
            setPaiweiJob({ percent: 100, status: "done" });
            void downloadPaiweiJobResult(jobId, jobTemplate);
            return;
          }
          if (jobStatus === "error") {
            setPaiweiJob({ percent: 0, status: "error", message: data.message || "生成失败" });
            return;
          }
          setPaiweiJob({ percent, status: "running" });
          paiweiPollRef.current = window.setTimeout(() => void poll(), 800);
        } catch {
          setPaiweiJob({ percent: 0, status: "error", message: "查询进度失败" });
        }
      };
      paiweiPollRef.current = window.setTimeout(() => void poll(), 600);
    } catch (startError) {
      setPaiweiJob({ percent: 0, status: "error", message: startError instanceof Error ? startError.message : "启动失败" });
    }
  }

  // 版本切换就重新拉「这个版本绑了哪个活动」
  useEffect(() => {
    if (screen.kind !== "workspace" || screen.workspace !== "ylp" || screen.section !== "orders" || !ylpVersion) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchYlpVersionEvent(ylpVersion);
        if (!cancelled) setVersionEvent(res.data || null);
      } catch {
        if (!cancelled) setVersionEvent(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, ylpVersion]);

  async function handleBindVersionEvent() {
    if (versionEventBusy || !ylpVersion) {
      return;
    }
    if (ylpVersion === "DELETE") {
      show_alert("error", "DELETE 版本不能绑定活动");
      return;
    }
    const picked = await showEventPicker();
    if (!picked) {
      return;
    }
    setVersionEventBusy(true);
    try {
      const res = await setYlpVersionEvent(ylpVersion, picked.id);
      setVersionEvent(res.data || null);
      show_alert("success", `${ylpVersion} 已绑定「${picked.event_name || "未命名活动"}」，收入会进该活动预算`);
    } catch (error) {
      show_alert("error", error instanceof Error ? error.message : "绑定失败");
    } finally {
      setVersionEventBusy(false);
    }
  }

  async function handleUnbindVersionEvent() {
    if (versionEventBusy || !versionEvent) {
      return;
    }
    const confirmed = await showConfirmDialog({
      title: "解除绑定",
      message: `解除 ${ylpVersion} 与「${versionEvent.event_name || `活动 #${versionEvent.event_id}`}」的绑定？该版本的收入会从活动预算里移除。`,
    });
    if (!confirmed) {
      return;
    }
    setVersionEventBusy(true);
    try {
      await setYlpVersionEvent(ylpVersion, null);
      setVersionEvent(null);
      show_alert("success", "已解除绑定");
    } catch (error) {
      show_alert("error", error instanceof Error ? error.message : "解除绑定失败");
    } finally {
      setVersionEventBusy(false);
    }
  }

  function renderVersionEventBar() {
    return (
      <section style={styles.bindBar} className="ylp-bind-bar">
        <span style={styles.bindLabel}>
          <i className="fa-solid fa-link" aria-hidden="true" style={{ marginRight: 6 }} />
          绑定活动
        </span>
        {versionEvent ? (
          <>
            <span style={styles.bindChip}>
              {versionEvent.event_name || `活动 #${versionEvent.event_id}`}
              {versionEvent.event_datetime ? ` · ${versionEvent.event_datetime.slice(0, 10)}` : ""}
            </span>
            <button
              type="button"
              style={styles.bindLink}
              onClick={() => navigate(`/crm/event_table?event_id=${versionEvent.event_id}&event_tab=budget`)}
            >
              查看活动预算
            </button>
            <button type="button" style={styles.bindGhost} disabled={versionEventBusy} onClick={() => void handleBindVersionEvent()}>
              更换活动
            </button>
            <button type="button" style={styles.bindGhost} disabled={versionEventBusy} onClick={() => void handleUnbindVersionEvent()}>
              解除绑定
            </button>
          </>
        ) : (
          <>
            <span style={styles.bindHint}>{`${ylpVersion || "本版本"} 还没绑定活动，绑定后这个版本的订单收入会自动进该活动的预算`}</span>
            <button type="button" style={styles.bindAction} disabled={versionEventBusy || ylpVersion === "DELETE"} onClick={() => void handleBindVersionEvent()}>
              {versionEventBusy ? "处理中…" : "绑定活动"}
            </button>
          </>
        )}
      </section>
    );
  }

  function renderYlpOrderList() {
    return (
      <>
        <section style={styles.orderToolbar(isMobile)} className="ylp-order-toolbar">
          <select
            value={ylpVersion}
            onChange={(event) => {
              setYlpVersion(event.target.value);
              setYlpPage(1);
            }}
            style={styles.selectInput}
            className="ylp-version-select"
          >
            {(ylpVersions.length ? ylpVersions : [ylpVersion || CURRENT_YLP_VERSION]).map((version) => (
              <option key={version} value={version}>
                {version}
              </option>
            ))}
          </select>

          <input
            value={ylpQueryInput}
            onChange={(event) => setYlpQueryInput(event.target.value)}
            placeholder="搜索订单号 / 功德主 / 电话 / 牌位内容 / 维护人"
            style={{ ...styles.searchInput, flex: "1 1 200px", width: "auto", minWidth: 0 }}
            className="ylp-search-input"
          />

          <nav style={styles.pagination} className="ylp-pagination">
            <button
              type="button"
              onClick={() => setYlpPage(Math.max(1, ylpSafePage - 1))}
              disabled={ylpSafePage <= 1}
              style={{
                ...styles.pageButton,
                ...(ylpSafePage <= 1 ? styles.pageButtonDisabled : null),
              }}
            >
              上一页
            </button>

            <span style={styles.pageIndicator}>{`${ylpSafePage} / ${ylpTotalPages}`}</span>

            <button
              type="button"
              onClick={() => setYlpPage(Math.min(ylpTotalPages, ylpSafePage + 1))}
              disabled={ylpSafePage >= ylpTotalPages}
              style={{
                ...styles.pageButton,
                ...(ylpSafePage >= ylpTotalPages ? styles.pageButtonDisabled : null),
              }}
            >
              下一页
            </button>
          </nav>

          <p style={styles.summary} className="ylp-summary">
            {`共 ${ylpPagination?.total || 0} 条 · ${ylpSafePage}/${ylpTotalPages} 页`}
            {/* 4 位以内纯数字后端会当订单号精确查，这里说一声，
                免得输了个短号码搜不到还以为是搜索坏了 */}
            {/^\d{1,4}$/.test(ylpQuery) ? <span style={styles.summaryTag}>按单号精确匹配</span> : null}
          </p>
        </section>

        {renderVersionEventBar()}

        {ylpLoading ? <section style={styles.stateCard} className="ylp-state-card">加载中…</section> : null}
        {!ylpLoading && ylpError ? <section style={styles.stateCard} className="ylp-state-card">{ylpError}</section> : null}

        {!ylpLoading && !ylpError ? (
          <>
            {ylpCanSelectAllPages || ylpSelectAllPages ? (
              <div style={styles.selectAllBanner} className="ylp-select-all-banner">
                {ylpSelectAllPages ? (
                  <>
                    <span>已选择全部 {ylpTotal} 条记录</span>
                    <button type="button" style={styles.selectAllLink} onClick={clearYlpSelection}>
                      清除选择
                    </button>
                  </>
                ) : (
                  <>
                    <span>已选中本页 {ylpPageIds.length} 条</span>
                    <button
                      type="button"
                      style={styles.selectAllLink}
                      onClick={() => setYlpSelectAllPages(true)}
                    >
                      选择全部 {ylpTotal} 条记录
                    </button>
                  </>
                )}
              </div>
            ) : null}
            <div style={styles.tableWrap} className="ylp-order-table-wrap">
              <style>{YLP_ORDER_TABLE_CSS}</style>
              <table className="ylp-order-table">
                <thead>
                  <tr>
                    <th className="ylp-check-col">
                      <input
                        type="checkbox"
                        checked={ylpAllPageSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = !ylpAllPageSelected && ylpPageIds.some((id) => ylpSelected.includes(id));
                        }}
                        onChange={toggleYlpPageSelect}
                        aria-label="当页全选"
                      />
                    </th>
                    <th className="ylp-action-col">操作</th>
                    {YLP_ORDER_COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className="ylp-sortable"
                        onClick={() => toggleYlpSort(col.key)}
                      >
                        {col.label}
                        <span className="ylp-sort-arrow">
                          {ylpSort?.key === col.key ? (ylpSort.dir === "asc" ? " ▲" : " ▼") : ""}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedYlpOrders.map((order) => (
                    <tr
                      key={order.id}
                      data-ylp-order-row={order.id}
                      className={[
                        "ylp-order-row",
                        boardStatusClass(order.board_status?.status),
                        ylpRowDetailId === order.id ? "ylp-order-row-active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      title={boardStatusTitle(order.board_status)}
                      onClick={() => void openYlpRowDetail(order.id)}
                      onContextMenu={(event) => {
                        // 右键＝三点菜单，在光标处弹出，顺手压掉浏览器自带菜单。
                        event.preventDefault();
                        // 关菜单的 window 监听器已经挂上了，别让这次事件冒上去把刚开的菜单关掉。
                        event.stopPropagation();
                        setYlpRowMenu(placeYlpRowMenu(order.id, event.clientX, event.clientY, event.clientY));
                      }}
                    >
                      <td className="ylp-check-col" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={ylpSelectAllPages || ylpSelected.includes(order.id)}
                          onChange={() => toggleYlpRow(order.id)}
                          aria-label={`选择订单 ${order.id}`}
                        />
                      </td>
                      <td className="ylp-action-col" onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          className="ylp-row-menu-btn"
                          aria-label={`订单 ${order.id} 操作`}
                          aria-haspopup="menu"
                          aria-expanded={ylpRowMenu?.orderId === order.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            setYlpRowMenu((current) =>
                              current && current.orderId === order.id
                                ? null
                                : placeYlpRowMenu(order.id, rect.left, rect.top, rect.bottom),
                            );
                          }}
                        >
                          ⋯
                        </button>
                      </td>
                      <td>
                        <span style={ylpStatusChipStyle(order.order_status || "Draft")}>
                          {orderStatusLabel(order.order_status)}
                        </span>
                      </td>
                      <td>
                        <span style={ylpStatusChipStyle(order.status)}>{paymentStatusLabel(order.status)}</span>
                      </td>
                      <td style={styles.cellMono}>{`#${order.id}`}</td>
                      <td style={styles.cellStrong}>{order.customer_name || order.name || "-"}</td>
                      <td style={styles.cellMono}>{order.phone || "-"}</td>
                      <td style={styles.cellMono}>{order.total_amount != null ? `RM ${order.total_amount}` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {ylpSelectionActive ? (
          <div style={styles.bulkBar} className="ylp-bulk-bar">
            <span style={styles.bulkCount}>已选 {ylpSelectionCount} 条</span>
            <div style={styles.bulkActions}>
              <button
                type="button"
                style={{ ...styles.bulkButton, ...(ylpBulkBusy ? styles.pageButtonDisabled : null) }}
                disabled={ylpBulkBusy}
                onClick={() => void handleYlpExportXlsx()}
              >
                导出 xlsx
              </button>
              {!isCurrentYlpVersion(ylpVersion) ? (
                <button
                  type="button"
                  style={{ ...styles.bulkButton, ...(ylpBulkBusy ? styles.pageButtonDisabled : null) }}
                  disabled={ylpBulkBusy}
                  onClick={() => void handleBulkCopyToCurrent()}
                >
                  批量复制到今年
                </button>
              ) : null}
              {isCurrentYlpVersion(ylpVersion) || ylpVersion === "DELETE" ? (
                <button
                  type="button"
                  style={{ ...styles.bulkDanger, ...(ylpBulkBusy ? styles.pageButtonDisabled : null) }}
                  disabled={ylpBulkBusy}
                  onClick={() => void handleBulkDeleteYlpOrders()}
                >
                  {ylpVersion === "DELETE" ? "彻底删除" : "批量移除"}
                </button>
              ) : null}
              <div style={styles.printMenuWrap}>
                <button
                  type="button"
                  style={{ ...styles.bulkButtonPrimary, ...(ylpBulkBusy ? styles.pageButtonDisabled : null) }}
                  disabled={ylpBulkBusy}
                  onClick={() => setPrintPlusMenuOpen((open) => !open)}
                >
                  打印牌位 PLUS ▾
                </button>
                {printPlusMenuOpen ? (
                  <div style={styles.printMenu}>
                    <button type="button" style={styles.printMenuItem} onClick={() => void handleYlpPrintPlus("paiwei_SS")}>
                      超大牌位
                    </button>
                    <button type="button" style={styles.printMenuItem} onClick={() => void handleYlpPrintPlus("paiwei_1")}>
                      大牌位
                    </button>
                    <button type="button" style={styles.printMenuItem} onClick={() => void handleYlpPrintPlus("paiwei_5")}>
                      小牌位
                    </button>
                    <button type="button" style={styles.printMenuItem} onClick={() => void handleYlpPrintPlus("paiwei_10")}>
                      冤亲债主
                    </button>
                  </div>
                ) : null}
              </div>
              <button type="button" style={styles.bulkCancel} onClick={clearYlpSelection}>
                取消
              </button>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  function renderYlpOrderDetailView() {
    const orderStatus = ylpDetail?.order?.order_status || "Draft";
    // 历史版本（非今年）只读：不能改状态、资料、项目，只能查看或复制到今年。
    const versionEditable = isCurrentYlpVersion(ylpDetail?.order?.version);
    const editable = versionEditable && orderStatus === "Draft";
    const canDelete = versionEditable && orderStatus === "cancel";
    return (
      <section style={styles.detailCard} className="ylp-order-detail">
        {ylpDetail?.loading ? <section style={styles.stateCard}>加载中…</section> : null}
        {!ylpDetail?.loading && ylpDetail?.error ? <section style={styles.stateCard}>{ylpDetail.error}</section> : null}

        {!ylpDetail?.loading && !ylpDetail?.error && ylpDetail?.order ? (
          <>
            <header style={styles.detailHero(isMobile)} className="ylp-order-detail-hero">
              <section>
                <p style={styles.detailEyebrow}>YLP Order</p>
                <h3 style={styles.detailTitle}>{ylpDetail.order.customer_name || ylpDetail.order.name || "-"}</h3>
                <p style={styles.detailLead}>{`订单 #${ylpDetail.order.id} · ${ylpDetail.order.version || "-"}`}</p>
              </section>

              <nav style={styles.detailActions(isMobile)}>
                {!versionEditable ? (
                  <button
                    type="button"
                    style={{ ...styles.primaryAction, ...(statusSaving ? styles.pageButtonDisabled : null) }}
                    disabled={statusSaving}
                    onClick={() => void handleCopyYlpOrderToCurrent(ylpDetail.orderId)}
                  >
                    {statusSaving ? "复制中…" : "复制到今年"}
                  </button>
                ) : null}

                <button
                  type="button"
                  style={styles.primaryAction}
                  onClick={() => setPaiweiPreviewOrderId(ylpDetail.orderId)}
                >
                  预览牌位
                </button>

                <button
                  type="button"
                  style={styles.secondaryAction}
                  onClick={() => void handleDownloadPaiwei(ylpDetail.orderId)}
                >
                  下载牌位
                </button>

                <button
                  type="button"
                  style={styles.secondaryAction}
                  onClick={() => void handleDownloadQuotation(ylpDetail.orderId)}
                >
                  下载报价单
                </button>

                <button
                  type="button"
                  style={styles.secondaryAction}
                  onClick={() => void handleCopyShareLink(ylpDetail.orderId)}
                >
                  复制公开链接
                </button>

                {ylpDetail.order.status === "paid" ? (
                  <button
                    type="button"
                    style={styles.secondaryAction}
                    onClick={() => void handleDownloadReceipt(ylpDetail.orderId)}
                  >
                    下载收据
                  </button>
                ) : null}

                {canDelete ? (
                  <button
                    type="button"
                    style={{ ...styles.dangerAction, ...(statusSaving ? styles.pageButtonDisabled : null) }}
                    disabled={statusSaving}
                    onClick={() => void handleDeleteYlpOrder(ylpDetail.orderId)}
                  >
                    删除订单
                  </button>
                ) : null}
              </nav>
            </header>

            <style>{YLP_DETAIL_TABLE_CSS}</style>

            <section style={styles.statusEditRow}>
              <span style={styles.statusEditLabel}>订单状态</span>
              <span style={ylpStatusChipStyle(orderStatus)}>{orderStatusLabel(orderStatus)}</span>
              <span style={ylpStatusChipStyle(ylpDetail.order.status)}>
                {`付款：${paymentStatusLabel(ylpDetail.order.status)}`}
              </span>
              {!versionEditable ? (
                <span style={ylpStatusChipStyle("none")}>{`历史版本（${ylpDetail.order.version}）只读`}</span>
              ) : null}
              {versionEditable && orderStatus === "Draft" ? (
                <>
                  <button
                    type="button"
                    style={{ ...styles.primaryAction, ...(statusSaving ? styles.pageButtonDisabled : null) }}
                    disabled={statusSaving}
                    onClick={() => void handleSetOrderStatus(ylpDetail.orderId, "confirm")}
                  >
                    确认 (Confirm)
                  </button>
                  <button
                    type="button"
                    style={{ ...styles.dangerAction, ...(statusSaving ? styles.pageButtonDisabled : null) }}
                    disabled={statusSaving}
                    onClick={() => void handleSetOrderStatus(ylpDetail.orderId, "cancel")}
                  >
                    取消订单 (Cancel)
                  </button>
                </>
              ) : null}
              {versionEditable && orderStatus === "confirm" ? (
                <>
                  <button
                    type="button"
                    style={{ ...styles.secondaryAction, ...(statusSaving ? styles.pageButtonDisabled : null) }}
                    disabled={statusSaving}
                    onClick={() => void handleSetOrderStatus(ylpDetail.orderId, "Draft")}
                  >
                    取消确认 (Unconfirm)
                  </button>
                  <button
                    type="button"
                    style={{ ...styles.dangerAction, ...(statusSaving ? styles.pageButtonDisabled : null) }}
                    disabled={statusSaving}
                    onClick={() => void handleSetOrderStatus(ylpDetail.orderId, "cancel")}
                  >
                    取消订单 (Cancel)
                  </button>
                </>
              ) : null}
              {versionEditable && orderStatus !== "Draft" && orderStatus !== "confirm" ? (
                <button
                  type="button"
                  style={{ ...styles.secondaryAction, ...(statusSaving ? styles.pageButtonDisabled : null) }}
                  disabled={statusSaving}
                  onClick={() => void handleSetOrderStatus(ylpDetail.orderId, "Draft")}
                >
                  重新打开 (Draft)
                </button>
              ) : null}
            </section>

            <section style={styles.detailSection} className="fahui-detail-section">
              <header style={styles.detailSectionHeader}>
                <h4 style={styles.detailSectionTitle}>
                  订单资料{editable ? "" : versionEditable ? "（已确认，只读）" : "（历史版本，只读）"}
                </h4>
                {editable ? (
                  <button
                    type="button"
                    style={{ ...styles.primaryAction, ...(orderSaving ? styles.pageButtonDisabled : null) }}
                    disabled={orderSaving}
                    onClick={() => void handleSaveOrderInfo(ylpDetail.orderId)}
                  >
                    {orderSaving ? "保存中…" : "保存资料"}
                  </button>
                ) : null}
              </header>
              <div style={styles.tableWrap}>
                <table className="ylp-detail-table">
                  <tbody>
                    <tr>
                      <th style={{ width: 110 }}>订单编号</th>
                      <td>{ylpDetail.order.id}</td>
                    </tr>
                    <tr>
                      <th>功德主</th>
                      <td>
                        {editable ? (
                          <input
                            style={styles.detailInput}
                            value={orderForm.customer_name}
                            disabled={orderSaving}
                            onChange={(event) => setOrderForm((prev) => ({ ...prev, customer_name: event.target.value }))}
                          />
                        ) : (
                          orderForm.customer_name || "-"
                        )}
                      </td>
                    </tr>
                    <tr>
                      <th>联系电话</th>
                      <td>
                        {editable ? (
                          <input
                            style={styles.detailInput}
                            value={orderForm.phone}
                            disabled={orderSaving}
                            placeholder="01X-XXXXXXX"
                            onChange={(event) =>
                              setOrderForm((prev) => ({ ...prev, phone: correctPhoneInputMY(event.target.value) }))
                            }
                          />
                        ) : (
                          orderForm.phone || "-"
                        )}
                      </td>
                    </tr>
                    <tr>
                      <th>Email</th>
                      <td>
                        {editable ? (
                          <input
                            style={styles.detailInput}
                            value={orderForm.email}
                            disabled={orderSaving}
                            onChange={(event) => setOrderForm((prev) => ({ ...prev, email: event.target.value }))}
                          />
                        ) : (
                          orderForm.email || "-"
                        )}
                      </td>
                    </tr>
                    <tr>
                      <th>版本</th>
                      <td>{ylpDetail.order.version || "-"}</td>
                    </tr>
                    <tr>
                      <th>维护人</th>
                      <td>{ylpDetail.order.maintainer_name || "-"}</td>
                    </tr>
                    <tr>
                      <th>创建时间</th>
                      <td>{ylpDetail.order.created_at || "-"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section style={styles.detailSection} className="fahui-detail-section">
              <header style={styles.detailSectionHeader}>
                <h4 style={styles.detailSectionTitle}>
                  付款记录（共 {(ylpDetail.payments || []).length} 条）
                </h4>
                <div style={styles.itemActionCell}>
                  <span style={ylpStatusChipStyle(ylpDetail.order.status)}>{`汇总：${paymentStatusLabel(ylpDetail.order.status)}`}</span>
                  {versionEditable ? (
                    <button type="button" style={styles.addItemToggle} onClick={() => setPaymentModalOpen(true)}>
                      + 新增付款记录
                    </button>
                  ) : null}
                </div>
              </header>

              {ylpDetail.paymentsError ? <p style={styles.emptyText}>{ylpDetail.paymentsError}</p> : null}

              {(ylpDetail.payments || []).length ? (
                <div style={styles.tableWrap}>
                  <table className="ylp-detail-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>方式</th>
                        <th>金额</th>
                        <th>状态</th>
                        <th>时间</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ylpDetail.payments.map((payment) => (
                        <tr key={payment.id}>
                          <td>{payment.id}</td>
                          <td>{payment.payment_mode || "-"}</td>
                          <td>{`RM ${payment.total_price ?? 0}`}</td>
                          <td>
                            <span style={ylpStatusChipStyle(payment.is_approved ? "approved" : payment.status)}>
                              {paymentStatusLabel(payment.is_approved ? "approved" : payment.status)}
                            </span>
                          </td>
                          <td>{payment.created_at || "-"}</td>
                          <td>
                            <div style={styles.itemActionCell}>
                              {/* 有上传凭证就能看，不分付款方式 */}
                              <PaymentProofButton payment={payment} />
                            {/* 待审核的付款可以撤回（改成已拒绝），已审核的走上面的撤销审核 */}
                            {!payment.is_approved &&
                            String(payment.status || "").toLowerCase() === "pending" ? (
                              <button
                                type="button"
                                style={{
                                  ...styles.itemEditButton,
                                  ...(statusSaving ? styles.pageButtonDisabled : null),
                                }}
                                disabled={statusSaving}
                                onClick={() => void handleWithdrawPayment(payment.id, ylpDetail.orderId)}
                              >
                                撤回
                              </button>
                            ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={styles.emptyText}>暂无付款记录</p>
              )}
            </section>

            <section style={styles.detailSection} className="fahui-detail-section">
              <header style={styles.detailSectionHeader}>
                <h4 style={styles.detailSectionTitle}>
                  项目内容（共 {(ylpDetail.order.order_items || []).length} 条）
                </h4>
                {editable ? (
                  <button type="button" style={styles.addItemToggle} onClick={() => setItemModal({ item: null })}>
                    + 添加牌位
                  </button>
                ) : null}
              </header>

              {(ylpDetail.order.order_items || []).length ? (
                <div style={styles.tableWrap}>
                  <table className="ylp-detail-table">
                    <thead>
                      <tr>
                        <th>项目</th>
                        <th>代码</th>
                        <th>金额</th>
                        <th>内容</th>
                        <th>位置</th>
                        {editable ? <th>操作</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {(ylpDetail.order.order_items || []).map((item) => (
                        <tr key={item.id}>
                          <td>{item.item_name || item.code || "项目"}</td>
                          <td>{item.code || "-"}</td>
                          <td>{`RM ${item.price ?? 0}`}</td>
                          <td><YlpItemFields item={item} /></td>
                          <td>{ylpItemLocationText(item) || "-"}</td>
                          {editable ? (
                            <td>
                              <div style={styles.itemActionCell}>
                                <button
                                  type="button"
                                  style={styles.itemEditButton}
                                  onClick={() => setItemModal({ item })}
                                >
                                  编辑
                                </button>
                                <button
                                  type="button"
                                  style={styles.itemDeleteButton}
                                  onClick={() => void handleDeleteYlpItem(ylpDetail.orderId, item.id)}
                                >
                                  删除
                                </button>
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={styles.emptyText}>暂无项目内容</p>
              )}
            </section>
          </>
        ) : null}

        {paymentModalOpen && ylpDetail ? (
          <YlpPaymentModal
            orderId={ylpDetail.orderId}
            defaultAmount={ylpDetail.order?.total_amount ?? 0}
            canApprove={canReviewPayment}
            onClose={() => setPaymentModalOpen(false)}
            onSaved={() => {
              setPaymentModalOpen(false);
              void loadYlpDetail(ylpDetail.orderId);
            }}
          />
        ) : null}

        {itemModal ? (
          <YlpItemModal
            orderId={ylpDetail?.orderId ?? 0}
            item={itemModal.item}
            relationOptions={relationOptions}
            onClose={() => setItemModal(null)}
            onSaved={() => {
              setItemModal(null);
              if (ylpDetail?.orderId) {
                void loadYlpDetail(ylpDetail.orderId);
              }
            }}
          />
        ) : null}

        {paiweiPreviewOrderId ? (
          <div style={styles.itemModalOverlay} onClick={closePaiweiPreview}>
            <div style={styles.pdfModalContent} onClick={(event) => event.stopPropagation()}>
              <div style={styles.addItemHeader}>
                <span style={styles.detailSectionTitle}>牌位预览</span>
                <div style={styles.itemActionCell}>
                  <button type="button" style={styles.addItemCancel} onClick={closePaiweiPreview}>
                    关闭
                  </button>
                </div>
              </div>
              <div style={styles.paiweiPreviewBody}>
                <PaiweiPreviewGrid orderIds={[paiweiPreviewOrderId]} showOrderId={false} />
              </div>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  function renderRegistration(registration: RegistrationRecord, index: number) {
    return (
      <article key={`${registration.devotee_name || "registration"}-${index}`} style={styles.listCard}>
        <p style={styles.listTitle}>{`报名 #${index + 1} · ${registration.devotee_name || "-"}`}</p>
        <p style={styles.listText}>{`电话：${registration.phone || "-"}`}</p>
        <p style={styles.listText}>{`地址：${registration.address || "-"}`}</p>
        <p style={styles.listText}>{`合计：${registration.total_amount ?? "-"}`}</p>

        {(registration.lamps || []).length ? (
          <ul style={styles.lampList}>
            {(registration.lamps || []).map((lamp, lampIndex) => {
              const meta = LAMP_META[lamp.lamp_type] || {};
              const label = meta.withAmount
                ? `${meta.label || lamp.lamp_type}：${lamp.amount ?? "-"}`
                : `${meta.label || lamp.lamp_type}`;

              return <li key={`${lamp.lamp_type}-${lampIndex}`}>{label}</li>;
            })}
          </ul>
        ) : null}
      </article>
    );
  }

  // LAMP（点灯登记管理）作为法会下的一个子工作区，直接渲染独立的点灯工作台。
  if (screen.kind === "workspace" && screen.workspace === "lamp") {
    return <LampWorkspacePage />;
  }

  return (
    <section style={styles.page} className="fahui-page">
      {actionMessage ? <section style={styles.toast} className="fahui-toast">{actionMessage}</section> : null}

      {renderWorkspaceHeader()}

      <div style={styles.workspaceBody(isMobile)} className="fahui-workspace-body">
        <div style={styles.workspaceMain} className="fahui-workspace-main">
          {screen.kind === "workspace" && screen.workspace === "ylp" && screen.section === "orders"
            ? renderYlpOrderList()
            : null}
          {screen.kind === "workspace" && screen.workspace === "ylp" && screen.section === "analysis" ? (
            <YlpAnalyticsPanel
              version={ylpVersion}
              versions={ylpVersions}
              onVersionChange={(next) => {
                setYlpVersion(next);
                setYlpPage(1);
              }}
            />
          ) : null}
          {screen.kind === "ylp-order-detail" ? renderYlpOrderDetailView() : null}
        </div>

        {intakeDrawerOpen ? (
          <YlpDrawer
            isMobile={isMobile}
            navbarHeight={navbarHeight}
            className="ylp-intake-preview-drawer"
            title="牌位填写页 · 手机预览"
            hint="在此模拟手机端直接测试填写流程"
            actions={
              <>
                <a href="/#/ylp-registration" target="_blank" rel="noreferrer" style={styles.itemEditButton}>
                  新标签打开
                </a>
                <button type="button" style={styles.addItemCancel} onClick={() => setIntakeDrawerOpen(false)}>
                  关闭
                </button>
              </>
            }
          >
            <div style={styles.intakePhoneShell}>
              <div style={styles.intakePhoneNotch} />
              <div style={styles.intakePhoneScreenWrap}>
                <iframe
                  title="牌位填写页"
                  src="/#/ylp-registration"
                  style={styles.intakePhoneScreen}
                />
              </div>
              <div style={styles.intakePhoneHomeBar} />
            </div>
          </YlpDrawer>
        ) : null}

        {ylpRowDetailId != null ? (
          <YlpOrderSummaryDrawer
            orderId={ylpRowDetailId}
            isMobile={isMobile}
            navbarHeight={navbarHeight}
            onClose={() => setYlpRowDetailId(null)}
            onOpenDetail={(id) => {
              setYlpRowDetailId(null);
              openYlpDetail(id);
            }}
            onChanged={() => void loadYlpOrders()}
          />
        ) : null}

        {ylpRowPreview ? (
          <YlpDrawer
            isMobile={isMobile}
            navbarHeight={navbarHeight}
            className="ylp-print-preview-drawer"
            title={`订单 #${ylpRowPreview.orderId} · 牌位打印预览`}
            hint="与订单详情的「预览牌位」是同一份打印结果"
            actions={
              <button type="button" style={styles.addItemCancel} onClick={closeYlpRowPreview}>
                关闭
              </button>
            }
          >
            <PaiweiPreviewGrid orderIds={[ylpRowPreview.orderId]} minTileWidth={110} showOrderId={false} />
          </YlpDrawer>
        ) : null}
      </div>

      {paymentConfigOpen ? (
        <PaymentChannelModal version={ylpVersion} onClose={() => setPaymentConfigOpen(false)} />
      ) : null}

      {relationConfigOpen ? <RelationOptionModal onClose={() => setRelationConfigOpen(false)} /> : null}
      {openWindowConfigOpen ? <OpenWindowModal fahuiKey="ylp" onClose={() => setOpenWindowConfigOpen(false)} /> : null}

      {printRecordsOpen ? (
        <PrintRecordsModal
          version={ylpVersion}
          onClose={() => setPrintRecordsOpen(false)}
          onOpenOrder={(orderId) => {
            setPrintRecordsOpen(false);
            openYlpDetail(orderId);
          }}
        />
      ) : null}

      {paiweiJob ? (
        <div style={styles.jobOverlay}>
          <div style={styles.jobCard}>
            <p style={styles.jobTitle}>
              {paiweiJob.status === "done"
                ? "生成完成，开始下载…"
                : paiweiJob.status === "error"
                  ? "生成失败"
                  : "正在生成牌位…"}
            </p>
            {paiweiJob.status === "error" ? (
              <>
                <p style={styles.jobError}>{paiweiJob.message || "请稍后再试"}</p>
                <button type="button" style={styles.jobCloseButton} onClick={() => setPaiweiJob(null)}>
                  关闭
                </button>
              </>
            ) : (
              <>
                <div style={styles.jobBarTrack}>
                  <div style={{ ...styles.jobBarFill, width: `${paiweiJob.percent}%` }} />
                </div>
                <p style={styles.jobPercent}>{paiweiJob.percent}%</p>
                <p style={styles.jobHint}>请勿关闭页面，完成后会自动下载 PDF。</p>
              </>
            )}
          </div>
        </div>
      ) : null}

      {renderYlpRowMenu()}
    </section>
  );

  function renderYlpRowMenu() {
    if (!ylpRowMenu) {
      return null;
    }
    const order = sortedYlpOrders.find((item) => item.id === ylpRowMenu.orderId);
    if (!order) {
      return null;
    }
    // 确认只对今年版本、还是 Draft 的订单开放，跟订单详情页的按钮规则保持一致。
    const versionEditable = isCurrentYlpVersion(order.version || ylpVersion);
    const canConfirm = versionEditable && (order.order_status || "Draft") === "Draft";
    const canRemove = isCurrentYlpVersion(ylpVersion) || ylpVersion === "DELETE";
    // 跟批量栏那颗「批量复制到今年」同一个出现条件：只在看历史版本时才有意义。
    const canCopyToCurrent = !isCurrentYlpVersion(ylpVersion);
    const closeMenu = () => setYlpRowMenu(null);

    return (
      <div
        role="menu"
        style={styles.rowMenu(ylpRowMenu.x, ylpRowMenu.y)}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          disabled={!canConfirm || ylpRowBusy}
          title={
            versionEditable
              ? canConfirm
                ? ""
                : `订单已是 ${order.order_status} 状态，无需确认`
              : "历史版本只读，不能改状态"
          }
          style={{ ...styles.rowMenuItem, ...(!canConfirm || ylpRowBusy ? styles.rowMenuItemDisabled : null) }}
          onClick={() => {
            closeMenu();
            void handleRowConfirmOrder(order.id);
          }}
        >
          确认
        </button>
        {canCopyToCurrent ? (
          <button
            type="button"
            role="menuitem"
            disabled={ylpRowBusy}
            style={{ ...styles.rowMenuItem, ...(ylpRowBusy ? styles.rowMenuItemDisabled : null) }}
            onClick={() => {
              closeMenu();
              void handleRowCopyToCurrent(order.id);
            }}
          >
            复制到今年
          </button>
        ) : null}
        <button
          type="button"
          role="menuitem"
          disabled={!canRemove || ylpRowBusy}
          title={canRemove ? "" : "历史版本只读，不能移除"}
          style={{
            ...styles.rowMenuItem,
            ...styles.rowMenuItemDanger,
            ...(!canRemove || ylpRowBusy ? styles.rowMenuItemDisabled : null),
          }}
          onClick={() => {
            closeMenu();
            void handleRowRemoveOrder(order.id);
          }}
        >
          {ylpVersion === "DELETE" ? "彻底删除" : "移除"}
        </button>
        <button
          type="button"
          role="menuitem"
          style={styles.rowMenuItem}
          onClick={() => {
            closeMenu();
            openYlpDetail(order.id);
          }}
        >
          编辑
        </button>
        <button
          type="button"
          role="menuitem"
          style={styles.rowMenuItem}
          onClick={() => {
            closeMenu();
            closeYlpRowPanels();
            setYlpRowPreview({ orderId: order.id });
          }}
        >
          预览
        </button>
      </div>
    );
  }
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: number | string | null | undefined | ReactNode;
}) {
  return (
    <article style={styles.infoCard}>
      <p style={styles.infoLabel}>{label}</p>
      <p style={styles.infoValue}>{typeof value === "string" || typeof value === "number" ? getValueText(value) : value || "-"}</p>
    </article>
  );
}

// 行操作菜单是 fixed 定位的，翻转/夹边需要提前知道尺寸。
const ROW_MENU_WIDTH = 148;
const ROW_MENU_ITEM_HEIGHT = 38;
const ROW_MENU_PADDING = 12;

function rowMenuHeight(withCopyToCurrent: boolean): number {
  // 确认 / 移除 / 编辑 / 预览，历史版本再加一颗「复制到今年」。
  return (withCopyToCurrent ? 5 : 4) * ROW_MENU_ITEM_HEIGHT + ROW_MENU_PADDING;
}

// 上板进度 → 行样式 / 悬停提示。empty＝这单没有会上板的牌位（只有随缘供斋之类），不着色。
const BOARD_STATUS_CLASS: Record<string, string> = {
  unprinted: "ylp-board-unprinted",
  none: "ylp-board-none",
  partial: "ylp-board-partial",
  all: "ylp-board-all",
};

const BOARD_STATUS_TEXT: Record<string, string> = {
  unprinted: "牌位还没打印",
  none: "已打印，全部未上板",
  partial: "部分牌位未上板",
  all: "全部牌位已上板",
};

function boardStatusClass(status?: string | null): string {
  return BOARD_STATUS_CLASS[String(status || "")] || "";
}

function boardStatusTitle(
  status?: { status?: string; printed?: number; placed?: number; total?: number } | null,
): string {
  if (!status || !status.total) {
    return "";
  }
  const text = BOARD_STATUS_TEXT[String(status.status || "")] || "";
  const counts =
    status.status === "unprinted"
      ? `已打印 ${status.printed ?? 0}/${status.total}`
      : `已上板 ${status.placed ?? 0}/${status.total}`;
  return `${text}（${counts}）`;
}

const YLP_ORDER_TABLE_CSS = `
.ylp-order-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 520px; table-layout: auto; }
.ylp-order-table thead th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; padding: 8px 6px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase;
  color: var(--x-color-ink-muted); background: var(--x-color-canvas-alt);
  border-bottom: 1px solid var(--x-color-line); white-space: nowrap;
}
.ylp-order-table tbody td { padding: 9px 6px; border-bottom: 1px solid var(--x-color-line-soft); vertical-align: middle; color: var(--x-color-ink); }
.ylp-order-table tbody tr.ylp-order-row { cursor: pointer; }
/* 打印 / 上板进度：未打印＝灰，打印了没上板＝暖黄，上了一部分＝浅蓝，全上了＝淡绿；
   没有牌位可上的单不着色。hover 放在后面，优先级更高，压得住这层底色。 */
.ylp-order-table tbody tr.ylp-board-unprinted td { background: var(--x-color-canvas-alt, #f4f4f5); }
.ylp-order-table tbody tr.ylp-board-none td { background: var(--x-color-warning-soft, #fff7ed); }
.ylp-order-table tbody tr.ylp-board-partial td { background: var(--x-color-accent-soft, #eff6ff); }
.ylp-order-table tbody tr.ylp-board-all td { background: var(--x-color-success-soft, #ecfdf5); }

/* hover 不再换底色（会盖掉上板进度那层颜色），改成左侧一条淡淡的提示边。 */
.ylp-order-table tbody tr.ylp-order-row:hover td:first-child {
  box-shadow: inset 3px 0 0 var(--x-color-accent-border);
}

/* 选中行：底色留给上板进度，选中感全部交给「点亮」——
   整行从左边压扁弹开 + 一道白光横扫过去 + 蓝色辉光炸开后收成上下两条亮线，
   左侧一条会呼吸的粗亮条常驻，文字转成强调色加粗。 */
@keyframes ylpRowPop {
  0%   { transform: scaleX(0.985) scaleY(0.86); }
  45%  { transform: scaleX(1.004) scaleY(1.06); }
  75%  { transform: scaleX(1) scaleY(0.985); }
  100% { transform: scale(1); }
}
@keyframes ylpRowBloom {
  0%   { box-shadow: inset 0 0 0 rgba(37, 99, 235, 0), 0 0 0 rgba(37, 99, 235, 0); }
  22%  { box-shadow: inset 0 0 26px rgba(37, 99, 235, 0.38), 0 0 26px 5px rgba(37, 99, 235, 0.55); }
  55%  { box-shadow: inset 0 0 10px rgba(37, 99, 235, 0.16), 0 0 14px 2px rgba(37, 99, 235, 0.32); }
  100% {
    box-shadow:
      inset 0 1px 0 var(--x-color-accent-strong),
      inset 0 -1px 0 var(--x-color-accent-strong),
      0 0 10px 0 rgba(37, 99, 235, 0.26);
  }
}
@keyframes ylpRowSweep {
  0%   { transform: translateX(-60%); opacity: 0; }
  25%  { opacity: 1; }
  100% { transform: translateX(115%); opacity: 0; }
}
@keyframes ylpRowBarBreath {
  0%, 100% { box-shadow: inset 4px 0 0 var(--x-color-accent-strong), -2px 0 10px -2px rgba(37, 99, 235, 0.75); }
  50%      { box-shadow: inset 4px 0 0 var(--x-color-accent-strong), -2px 0 3px -2px rgba(37, 99, 235, 0.25); }
}

.ylp-order-table tbody tr.ylp-order-row-active {
  position: relative;
  transform-origin: left center;
  animation: ylpRowPop 340ms cubic-bezier(0.22, 1, 0.36, 1);
}
/* 横扫的白光：铺在整行上，不吃鼠标事件 */
.ylp-order-table tbody tr.ylp-order-row-active::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    100deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.75) 45%,
    rgba(191, 219, 254, 0.55) 60%,
    rgba(255, 255, 255, 0) 85%
  );
  animation: ylpRowSweep 620ms cubic-bezier(0.25, 0.6, 0.3, 1) 1;
}
.ylp-order-table tbody tr.ylp-order-row-active td {
  /* forwards：动画跑完停在最后一帧，两条亮线常驻 */
  animation: ylpRowBloom 560ms ease-out forwards;
  color: var(--x-color-accent-strong);
  font-weight: 700;
}
.ylp-order-table tbody tr.ylp-order-row-active td:first-child {
  animation: ylpRowBarBreath 2.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .ylp-order-table tbody tr.ylp-order-row-active,
  .ylp-order-table tbody tr.ylp-order-row-active::after,
  .ylp-order-table tbody tr.ylp-order-row-active td,
  .ylp-order-table tbody tr.ylp-order-row-active td:first-child { animation: none; }
  .ylp-order-table tbody tr.ylp-order-row-active td {
    box-shadow: inset 0 1px 0 var(--x-color-accent-strong), inset 0 -1px 0 var(--x-color-accent-strong);
  }
  .ylp-order-table tbody tr.ylp-order-row-active td:first-child {
    box-shadow: inset 4px 0 0 var(--x-color-accent-strong);
  }
}
.ylp-order-table thead th.ylp-sortable { cursor: pointer; user-select: none; }
.ylp-order-table thead th.ylp-sortable:hover { color: var(--x-color-accent-strong); background: var(--x-color-accent-tint); }
.ylp-order-table thead th .ylp-sort-arrow { color: var(--x-color-accent-strong); }
.ylp-order-table .ylp-check-col { width: 30px; text-align: center; cursor: default; padding: 6px 0 6px 4px; }
.ylp-order-table .ylp-check-col input { cursor: pointer; width: 16px; height: 16px; }
.ylp-order-table .ylp-action-col { width: 36px; text-align: center; cursor: default; padding: 6px 2px 6px 0; }
.ylp-order-table .ylp-row-menu-btn {
  width: 26px; height: 26px; padding: 0; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px; border: 1px solid var(--x-color-line-soft);
  background: var(--x-color-panel); color: var(--x-color-ink-muted);
  font-size: 16px; font-weight: 900; cursor: pointer;
}
.ylp-order-table .ylp-row-menu-btn:hover {
  background: var(--x-color-accent-tint);
  color: var(--x-color-accent-strong);
  border-color: var(--x-color-accent-strong);
}
`;

const YLP_DETAIL_TABLE_CSS = `
.ylp-detail-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 480px; }
.ylp-detail-table th {
  text-align: left; padding: 8px 10px; font-weight: 700; white-space: nowrap; vertical-align: middle;
  color: var(--x-color-ink-muted); background: var(--x-color-canvas-alt);
  border-bottom: 1px solid var(--x-color-line-soft);
}
.ylp-detail-table thead th { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
.ylp-detail-table tbody td { padding: 8px 10px; border-bottom: 1px solid var(--x-color-line-soft); vertical-align: middle; color: var(--x-color-ink); }
`;

// 抽屉只有 400px 宽，资料表不需要撑到共用样式那个 480px 下限。

const PAIWEI_FIELD_ORDER = ["owner", "deceased", "relation", "surname", "suffix", "father", "mother", "quantity"];
// 附注已下线：历史数据里零星残留的 note 不再显示
const PAIWEI_HIDDEN_FIELDS = new Set(["note"]);

function YlpItemFields({ item }: { item: YlpOrderItem }) {
  const grouped = item.item_form_data || {};
  const keys = [
    ...PAIWEI_FIELD_ORDER.filter((key) => (grouped[key] || []).length),
    ...Object.keys(grouped).filter(
      (key) => !PAIWEI_FIELD_ORDER.includes(key) && !PAIWEI_HIDDEN_FIELDS.has(key) && (grouped[key] || []).length,
    ),
  ];
  if (!keys.length) {
    return <span style={styles.itemFieldEmpty}>—</span>;
  }
  return (
    <div style={styles.itemFieldList}>
      {keys.map((key) => {
        const values = (grouped[key] || []).map((entry) => String(entry.val || "").trim()).filter(Boolean);
        if (!values.length) {
          return null;
        }
        return (
          <div key={key} style={styles.itemFieldRow}>
            <span style={styles.itemFieldLabel}>
              {paiweiFieldLabel(key, item.code)}
            </span>
            <span style={styles.itemFieldValues}>
              {values.map((value, index) => (
                <span key={`${key}-${index}`} style={styles.itemFieldChip}>
                  {value}
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}


function ylpItemLocationText(item: YlpOrderItem): string {
  return (item.item_location || [])
    .map((location) => {
      const boards = (location.boards || [])
        .map((board) => (board.board_name ? `${board.board_name}${board.location ? ` #${board.location}` : ""}` : null))
        .filter(Boolean)
        .join("、");
      return `PDF ${location.print_pdf?.id || "-"}${boards ? ` · ${boards}` : ""}`;
    })
    .join("；");
}

function ylpStatusChipStyle(status?: string | null): CSSProperties {
  const normalized = String(status || "").toLowerCase();
  const tone: "success" | "danger" | "warning" | "muted" =
    normalized === "approved" || normalized === "paid"
      ? "success"
      : normalized === "rejected" || normalized === "cancelled" || normalized === "canceled" || normalized === "void"
        ? "danger"
        : normalized === "none" || normalized === ""
          ? "muted"
          : "warning";
  const palette =
    tone === "success"
      ? { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" }
      : tone === "danger"
        ? { background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" }
        : tone === "muted"
          ? { background: "var(--x-color-panel-alt)", color: "var(--x-color-ink-muted)" }
          : { background: "var(--x-color-warning-soft)", color: "var(--x-color-warning)" };
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 700,
    whiteSpace: "nowrap",
    ...palette,
  };
}

const styles = {
  page: {
    minHeight: "100%",
    display: "grid",
    gap: "10px",
    padding: "12px",
    borderRadius: "10px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontFamily: '"PingFang SC","Microsoft YaHei",var(--x-font-sans)',
  },
  heroCard: {
    display: "grid",
    gap: "6px",
    padding: "10px 12px",
    borderRadius: "8px",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "none",
  },
  eyebrow: {
    margin: 0,
    fontSize: "11px",
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "var(--x-color-ink-muted)",
  },
  title: {
    margin: 0,
    fontSize: "20px",
    fontWeight: 900,
  },
  subtitle: {
    margin: 0,
    maxWidth: "680px",
    lineHeight: 1.7,
    fontSize: "12px",
    color: "var(--x-color-ink-muted)",
  },
  heroActions: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "6px",
    marginTop: "2px",
  },
  heroActionButton: {
    padding: "7px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
    color: "var(--x-color-ink)",
    fontWeight: 800,
    cursor: "pointer",
    fontSize: "13px",
  },
  choiceGrid: (isMobile: boolean) => ({
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2,minmax(0,1fr))",
    gap: "8px",
  }),
  choiceCard: {
    display: "grid",
    gap: "6px",
    padding: "10px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    textAlign: "left" as const,
    cursor: "pointer",
    boxShadow: "none",
  },
  choiceEyebrow: {
    margin: 0,
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "var(--x-color-accent-strong)",
  },
  choiceTitle: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 900,
  },
  choiceBody: {
    margin: 0,
    fontSize: "12px",
    lineHeight: 1.5,
    color: "var(--x-color-ink-muted)",
  },
  workspaceCard: {
    display: "grid",
    gap: "8px",
  },
  workspaceHeader: (isMobile: boolean, isDetail: boolean) => ({
    display: "grid",
    gridTemplateColumns: isMobile || !isDetail ? "1fr" : "auto minmax(0,1fr)",
    gap: "8px",
    alignItems: "start",
  }),
  backButton: {
    width: "fit-content",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "7px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontWeight: 800,
    cursor: "pointer",
  },
  workspaceCopy: {
    display: "grid",
    gap: "6px",
  },
  workspaceBar: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "8px",
    alignItems: "center",
    justifyContent: "space-between",
  },
  workspaceEyebrow: {
    margin: 0,
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "var(--x-color-accent-strong)",
  },
  workspaceTitle: {
    margin: 0,
    fontSize: "18px",
    lineHeight: 1.1,
    fontWeight: 900,
  },
  workspaceDescription: {
    margin: 0,
    fontSize: "12px",
    lineHeight: 1.5,
    color: "var(--x-color-ink-muted)",
  },
  workspaceHint: {
    margin: 0,
    fontSize: "13px",
    color: "var(--x-color-ink-muted)",
  },
  // 订单列表 ↔ 数据统计的分段按钮（早先 section 还是 tab 时留下的样式，正好接上）
  sectionTabs: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "6px",
  },
  sectionTab: {
    border: "1px solid var(--x-color-line)",
    borderRadius: "6px",
    padding: "6px 9px",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink-muted)",
    fontWeight: 800,
    cursor: "pointer",
  },
  sectionTabActive: {
    background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
    color: "white",
    border: "1px solid transparent",
    boxShadow: "none",
  },
  paymentToolbar: (isMobile: boolean) => ({
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) auto",
    gap: "8px",
    alignItems: "center",
  }),
  orderToolbar: (_isMobile: boolean) => ({
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "8px",
    alignItems: "center",
  }),
  bindBar: {
    display: "flex",
    flexWrap: "wrap" as const,
    alignItems: "center",
    gap: "8px",
    padding: "8px 10px",
    borderRadius: "10px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-alt)",
  },
  bindLabel: {
    fontSize: "12.5px",
    fontWeight: 800,
    color: "var(--x-color-ink)",
    whiteSpace: "nowrap" as const,
  },
  bindHint: {
    fontSize: "11.5px",
    color: "var(--x-color-ink-muted)",
    flex: "1 1 220px",
    minWidth: 0,
  },
  bindChip: {
    padding: "3px 10px",
    borderRadius: "999px",
    background: "var(--x-color-accent-soft)",
    border: "1px solid var(--x-color-accent-border)",
    color: "var(--x-color-accent-strong)",
    fontSize: "12px",
    fontWeight: 700,
  },
  bindAction: {
    padding: "6px 14px",
    borderRadius: "8px",
    border: "none",
    background: "var(--x-color-accent)",
    color: "#fff",
    fontSize: "12.5px",
    fontWeight: 800,
    cursor: "pointer",
  },
  bindGhost: {
    padding: "5px 12px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  bindLink: {
    padding: "5px 12px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-accent-border)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-accent-strong)",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  searchInput: {
    width: "100%",
    padding: "6px 8px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-strongest)",
    boxSizing: "border-box" as const,
    fontSize: "13px",
    color: "var(--x-color-ink)",
  },
  selectInput: {
    minWidth: "150px",
    padding: "6px 8px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-strongest)",
    boxSizing: "border-box" as const,
    fontSize: "13px",
    color: "var(--x-color-ink)",
  },
  summary: {
    margin: 0,
    padding: "7px 9px",
    borderRadius: "6px",
    background: "var(--x-color-panel-glass)",
    border: "1px solid var(--x-color-line-soft)",
    color: "var(--x-color-ink-muted)",
    fontSize: "13px",
    whiteSpace: "nowrap" as const,
  },
  toast: {
    padding: "8px 10px",
    borderRadius: "6px",
    background: "var(--x-color-success-soft)",
    color: "var(--x-color-success)",
    fontWeight: 700,
    border: "1px solid rgba(21, 128, 61, 0.12)",
  },
  stateCard: {
    padding: "14px",
    borderRadius: "6px",
    background: "var(--x-color-panel-strong)",
    boxShadow: "none",
    border: "1px solid var(--x-color-line-soft)",
    textAlign: "center" as const,
    color: "var(--x-color-ink-muted)",
  },
  pagination: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const,
    alignItems: "center" as const,
  },
  pageButton: {
    minWidth: "40px",
    padding: "6px 8px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink-muted)",
    fontWeight: 700,
    cursor: "pointer",
  },
  pageButtonActive: {
    background: "var(--x-color-accent)",
    border: "1px solid var(--x-color-accent)",
    color: "white",
  },
  pageButtonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed" as const,
  },
  pageIndicator: {
    display: "inline-flex",
    alignItems: "center",
    padding: "0 4px",
    color: "var(--x-color-ink-muted)",
    fontSize: "13px",
    fontWeight: 700,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
    gap: "8px",
  },
  tableWrap: {
    width: "100%",
    overflowX: "auto" as const,
    borderRadius: "8px",
    border: "1px solid var(--x-color-line-soft)",
  },
  summaryTag: {
    marginLeft: "6px",
    padding: "1px 6px",
    borderRadius: "999px",
    background: "var(--x-color-accent-tint)",
    color: "var(--x-color-accent-strong)",
    fontSize: "11px",
    fontWeight: 700,
    whiteSpace: "nowrap" as const,
  },
  cellStrong: {
    fontWeight: 700,
    lineHeight: 1.4,
  },
  cellMono: {
    fontFamily: "var(--x-font-mono)",
    fontSize: "12.5px",
    whiteSpace: "nowrap" as const,
  },
  card: {
    display: "grid",
    gap: "6px",
    minHeight: "150px",
    padding: "10px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "none",
  },
  cardApproved: {
    background: "linear-gradient(180deg, var(--x-color-success-soft), var(--x-color-panel))",
  },
  cardPending: {
    background: "linear-gradient(180deg, var(--x-color-warning-soft), var(--x-color-panel))",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "start",
  },
  avatar: {
    width: "30px",
    height: "30px",
    borderRadius: "50%",
    objectFit: "cover" as const,
    border: "2px solid var(--x-color-panel)",
    background: "white",
  },
  cardTitle: {
    margin: 0,
    fontSize: "15px",
    fontWeight: 900,
  },
  cardMeta: {
    margin: 0,
    fontSize: "12px",
    lineHeight: 1.45,
    color: "var(--x-color-ink-muted)",
  },
  typeBadge: (isYlp: boolean) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "fit-content",
    padding: "4px 10px",
    borderRadius: "999px",
    background: isYlp ? "rgba(14, 116, 144, 0.12)" : "rgba(202, 138, 4, 0.12)",
    color: isYlp ? "var(--x-color-info)" : "var(--x-color-warning)",
    fontSize: "12px",
    fontWeight: 800,
    margin: 0,
  }),
  cardNote: {
    margin: 0,
    fontSize: "12px",
    lineHeight: 1.6,
    color: "var(--x-color-ink-muted)",
  },
  cardAction: {
    marginTop: "auto",
    width: "100%",
    padding: "7px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "rgba(255,255,255,0.78)",
    color: "var(--x-color-accent-strong)",
    fontWeight: 800,
    cursor: "pointer",
  },
  orderBadge: {
    margin: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "fit-content",
    padding: "4px 10px",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.75)",
    fontSize: "12px",
    fontWeight: 800,
    color: "var(--x-color-accent-strong)",
  },
  detailCard: {
    display: "grid",
    gap: "8px",
    padding: "10px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-strongest)",
    boxShadow: "none",
  },
  detailHero: (isMobile: boolean) => ({
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) auto",
    gap: "8px",
    alignItems: "start",
  }),
  detailEyebrow: {
    margin: 0,
    fontSize: "12px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "var(--x-color-accent-strong)",
  },
  detailTitle: {
    margin: "6px 0 0",
    fontSize: "20px",
    lineHeight: 1.1,
    fontWeight: 900,
  },
  detailLead: {
    margin: "8px 0 0",
    fontSize: "14px",
    lineHeight: 1.7,
    color: "var(--x-color-ink-muted)",
  },
  detailActions: (isMobile: boolean) => ({
    display: "flex",
    flexWrap: "wrap" as const,
    flexDirection: isMobile ? ("column" as const) : ("row" as const),
    gap: "10px",
  }),
  statusEditRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "8px",
    alignItems: "center",
  },
  statusEditLabel: {
    fontSize: "12px",
    fontWeight: 800,
    color: "var(--x-color-ink-muted)",
  },
  detailInput: {
    width: "100%",
    minWidth: "160px",
    padding: "6px 8px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    boxSizing: "border-box" as const,
    fontSize: "13px",
  },
  itemFieldList: {
    display: "grid",
    gap: "4px",
    minWidth: "180px",
  },
  itemFieldRow: {
    display: "flex",
    gap: "6px",
    alignItems: "flex-start",
    flexWrap: "wrap" as const,
  },
  itemFieldLabel: {
    fontSize: "11px",
    fontWeight: 800,
    color: "var(--x-color-ink-muted)",
    minWidth: "34px",
    paddingTop: "2px",
  },
  itemFieldValues: {
    display: "flex",
    gap: "4px",
    flexWrap: "wrap" as const,
  },
  itemFieldChip: {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: "6px",
    background: "var(--x-color-panel-alt)",
    border: "1px solid var(--x-color-line-soft)",
    color: "var(--x-color-ink)",
    fontSize: "12px",
    fontWeight: 600,
    whiteSpace: "pre-wrap" as const,
  },
  itemFieldEmpty: {
    color: "var(--x-color-ink-muted)",
    fontSize: "12px",
  },
  itemDeleteButton: {
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-danger-border)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    fontWeight: 700,
    fontSize: "12px",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  itemActionCell: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap" as const,
  },
  itemEditButton: {
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontWeight: 700,
    fontSize: "12px",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  addItemToggle: {
    width: "fit-content",
    padding: "6px 12px",
    borderRadius: "6px",
    border: "1px dashed var(--x-color-accent-border)",
    background: "var(--x-color-accent-soft)",
    color: "var(--x-color-accent-strong)",
    fontWeight: 800,
    fontSize: "13px",
    cursor: "pointer",
  },
  itemModalOverlay: {
    position: "fixed" as const,
    inset: 0,
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px",
    background: "rgba(15, 23, 42, 0.55)",
  },
  itemModalContent: {
    width: "min(720px, 100%)",
    maxHeight: "90vh",
    overflowY: "auto" as const,
    display: "grid",
    gap: "12px",
    padding: "16px",
    borderRadius: "12px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    boxShadow: "0 24px 60px var(--x-color-shadow)",
  },
  pdfModalContent: {
    width: "min(900px, 100%)",
    height: "90vh",
    display: "grid",
    gridTemplateRows: "auto 1fr",
    gap: "10px",
    padding: "14px",
    borderRadius: "12px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    boxShadow: "0 24px 60px var(--x-color-shadow)",
  },
  paiweiPreviewBody: {
    overflowY: "auto" as const,
    padding: "4px",
  },
  workspaceBody: (isMobile: boolean) => ({
    display: "flex",
    flexDirection: (isMobile ? "column" : "row") as "column" | "row",
    alignItems: "flex-start",
    gap: "16px",
    width: "100%",
  }),
  workspaceMain: {
    flex: 1,
    minWidth: 0,
    width: "100%",
  },
  intakePhoneShell: {
    position: "relative" as const,
    width: "min(340px, 100%)",
    alignSelf: "start",
    margin: "0 auto",
    background: "linear-gradient(160deg, #1b2432, #0b1220)",
    borderRadius: "46px",
    padding: "14px",
    boxShadow: "0 30px 60px rgba(15,23,42,0.35), inset 0 0 0 2px rgba(255,255,255,0.06)",
    boxSizing: "border-box" as const,
  },
  intakePhoneNotch: {
    position: "absolute" as const,
    top: "22px",
    left: "50%",
    transform: "translateX(-50%)",
    width: "120px",
    height: "24px",
    borderRadius: "999px",
    background: "#05070c",
    zIndex: 2,
  },
  intakePhoneScreenWrap: {
    borderRadius: "34px",
    overflow: "hidden" as const,
    background: "#fff",
    border: "1px solid rgba(0,0,0,0.35)",
  },
  intakePhoneScreen: {
    display: "block",
    width: "100%",
    height: "min(74vh, 720px)",
    border: "none",
    background: "#fff",
  },
  intakePhoneHomeBar: {
    width: "132px",
    height: "5px",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.65)",
    margin: "10px auto 2px",
  },
  addItemHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
  },
  addItemCancel: {
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink-muted)",
    fontWeight: 700,
    fontSize: "12px",
    cursor: "pointer",
  },
  primaryAction: {
    padding: "7px 10px",
    borderRadius: "6px",
    border: "none",
    background: "var(--x-color-accent)",
    color: "white",
    fontWeight: 900,
    cursor: "pointer",
  },
  secondaryAction: {
    padding: "7px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontWeight: 800,
    cursor: "pointer",
  },
  secondaryActionCompact: {
    padding: "7px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  workspaceBarActions: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const,
    alignItems: "center" as const,
  },
  selectAllBanner: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "8px 14px",
    borderRadius: "8px",
    background: "var(--x-color-accent-soft)",
    border: "1px solid var(--x-color-accent-border)",
    color: "var(--x-color-accent-strong)",
    fontSize: "13px",
    fontWeight: 600,
  },
  selectAllLink: {
    background: "transparent",
    border: "none",
    color: "var(--x-color-accent-strong)",
    fontWeight: 800,
    fontSize: "13px",
    cursor: "pointer",
    textDecoration: "underline",
  },
  bulkBar: {
    position: "fixed" as const,
    left: "50%",
    bottom: "20px",
    transform: "translateX(-50%)",
    zIndex: 1100,
    display: "flex",
    alignItems: "center",
    gap: "16px",
    padding: "10px 16px",
    borderRadius: "999px",
    background: "var(--x-color-ink)",
    color: "#fff",
    boxShadow: "0 18px 44px rgba(15,23,42,0.35)",
  },
  bulkButtonPrimary: {
    padding: "8px 14px",
    borderRadius: "999px",
    border: "none",
    background: "var(--x-color-accent)",
    color: "#fff",
    fontWeight: 800,
    fontSize: "13px",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  bulkCount: { fontSize: "13px", fontWeight: 700, whiteSpace: "nowrap" as const },
  jobOverlay: {
    position: "fixed" as const,
    inset: 0,
    zIndex: 1300,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(15, 23, 42, 0.55)",
    padding: "16px",
  },
  jobCard: {
    width: "min(360px, 100%)",
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px",
    padding: "22px",
    borderRadius: "16px",
    background: "var(--x-color-panel)",
    boxShadow: "0 24px 60px var(--x-color-shadow)",
    textAlign: "center" as const,
  },
  jobTitle: { margin: 0, fontSize: "15px", fontWeight: 800, color: "var(--x-color-ink)" },
  jobBarTrack: {
    width: "100%",
    height: "10px",
    borderRadius: "999px",
    background: "var(--x-color-panel-alt)",
    overflow: "hidden" as const,
  },
  jobBarFill: {
    height: "100%",
    borderRadius: "999px",
    background: "var(--x-color-accent)",
    transition: "width 0.25s ease",
  },
  jobPercent: { margin: 0, fontSize: "20px", fontWeight: 800, color: "var(--x-color-accent-strong)" },
  jobHint: { margin: 0, fontSize: "12px", color: "var(--x-color-ink-muted)" },
  jobError: { margin: 0, fontSize: "13px", color: "var(--x-color-danger)" },
  jobCloseButton: {
    padding: "9px 16px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontWeight: 700,
    fontSize: "13px",
    cursor: "pointer",
  },
  bulkActions: { display: "flex", alignItems: "center", gap: "8px" },
  bulkButton: {
    padding: "8px 14px",
    borderRadius: "999px",
    border: "none",
    background: "rgba(255,255,255,0.16)",
    color: "#fff",
    fontWeight: 700,
    fontSize: "13px",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  paymentModalBody: {
    display: "grid",
    gap: "14px",
    padding: "6px 0",
  },
  paymentModalLabel: {
    display: "block",
    marginBottom: "6px",
    fontSize: "12px",
    fontWeight: 800,
    color: "var(--x-color-ink-muted)",
  },
  paymentModeRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const,
  },
  paymentModeButton: {
    padding: "8px 16px",
    borderRadius: "999px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontWeight: 700,
    fontSize: "13px",
    cursor: "pointer",
  },
  paymentModeButtonActive: {
    border: "1px solid var(--x-color-accent-border)",
    background: "var(--x-color-accent-soft)",
    color: "var(--x-color-accent-strong)",
  },
  paymentModalHint: {
    margin: "6px 0 0",
    fontSize: "12px",
    color: "var(--x-color-ink-muted)",
  },
  paymentModalError: {
    padding: "8px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-danger-border)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    fontSize: "12px",
    fontWeight: 700,
  },
  paymentModalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    paddingTop: "10px",
  },
  bulkDanger: {
    padding: "8px 14px",
    borderRadius: "999px",
    border: "none",
    background: "var(--x-color-danger)",
    color: "#fff",
    fontWeight: 700,
    fontSize: "13px",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  bulkCancel: {
    padding: "8px 12px",
    borderRadius: "999px",
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.75)",
    fontWeight: 600,
    fontSize: "13px",
    cursor: "pointer",
  },
  rowMenu: (x: number, y: number) => ({
    position: "fixed" as const,
    left: `${x}px`,
    top: `${y}px`,
    zIndex: 60,
    display: "flex",
    flexDirection: "column" as const,
    width: `${ROW_MENU_WIDTH}px`,
    padding: "6px",
    borderRadius: "12px",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line)",
    boxShadow: "0 18px 44px rgba(15,23,42,0.25)",
  }),
  rowMenuItem: {
    padding: "9px 12px",
    borderRadius: "8px",
    border: "none",
    background: "transparent",
    color: "var(--x-color-ink)",
    fontWeight: 600,
    fontSize: "13px",
    textAlign: "left" as const,
    cursor: "pointer",
  },
  rowMenuItemDanger: {
    color: "var(--x-color-danger)",
  },
  rowMenuItemDisabled: {
    opacity: 0.4,
    cursor: "not-allowed",
  },
  // 抽屉容器的行高是 auto，height:100% 会塌成 0，所以按视窗高度减掉导航条和抽屉自身的边距给个实数。
  printMenuWrap: { position: "relative" as const },
  printMenu: {
    position: "absolute" as const,
    bottom: "calc(100% + 8px)",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    flexDirection: "column" as const,
    minWidth: "132px",
    padding: "6px",
    borderRadius: "12px",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line)",
    boxShadow: "0 18px 44px rgba(15,23,42,0.25)",
  },
  printMenuItem: {
    padding: "9px 12px",
    borderRadius: "8px",
    border: "none",
    background: "transparent",
    color: "var(--x-color-ink)",
    fontWeight: 600,
    fontSize: "13px",
    textAlign: "left" as const,
    cursor: "pointer",
  },
  dangerAction: {
    padding: "7px 10px",
    borderRadius: "6px",
    border: "1px solid rgba(220, 38, 38, 0.18)",
    background: "rgba(254, 226, 226, 0.8)",
    color: "var(--x-color-danger)",
    fontWeight: 900,
    cursor: "pointer",
  },
  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
    gap: "8px",
  },
  infoCard: {
    display: "grid",
    gap: "4px",
    padding: "8px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
  },
  infoLabel: {
    margin: 0,
    fontSize: "12px",
    fontWeight: 700,
    color: "var(--x-color-ink-muted)",
  },
  infoValue: {
    margin: 0,
    fontSize: "13px",
    lineHeight: 1.4,
    color: "var(--x-color-ink)",
    wordBreak: "break-word" as const,
  },
  detailSection: {
    display: "grid",
    gap: "8px",
    paddingTop: "4px",
  },
  detailSectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
  },
  detailSectionTitle: {
    margin: 0,
    fontSize: "15px",
    fontWeight: 900,
    color: "var(--x-color-accent-strong)",
  },
  listSection: {
    display: "grid",
    gap: "6px",
  },
  listCard: {
    display: "grid",
    gap: "4px",
    padding: "8px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
  },
  listTitle: {
    margin: 0,
    fontSize: "13px",
    fontWeight: 800,
    color: "var(--x-color-ink)",
  },
  listText: {
    margin: 0,
    fontSize: "12px",
    lineHeight: 1.5,
    color: "var(--x-color-ink-muted)",
  },
  emptyText: {
    margin: 0,
    fontSize: "14px",
    color: "var(--x-color-ink-muted)",
  },
  inlineList: {
    display: "grid",
    gap: "4px",
    marginTop: "6px",
  },
  lampList: {
    margin: "6px 0 0",
    paddingLeft: "18px",
    fontSize: "13px",
    lineHeight: 1.7,
    color: "var(--x-color-ink)",
  },
};
