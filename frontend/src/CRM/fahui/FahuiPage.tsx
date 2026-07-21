import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useEnsureDesignTokens } from "../../theme/designTokens";
import { useUserState } from "../../app/UserState";
import { CachedImage } from "../../components/CachedMedia";
import { showConfirmDialog } from "../../js/dialogs";
import { downloadBlobOrShare, downloadUrlOrShare } from "../../js/browserActions";
import { show_alert } from "../../js/show_alert";
import { LAMP_META } from "../../lamp/lampMeta";
import { LampWorkspacePage } from "../lamp/react/LampWorkspacePage";
import {
  approvePayment,
  createYlpOrderItem,
  deleteYlpOrderItem,
  downloadYlpPaiwei,
  fetchPayments,
  fetchYlpOrderDetail,
  fetchYlpPayments,
  fetchYlpVersions,
  previewYlpPaiwei,
  removePayment,
  revokePayment,
  searchYlpOrders,
  updateYlpOrderCustomer,
  updateYlpOrderItem,
  updateYlpOrderStatus,
} from "./api";
import {
  PAIWEI_TEMPLATES,
  buildItemPayload,
  createDraft,
  getTemplate,
  getDraftTotalPrice,
  validateDraft,
  type PaiweiCode,
  type PaiweiDraft,
} from "./intake/paiwei";
import type {
  PaymentRecord,
  RegistrationRecord,
  YlpOrderDetail,
  YlpOrderItem,
  YlpOrderSummary,
  YlpPagination,
  YlpPaymentRecord,
} from "./types";

const PAGE_SIZE = 8;
const YLP_ORDER_PAGE_SIZE = 15;

type WorkspaceTab = "lamp" | "ylp";
type WorkspaceSection = "payments" | "orders";
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
  if (workspace === "ylp" && section === "orders") {
    return "订单查询";
  }
  return "付款审核";
}

function getSectionDescription(workspace: WorkspaceTab, section: WorkspaceSection) {
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
  return value === "payments" || value === "orders";
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
    screen = { kind: "workspace", workspace, section: "orders" };
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

export function FahuiPage() {
  useEnsureDesignTokens();

  const location = useLocation();
  const navigate = useNavigate();
  const { isMobile } = useUserState();
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
  const [ylpVersion, setYlpVersion] = useState(initialRouteState.ylpVersion);
  const [ylpQueryInput, setYlpQueryInput] = useState(initialRouteState.ylpQuery);
  const [ylpQuery, setYlpQuery] = useState(initialRouteState.ylpQuery);
  const [ylpPage, setYlpPage] = useState(initialRouteState.ylpPage);
  const [ylpLoading, setYlpLoading] = useState(false);
  const [ylpError, setYlpError] = useState("");
  const [ylpOrders, setYlpOrders] = useState<YlpOrderSummary[]>([]);
  const [ylpPagination, setYlpPagination] = useState<YlpPagination | null>(null);
  const [ylpDetail, setYlpDetail] = useState<YlpDetailState | null>(null);
  const [orderForm, setOrderForm] = useState({ customer_name: "", phone: "", email: "" });
  const [orderSaving, setOrderSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [itemModal, setItemModal] = useState<{ item: YlpOrderItem | null } | null>(null);
  const [paiweiPreviewUrl, setPaiweiPreviewUrl] = useState<string | null>(null);
  const [paiweiPreviewLoading, setPaiweiPreviewLoading] = useState(false);

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

  useEffect(() => {
    if (screen.kind !== "workspace" || screen.workspace !== "ylp" || screen.section !== "orders" || !ylpVersion) {
      return;
    }
    void loadYlpOrders();
  }, [screen, ylpPage, ylpQuery, ylpVersion]);

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
    setPaiweiPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
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
      const versions = (response.data || []).filter(Boolean);
      const preferredVersion =
        versions.find((item) => item === "2025_YLP") ||
        versions.find((item) => item !== "DELETE") ||
        versions[0] ||
        "2025_YLP";

      setYlpVersions(versions);
      setYlpVersion((current) => current || preferredVersion);
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
      });
      setYlpOrders(response.data?.items || []);
      setYlpPagination(response.data?.pagination || null);
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

  async function handlePreviewPaiwei(orderId: number) {
    setPaiweiPreviewLoading(true);
    try {
      const blob = await previewYlpPaiwei(orderId);
      const url = URL.createObjectURL(blob);
      setPaiweiPreviewUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return url;
      });
    } catch (previewError) {
      show_alert("error", previewError instanceof Error ? previewError.message : "预览牌位失败");
    } finally {
      setPaiweiPreviewLoading(false);
    }
  }

  function closePaiweiPreview() {
    setPaiweiPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
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
      message: `确认删除订单 #${orderId}？删除后会从列表隐藏。`,
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setStatusSaving(true);
    try {
      await updateYlpOrderStatus(orderId, "delete");
      setActionMessage("订单已删除");
      setScreen({ kind: "workspace", workspace: "ylp", section: "orders" });
      void loadYlpOrders();
    } catch (deleteError) {
      show_alert("error", deleteError instanceof Error ? deleteError.message : "删除订单失败");
    } finally {
      setStatusSaving(false);
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
    window.open("/#/ylp-registration", "_blank", "noopener,noreferrer");
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
        <section style={styles.workspaceCard}>
          <header style={styles.workspaceHeader(isMobile, true)}>
            <button type="button" style={styles.backButton} onClick={goBack}>
              <i className="fas fa-arrow-left" />
              <span>返回列表</span>
            </button>

            <section style={styles.workspaceCopy}>
              <p style={styles.workspaceEyebrow}>{getWorkspaceEyebrow(currentWorkspace)}</p>
              <h2 style={styles.workspaceTitle}>{title}</h2>
              <p style={styles.workspaceDescription}>{description}</p>
            </section>
          </header>
        </section>
      );
    }

    return (
      <section style={styles.workspaceBar}>
        <section style={styles.workspaceCopy}>
          <p style={styles.workspaceEyebrow}>{getWorkspaceEyebrow(currentWorkspace)}</p>
          <h2 style={styles.workspaceTitle}>{currentWorkspace === "ylp" ? "订单查询" : "法会"}</h2>
          {currentWorkspace === "ylp" ? null : (
            <p style={styles.workspaceHint}>法会付款审核已移至「财政 · 收款审核」统一管理。</p>
          )}
        </section>

        {currentWorkspace === "ylp" ? (
          <button type="button" style={styles.secondaryActionCompact} onClick={openYlpIntakePage}>
            打开牌位填写页
          </button>
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

        <section style={styles.detailCard}>
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
            <section style={styles.detailSection}>
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
            <section style={styles.detailSection}>
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

  function renderYlpOrderList() {
    return (
      <>
        <section style={styles.orderToolbar(isMobile)}>
          <select
            value={ylpVersion}
            onChange={(event) => {
              setYlpVersion(event.target.value);
              setYlpPage(1);
            }}
            style={styles.selectInput}
          >
            {(ylpVersions.length ? ylpVersions : [ylpVersion || "2025_YLP"]).map((version) => (
              <option key={version} value={version}>
                {version}
              </option>
            ))}
          </select>

          <input
            value={ylpQueryInput}
            onChange={(event) => setYlpQueryInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                setYlpQuery(ylpQueryInput.trim());
                setYlpPage(1);
              }
            }}
            placeholder="搜索订单号 / 功德主 / 电话 / 牌位内容"
            style={{ ...styles.searchInput, flex: "1 1 200px", width: "auto", minWidth: 0 }}
          />

          <button
            type="button"
            style={styles.secondaryActionCompact}
            onClick={() => {
              setYlpQuery(ylpQueryInput.trim());
              setYlpPage(1);
            }}
          >
            搜索
          </button>

          <nav style={styles.pagination}>
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

          <p style={styles.summary}>{`共 ${ylpPagination?.total || 0} 条 · ${ylpSafePage}/${ylpTotalPages} 页`}</p>
        </section>

        {ylpLoading ? <section style={styles.stateCard}>加载中…</section> : null}
        {!ylpLoading && ylpError ? <section style={styles.stateCard}>{ylpError}</section> : null}

        {!ylpLoading && !ylpError ? (
          <>
            <div style={styles.tableWrap}>
              <style>{YLP_ORDER_TABLE_CSS}</style>
              <table className="ylp-order-table">
                <thead>
                  <tr>
                    <th>状态</th>
                    <th>单号</th>
                    <th>功德主</th>
                    <th>电话</th>
                    <th>版本</th>
                    <th>创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {ylpOrders.map((order) => (
                    <tr
                      key={order.id}
                      className="ylp-order-row"
                      onClick={() => void openYlpDetail(order.id)}
                    >
                      <td>
                        <span style={ylpStatusChipStyle(order.status)}>{order.status || "-"}</span>
                      </td>
                      <td style={styles.cellMono}>{`#${order.id}`}</td>
                      <td style={styles.cellStrong}>{order.customer_name || order.name || "-"}</td>
                      <td style={styles.cellMono}>{order.phone || "-"}</td>
                      <td>{order.version || "-"}</td>
                      <td style={styles.cellMono}>{order.created_at || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </>
    );
  }

  function renderYlpOrderDetailView() {
    const orderStatus = ylpDetail?.order?.order_status || "Draft";
    const editable = orderStatus === "Draft";
    const canDelete = orderStatus === "cancel";
    return (
      <section style={styles.detailCard}>
        {ylpDetail?.loading ? <section style={styles.stateCard}>加载中…</section> : null}
        {!ylpDetail?.loading && ylpDetail?.error ? <section style={styles.stateCard}>{ylpDetail.error}</section> : null}

        {!ylpDetail?.loading && !ylpDetail?.error && ylpDetail?.order ? (
          <>
            <header style={styles.detailHero(isMobile)}>
              <section>
                <p style={styles.detailEyebrow}>YLP Order</p>
                <h3 style={styles.detailTitle}>{ylpDetail.order.customer_name || ylpDetail.order.name || "-"}</h3>
                <p style={styles.detailLead}>{`订单 #${ylpDetail.order.id} · ${ylpDetail.order.version || "-"}`}</p>
              </section>

              <nav style={styles.detailActions(isMobile)}>
                <button
                  type="button"
                  style={{ ...styles.primaryAction, ...(paiweiPreviewLoading ? styles.pageButtonDisabled : null) }}
                  disabled={paiweiPreviewLoading}
                  onClick={() => void handlePreviewPaiwei(ylpDetail.orderId)}
                >
                  {paiweiPreviewLoading ? "生成中…" : "预览牌位"}
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
              <span style={ylpStatusChipStyle(orderStatus)}>{orderStatus}</span>
              {orderStatus === "Draft" ? (
                <button
                  type="button"
                  style={{ ...styles.primaryAction, ...(statusSaving ? styles.pageButtonDisabled : null) }}
                  disabled={statusSaving}
                  onClick={() => void handleSetOrderStatus(ylpDetail.orderId, "confirm")}
                >
                  确认 (Confirm)
                </button>
              ) : null}
              {orderStatus === "confirm" ? (
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
              {orderStatus !== "Draft" && orderStatus !== "confirm" ? (
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

            <section style={styles.detailSection}>
              <header style={styles.detailSectionHeader}>
                <h4 style={styles.detailSectionTitle}>
                  订单资料{editable ? "" : "（已确认，只读）"}
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
                            onChange={(event) => setOrderForm((prev) => ({ ...prev, phone: event.target.value }))}
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
                      <th>创建时间</th>
                      <td>{ylpDetail.order.created_at || "-"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section style={styles.detailSection}>
              <header style={styles.detailSectionHeader}>
                <h4 style={styles.detailSectionTitle}>
                  付款记录（共 {(ylpDetail.payments || []).length} 条）
                </h4>
                <span style={ylpStatusChipStyle(ylpDetail.order.status)}>{`汇总：${ylpDetail.order.status || "none"}`}</span>
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
                              {payment.is_approved ? "approved" : payment.status || "-"}
                            </span>
                          </td>
                          <td>{payment.created_at || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={styles.emptyText}>暂无付款记录</p>
              )}
            </section>

            <section style={styles.detailSection}>
              <header style={styles.detailSectionHeader}>
                <h4 style={styles.detailSectionTitle}>
                  项目内容（共 {(ylpDetail.order.order_items || []).length} 条）
                </h4>
                {editable ? (
                  <button type="button" style={styles.addItemToggle} onClick={() => setItemModal({ item: null })}>
                    + 添加项目
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

        {itemModal ? (
          <YlpItemModal
            orderId={ylpDetail?.orderId ?? 0}
            item={itemModal.item}
            onClose={() => setItemModal(null)}
            onSaved={() => {
              setItemModal(null);
              if (ylpDetail?.orderId) {
                void loadYlpDetail(ylpDetail.orderId);
              }
            }}
          />
        ) : null}

        {paiweiPreviewUrl ? (
          <div style={styles.itemModalOverlay} onClick={closePaiweiPreview}>
            <div style={styles.pdfModalContent} onClick={(event) => event.stopPropagation()}>
              <div style={styles.addItemHeader}>
                <span style={styles.detailSectionTitle}>牌位预览</span>
                <div style={styles.itemActionCell}>
                  <a href={paiweiPreviewUrl} target="_blank" rel="noreferrer" style={styles.itemEditButton}>
                    新标签打开
                  </a>
                  <button type="button" style={styles.addItemCancel} onClick={closePaiweiPreview}>
                    关闭
                  </button>
                </div>
              </div>
              <iframe title="牌位预览" src={paiweiPreviewUrl} style={styles.pdfFrame} />
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
    <section style={styles.page}>
      {actionMessage ? <section style={styles.toast}>{actionMessage}</section> : null}

      {renderWorkspaceHeader()}

      {screen.kind === "workspace" && screen.workspace === "ylp" && screen.section === "orders"
        ? renderYlpOrderList()
        : null}
      {screen.kind === "ylp-order-detail" ? renderYlpOrderDetailView() : null}
    </section>
  );
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

const YLP_ORDER_TABLE_CSS = `
.ylp-order-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 720px; }
.ylp-order-table thead th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; padding: 9px 12px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--x-color-ink-muted); background: var(--x-color-canvas-alt);
  border-bottom: 1px solid var(--x-color-line); white-space: nowrap;
}
.ylp-order-table tbody td { padding: 10px 12px; border-bottom: 1px solid var(--x-color-line-soft); vertical-align: middle; color: var(--x-color-ink); }
.ylp-order-table tbody tr.ylp-order-row { cursor: pointer; }
.ylp-order-table tbody tr.ylp-order-row:hover td { background: var(--x-color-accent-tint); }
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

const PAIWEI_FIELD_LABELS: Record<string, string> = {
  owner: "阳上",
  deceased: "对象",
  relation: "关系",
  surname: "姓氏",
  suffix: "内容",
  father: "显考",
  mother: "显妣",
  quantity: "数量",
  note: "备注",
};

const PAIWEI_FIELD_ORDER = ["owner", "deceased", "relation", "surname", "suffix", "father", "mother", "quantity", "note"];

function YlpItemFields({ item }: { item: YlpOrderItem }) {
  const grouped = item.item_form_data || {};
  const keys = [
    ...PAIWEI_FIELD_ORDER.filter((key) => (grouped[key] || []).length),
    ...Object.keys(grouped).filter((key) => !PAIWEI_FIELD_ORDER.includes(key) && (grouped[key] || []).length),
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
              {key === "deceased" ? paiweiDeceasedLabel(item.code) : PAIWEI_FIELD_LABELS[key] || key}
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

function ListInput({
  label,
  values,
  disabled,
  onChange,
}: {
  label: string;
  values: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  return (
    <div style={styles.addItemField}>
      <span style={styles.addItemLabel}>{label}</span>
      <div style={styles.listInputWrap}>
        {values.map((value, index) => (
          <div key={index} style={styles.listInputRow}>
            <input
              style={styles.detailInput}
              value={value}
              disabled={disabled}
              placeholder={`${label} ${index + 1}`}
              onChange={(event) => onChange(values.map((entry, i) => (i === index ? event.target.value : entry)))}
            />
            <button
              type="button"
              style={styles.listRemoveButton}
              disabled={disabled || values.length <= 1}
              onClick={() => onChange(values.length <= 1 ? [""] : values.filter((_, i) => i !== index))}
              aria-label="删除这一行"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          style={styles.listAddButton}
          disabled={disabled}
          onClick={() => onChange([...values, ""])}
        >
          + 添加一行
        </button>
      </div>
    </div>
  );
}

const PAIWEI_ROWS_CSS = `
.paiwei-rows { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 320px; }
.paiwei-rows th { text-align: left; padding: 4px 6px; font-size: 11px; font-weight: 800; color: var(--x-color-ink-muted); white-space: nowrap; }
.paiwei-rows td { padding: 4px 6px; vertical-align: middle; }
.paiwei-rows td.paiwei-rows-action { width: 34px; }
`;

// 无缘子女用「子女」，其余（超度亡灵 / 冤亲债主）用「对象」。
function paiweiDeceasedLabel(code?: string | null): string {
  return code === "A3" || code === "B3" ? "子女" : "对象";
}

// 对象/子女 与 关系 是一组一起的（阳上分开填），用一行来对应，整行一起增删。
function PaiweiRowsTable({
  deceaseds,
  relations,
  deceasedLabel,
  disabled,
  onChange,
}: {
  deceaseds: string[];
  relations: string[];
  deceasedLabel: string;
  disabled: boolean;
  onChange: (next: { deceaseds: string[]; relations: string[] }) => void;
}) {
  const rowCount = Math.max(deceaseds.length, relations.length, 1);
  const pad = (values: string[]) => Array.from({ length: rowCount }, (_, index) => values[index] ?? "");

  function updateCell(field: "deceaseds" | "relations", index: number, value: string) {
    const next = { deceaseds: pad(deceaseds), relations: pad(relations) };
    next[field][index] = value;
    onChange(next);
  }

  function addRow() {
    onChange({ deceaseds: [...pad(deceaseds), ""], relations: [...pad(relations), ""] });
  }

  function removeRow(index: number) {
    if (rowCount <= 1) {
      onChange({ deceaseds: [""], relations: [""] });
      return;
    }
    const drop = (values: string[]) => pad(values).filter((_, i) => i !== index);
    onChange({ deceaseds: drop(deceaseds), relations: drop(relations) });
  }

  return (
    <div style={{ ...styles.addItemField, gridColumn: "1 / -1" }}>
      <span style={styles.addItemLabel}>{`${deceasedLabel} / 关系`}</span>
      <div style={styles.tableWrap}>
        <style>{PAIWEI_ROWS_CSS}</style>
        <table className="paiwei-rows">
          <thead>
            <tr>
              <th style={{ width: "40px" }}>#</th>
              <th>{deceasedLabel}</th>
              <th>{PAIWEI_FIELD_LABELS.relation}</th>
              <th className="paiwei-rows-action" />
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, index) => (
              <tr key={index}>
                <td>{index + 1}</td>
                <td>
                  <input
                    style={styles.detailInput}
                    value={deceaseds[index] ?? ""}
                    disabled={disabled}
                    onChange={(event) => updateCell("deceaseds", index, event.target.value)}
                  />
                </td>
                <td>
                  <input
                    style={styles.detailInput}
                    value={relations[index] ?? ""}
                    disabled={disabled}
                    onChange={(event) => updateCell("relations", index, event.target.value)}
                  />
                </td>
                <td className="paiwei-rows-action">
                  <button
                    type="button"
                    style={styles.listRemoveButton}
                    disabled={disabled || rowCount <= 1}
                    onClick={() => removeRow(index)}
                    aria-label="删除这一行"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" style={styles.listAddButton} disabled={disabled} onClick={addRow}>
        + 添加一行
      </button>
    </div>
  );
}


function itemFieldValues(item: YlpOrderItem, key: string): string[] {
  return (item.item_form_data?.[key] || []).map((entry) => String(entry.val ?? "").trim()).filter(Boolean);
}

function YlpItemModal({
  orderId,
  item,
  onClose,
  onSaved,
}: {
  orderId: number;
  item: YlpOrderItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = item != null;
  const [draft, setDraft] = useState<PaiweiDraft>(() => {
    if (!item) {
      return createDraft("A1");
    }
    const code = PAIWEI_TEMPLATES.some((tpl) => tpl.code === item.code) ? (item.code as PaiweiCode) : "A1";
    const base = createDraft(code);
    const first = (key: string) => itemFieldValues(item, key)[0] || "";
    return {
      ...base,
      surname: first("surname"),
      suffix: first("suffix") || base.suffix,
      father: first("father"),
      mother: first("mother"),
      quantity: first("quantity") || base.quantity,
      note: first("note"),
    };
  });
  const seedList = (key: string) => {
    const values = item ? itemFieldValues(item, key) : [];
    return values.length ? values : [""];
  };
  const [owners, setOwners] = useState<string[]>(() => seedList("owner"));
  const [deceaseds, setDeceaseds] = useState<string[]>(() => seedList("deceased"));
  const [relations, setRelations] = useState<string[]>(() => seedList("relation"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const template = getTemplate(draft.code);

  function setField(field: keyof PaiweiDraft, value: string) {
    setError("");
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function changeCode(code: PaiweiCode) {
    const next = getTemplate(code);
    setError("");
    setDraft((prev) => ({
      ...prev,
      code,
      suffix: next.defaultSuffix || prev.suffix,
      quantity: next.fields.quantity ? prev.quantity || "1" : "",
    }));
  }

  function buildDraft(): PaiweiDraft {
    return {
      ...draft,
      owner: owners.join("\n"),
      deceased: deceaseds.join("\n"),
      relation: relations.join("\n"),
    };
  }

  async function submit() {
    const effective = buildDraft();
    const message = validateDraft(effective);
    if (message) {
      setError(message);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = buildItemPayload(effective);
      if (isEdit && item) {
        await updateYlpOrderItem(orderId, item.id, payload);
      } else {
        await createYlpOrderItem(orderId, payload);
      }
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : isEdit ? "保存失败" : "添加失败");
    } finally {
      setSaving(false);
    }
  }

  const textField = (field: keyof PaiweiDraft) => (
    <label style={styles.addItemField}>
      <span style={styles.addItemLabel}>{PAIWEI_FIELD_LABELS[field as string] || String(field)}</span>
      <input
        style={styles.detailInput}
        value={String(draft[field] || "")}
        disabled={saving}
        onChange={(event) => setField(field, event.target.value)}
      />
    </label>
  );

  return (
    <div style={styles.itemModalOverlay} onClick={onClose}>
      <div style={styles.itemModalContent} onClick={(event) => event.stopPropagation()}>
        <div style={styles.addItemHeader}>
          <span style={styles.detailSectionTitle}>{isEdit ? "编辑项目" : "添加项目"}</span>
          <button type="button" style={styles.addItemCancel} onClick={onClose}>
            关闭
          </button>
        </div>

        {error ? <div style={styles.addItemError}>{error}</div> : null}

        <div style={styles.addItemGrid}>
          <label style={styles.addItemField}>
            <span style={styles.addItemLabel}>牌位类型</span>
            <select
              style={styles.selectInput}
              value={draft.code}
              disabled={saving}
              onChange={(event) => changeCode(event.target.value as PaiweiCode)}
            >
              {PAIWEI_TEMPLATES.map((tpl) => (
                <option key={tpl.code} value={tpl.code}>
                  {`${tpl.code} · ${tpl.title} · RM ${tpl.price}`}
                </option>
              ))}
            </select>
          </label>

          {template.fields.owner ? (
            <ListInput label={PAIWEI_FIELD_LABELS.owner} values={owners} disabled={saving} onChange={setOwners} />
          ) : null}
          {template.fields.deceased && template.fields.relation ? (
            <PaiweiRowsTable
              deceaseds={deceaseds}
              relations={relations}
              deceasedLabel={paiweiDeceasedLabel(draft.code)}
              disabled={saving}
              onChange={(next) => {
                setDeceaseds(next.deceaseds);
                setRelations(next.relations);
              }}
            />
          ) : template.fields.deceased ? (
            <ListInput
              label={paiweiDeceasedLabel(draft.code)}
              values={deceaseds}
              disabled={saving}
              onChange={setDeceaseds}
            />
          ) : null}
          {template.fields.surname ? textField("surname") : null}
          {template.fields.suffix ? textField("suffix") : null}
          {template.fields.father ? textField("father") : null}
          {template.fields.mother ? textField("mother") : null}
          {template.fields.quantity ? textField("quantity") : null}
        </div>

        <div style={styles.addItemFooter}>
          <span style={styles.addItemHint}>{`合计 RM ${getDraftTotalPrice(buildDraft())}`}</span>
          <button
            type="button"
            style={{ ...styles.primaryAction, ...(saving ? styles.pageButtonDisabled : null) }}
            disabled={saving}
            onClick={() => void submit()}
          >
            {saving ? "保存中…" : isEdit ? "保存修改" : "添加项目"}
          </button>
        </div>
      </div>
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
  itemEditor: {
    display: "grid",
    gap: "10px",
    padding: "10px",
  },
  listInputWrap: {
    display: "grid",
    gap: "6px",
  },
  listInputRow: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
  },
  listRemoveButton: {
    width: "30px",
    height: "30px",
    flexShrink: 0,
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink-muted)",
    fontSize: "16px",
    lineHeight: 1,
    cursor: "pointer",
  },
  listAddButton: {
    width: "fit-content",
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px dashed var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink-muted)",
    fontWeight: 700,
    fontSize: "12px",
    cursor: "pointer",
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
  addItemForm: {
    display: "grid",
    gap: "10px",
    padding: "12px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-accent-border)",
    background: "var(--x-color-panel-alt)",
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
  pdfFrame: {
    width: "100%",
    height: "100%",
    border: "1px solid var(--x-color-line-soft)",
    borderRadius: "8px",
    background: "var(--x-color-panel-alt)",
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
  addItemError: {
    padding: "6px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-danger-border)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    fontSize: "12px",
    fontWeight: 700,
  },
  addItemGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "8px",
  },
  addItemField: {
    display: "grid",
    gap: "4px",
  },
  addItemLabel: {
    fontSize: "11px",
    fontWeight: 800,
    color: "var(--x-color-ink-muted)",
  },
  addItemTextarea: {
    width: "100%",
    minHeight: "60px",
    padding: "6px 8px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    boxSizing: "border-box" as const,
    fontSize: "13px",
    resize: "vertical" as const,
  },
  addItemFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap" as const,
  },
  addItemHint: {
    fontSize: "13px",
    fontWeight: 800,
    color: "var(--x-color-ink)",
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
