import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import { useUserState } from "../../../../app/UserState";
import { showConfirmDialog, showPromptDialog } from "../../../../js/dialogs";
import { showEventPicker } from "../../../shared/showEventPicker";
import { render_sign_modal } from "../../../../../../static/js/sign_tools.js";
import { decideClaim, deleteClaim, downloadClaimReport, fetchClaims, readClaimBill, submitClaim } from "./api";
import { ClaimBatchAiPage } from "./ClaimBatchAiPage";
import { ClaimCreateForm, type CreateState } from "./ClaimCreateForm";
import { ClaimDetail } from "./ClaimDetail";
import { ClaimList } from "./ClaimList";
import {
  chipStyle,
  noticeErrorStyle,
  noticeSuccessStyle,
  noticeTextStyle,
  noticeTitleStyle,
} from "./claimStyles";
import type { AccountUser, ClaimRecord, ReadBillData } from "./types";

type ViewState =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "batchAi" }
  | { kind: "detail"; claimId: number };

type ClaimStatusFilter = "all" | "approved" | "unapproved";

const PAGE_SIZE_DESKTOP = 8;
const PAGE_SIZE_MOBILE = 6;

function todayIsoDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildInitialCreateState(user: AccountUser | null): CreateState {
  return {
    applicant_name: String(user?.display_name || user?.name_NRIC || user?.username || ""),
    request_date: todayIsoDate(),
    amount: "",
    department_name: user?.departments?.[0]?.name || "",
    acctDept: "",
    purpose: "",
    ref1: "",
    ref2: "",
    vendor_name: "",
    vendor_address: "",
    vendor_contact_number: "",
    purchase_datetime: "",
    selectedEvent: null,
    files: [],
    signJsonData: null,
  };
}

function isReadableBillFile(file: File) {
  return (
    file.type.startsWith("image/") ||
    file.type === "application/pdf" ||
    /\.(jpe?g|png|webp|bmp|tiff?|pdf)$/i.test(file.name)
  );
}

function stringValue(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function normalizeMoneyValue(value: unknown) {
  if (value == null || value === "") {
    return "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value.toFixed(2) : "";
  }
  const match = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return "";
  }
  const amount = Number(match[0]);
  return Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : "";
}

function toDateInputValue(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeReceiptDate(value: unknown) {
  const rawValue = stringValue(value);
  if (!rawValue) {
    return "";
  }

  const isoMatch = rawValue.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  const slashMatch = rawValue.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (slashMatch) {
    const [, first, second, yyyy] = slashMatch;
    const dd = Number(first) > 12 ? first : Number(second) > 12 ? second : first;
    const mm = dd === first ? second : first;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? "" : toDateInputValue(parsed);
}

function buildPurposeFromReadBill(data: ReadBillData) {
  const merchantName = stringValue(data.merchantName || data.merchant_name);
  const receiptNumber = stringValue(data.receiptNumber || data.receipt_number);
  const expenseCategory = stringValue(data.expenseCategory || data.expense_category);
  const description = stringValue(data.description);
  const itemSummary = (data.receiptItems || data.receipt_items || [])
    .map((item) => {
      const itemDescription = stringValue(item.description);
      const lineTotal = normalizeMoneyValue(item.lineTotal || item.line_total);
      return [itemDescription, lineTotal ? `RM ${lineTotal}` : ""].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .slice(0, 6)
    .join(" / ");

  return [
    merchantName ? `商家：${merchantName}` : "",
    receiptNumber ? `收据号：${receiptNumber}` : "",
    expenseCategory && expenseCategory !== "OTHER" ? `分类：${expenseCategory}` : "",
    description ? `说明：${description}` : "",
    itemSummary ? `项目：${itemSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeReceiptDateTime(value: unknown) {
  const rawValue = stringValue(value);
  if (!rawValue) {
    return "";
  }

  const normalized = rawValue.replace(" ", "T");
  const match = normalized.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:T(\d{1,2}):(\d{2})(?::\d{2})?)?/);
  if (match) {
    const [, yyyy, mm, dd, hh = "00", min = "00"] = match;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T${hh.padStart(2, "0")}:${min}`;
  }

  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  const hh = String(parsed.getHours()).padStart(2, "0");
  const min = String(parsed.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function buildReceiptItemsText(data: ReadBillData) {
  return (data.receiptItems || data.receipt_items || [])
    .map((item, index) => {
      const itemNumber = stringValue(item.itemNumber || item.item_number) || String(index + 1);
      const description = stringValue(item.description);
      const quantity = stringValue(item.quantity);
      const category = stringValue(item.expenseCategory || item.expense_category);
      const lineTotal = normalizeMoneyValue(item.lineTotal || item.line_total);
      return [
        `${itemNumber}.`,
        description,
        quantity ? `x${quantity}` : "",
        category && category !== "OTHER" ? category : "",
        lineTotal ? `RM ${lineTotal}` : "",
      ]
        .filter(Boolean)
        .join(" ");
    })
    .filter(Boolean)
    .join("\n");
}

function buildVendorFieldsFromReadBill(data: ReadBillData) {
  const vendorPayload =
    data.vendorData && typeof data.vendorData === "object"
      ? (data.vendorData as Record<string, unknown>)
      : data.vendor_data && typeof data.vendor_data === "object"
        ? (data.vendor_data as Record<string, unknown>)
        : {};

  return {
    vendor_name: stringValue(
      data.vendorName || data.vendor_name || data.merchantName || data.merchant_name || vendorPayload.name,
    ),
    vendor_address: stringValue(
      data.vendorAddress || data.vendor_address || data.merchantAddress || data.merchant_address || vendorPayload.address,
    ),
    vendor_contact_number: stringValue(
      data.vendorPhone ||
        data.vendor_phone ||
        data.merchantPhone ||
        data.merchant_phone ||
        data.contactNumber ||
        data.contact_number ||
        vendorPayload.phone ||
        vendorPayload.contact_number ||
        vendorPayload.tel,
    ),
  };
}

function formatConfidence(value: unknown) {
  if (value == null || value === "") {
    return "";
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : String(value);
}

export function ClaimWorkspace() {
  const { user, isMobile } = useUserState();
  const accountUser = (user as AccountUser | null) ?? null;
  const pageSize = isMobile ? PAGE_SIZE_MOBILE : PAGE_SIZE_DESKTOP;

  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [canViewAll, setCanViewAll] = useState(false);
  const [view, setView] = useState<ViewState>({ kind: "list" });
  const [createState, setCreateState] = useState<CreateState>(() => buildInitialCreateState(accountUser));
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [aiFilling, setAiFilling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ClaimStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<number>>(() => new Set());
  const [exportingSelected, setExportingSelected] = useState(false);
  const [exportingReport, setExportingReport] = useState(false);

  useEffect(() => {
    const nextInitial = buildInitialCreateState(accountUser);
    setCreateState((prev) => ({
      ...nextInitial,
      ...prev,
      department_name: prev.department_name || nextInitial.department_name,
      applicant_name: prev.applicant_name || nextInitial.applicant_name,
    }));
  }, [accountUser]);

  useEffect(() => {
    void loadClaims();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter]);

  useEffect(() => {
    const validClaimIds = new Set(claims.map((claim) => claim.id));
    setSelectedClaimIds((prev) => {
      let changed = false;
      const next = new Set<number>();
      prev.forEach((claimId) => {
        if (validClaimIds.has(claimId)) {
          next.add(claimId);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [claims]);

  useEffect(() => {
    if (!message && !error) {
      return;
    }
    const timer = window.setTimeout(() => {
      setMessage(null);
      setError(null);
    }, 2800);
    return () => window.clearTimeout(timer);
  }, [message, error]);

  useEffect(() => {
    if (!error) {
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [error]);

  const selectedClaim = useMemo(() => {
    if (view.kind !== "detail") {
      return null;
    }
    return claims.find((item) => item.id === view.claimId) ?? null;
  }, [claims, view]);

  const filteredClaims = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const sorted = [...claims].sort((left, right) => right.id - left.id);
    return sorted.filter((claim) => {
      const claimStatus = getClaimStatusForFilter(claim);
      if (statusFilter === "approved" && claimStatus !== "approved") {
        return false;
      }
      if (statusFilter === "unapproved" && claimStatus === "approved") {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return [
        claim.id,
        claim.applicant_name,
        claim.purpose,
        claim.ref1,
        claim.ref2,
        claim.vendor_name,
        claim.vendor_address,
        claim.vendor_contact_number,
        claim.purchase_datetime,
        claim.event_name,
        claim.event_id,
        claim.department_name,
        claim.request_date,
        claim.status,
        claim.amount,
        statusTextForFilter(claimStatus),
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .some((value) => value.includes(keyword));
    });
  }, [claims, query, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredClaims.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedClaims = filteredClaims.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  const claimPermissions =
    accountUser?.departments?.flatMap((department) => department.permissions || []).map((permission) => permission.name || "") ??
    [];
  const claimPermissionNames = new Set(claimPermissions);
  const canSubmitClaims = claimPermissionNames.has("account_submit_claim");
  const canReadAllClaims = claimPermissionNames.has("account_read") || claimPermissionNames.has("account_edit");
  const canEditClaims = claimPermissionNames.has("account_edit");

  const isApprovedByMe =
    selectedClaim?.approver_data?.some(
      (approver) => approver.user_id === accountUser?.id && approver.reject === false,
    ) ?? false;

  async function loadClaims() {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchClaims();
      setClaims(Array.isArray(payload.data) ? payload.data : []);
      setCanViewAll(Boolean(payload.can_view_all));
    } catch (err) {
      setError(err instanceof Error ? err.message : "载入失败");
    } finally {
      setLoading(false);
    }
  }

  async function handlePickEvent() {
    const selected = await showEventPicker();
    if (!selected) {
      return;
    }
    setCreateState((prev) => ({
      ...prev,
      selectedEvent: { id: selected.id, event_name: selected.event_name },
    }));
  }

  async function handleSignClaim() {
    const nextSign = await render_sign_modal(createState.signJsonData);
    if (!nextSign) {
      return;
    }
    setCreateState((prev) => ({ ...prev, signJsonData: nextSign }));
  }

  async function handleAiFillClaim() {
    setError(null);
    setMessage(null);

    if (!canSubmitClaims) {
      setError("你没有提交申请的权限");
      return;
    }

    const receiptFile = createState.files.find(isReadableBillFile);
    if (!receiptFile) {
      setError("请先上传图片或 PDF 附件");
      return;
    }

    setAiFilling(true);
    try {
      const result = await readClaimBill(receiptFile);
      const data = result.data;
      if (!data) {
        throw new Error("AI fillin 没有返回识别结果");
      }

      const updates: Partial<
        Pick<
          CreateState,
          | "amount"
          | "request_date"
          | "purpose"
          | "ref1"
          | "ref2"
          | "vendor_name"
          | "vendor_address"
          | "vendor_contact_number"
          | "purchase_datetime"
        >
      > = {};
      const updatedFields: string[] = [];
      const amount = normalizeMoneyValue(data.totalAmount || data.total_amount);
      const requestDate = normalizeReceiptDate(data.receiptDate || data.receipt_date || data.purchaseDate || data.purchase_date);
      const purchaseDateTime = normalizeReceiptDateTime(
        data.purchaseDateTime ||
          data.purchaseDatetime ||
          data.purchase_datetime ||
          data.receiptDateTime ||
          data.receipt_date_time ||
          data.receiptDate ||
          data.receipt_date,
      );
      const purpose = buildPurposeFromReadBill(data);
      const ref1 = stringValue(data.description);
      const ref2 = buildReceiptItemsText(data);
      const vendorFields = buildVendorFieldsFromReadBill(data);

      if (amount) {
        updates.amount = amount;
        updatedFields.push("金额");
      }
      if (requestDate) {
        updates.request_date = requestDate;
        updatedFields.push("日期");
      }
      if (purpose) {
        updates.purpose = purpose;
        updatedFields.push("用途说明");
      }
      if (ref1) {
        updates.ref1 = ref1;
        updatedFields.push("AI说明");
      }
      if (ref2) {
        updates.ref2 = ref2;
        updatedFields.push("AI项目内容");
      }
      if (vendorFields.vendor_name) {
        updates.vendor_name = vendorFields.vendor_name;
        updatedFields.push("商家名称");
      }
      if (vendorFields.vendor_address) {
        updates.vendor_address = vendorFields.vendor_address;
        updatedFields.push("商家地址");
      }
      if (vendorFields.vendor_contact_number) {
        updates.vendor_contact_number = vendorFields.vendor_contact_number;
        updatedFields.push("商家联络号码");
      }
      if (purchaseDateTime) {
        updates.purchase_datetime = purchaseDateTime;
        updatedFields.push("采购日期");
      }

      if (!updatedFields.length) {
        setError("AI fillin 没有识别到可填写内容，请手动输入");
        return;
      }

      setCreateState((prev) => ({ ...prev, ...updates }));
      const confidence = formatConfidence(result.meta?.confidence);
      setMessage(`AI fillin 已填写：${updatedFields.join("、")}${confidence ? `（信心 ${confidence}）` : ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI fillin 失败");
    } finally {
      setAiFilling(false);
    }
  }

  async function handleCreateSubmit() {
    setError(null);

    if (!canSubmitClaims) {
      setError("你没有提交申请的权限");
      return;
    }

    if (!createState.signJsonData?.strokes?.length) {
      setError("请先签名");
      return;
    }
    if (!createState.applicant_name.trim()) {
      setError("请填写姓名");
      return;
    }
    if (!createState.request_date) {
      setError("请选择日期");
      return;
    }
    if (!createState.amount || Number(createState.amount) <= 0) {
      setError("请输入正确金额");
      return;
    }
    if (!createState.department_name.trim()) {
      setError("请选择部门");
      return;
    }
    if (!createState.purpose.trim()) {
      setError("请填写用途说明");
      return;
    }

    const formData = new FormData();
    formData.append(
      "sign_json_data",
      JSON.stringify({
        version: 1,
        signed_at: new Date().toISOString(),
        signed_by_user_id: accountUser?.id || null,
        signed_by_username: accountUser?.username || null,
        signed_by_name: accountUser?.display_name || accountUser?.name_NRIC || null,
        strokes: createState.signJsonData.strokes,
      }),
    );
    formData.append("applicant_name", createState.applicant_name.trim());
    formData.append("request_date", createState.request_date);
    formData.append("amount", createState.amount);
    formData.append("department_name", createState.department_name.trim());
    formData.append(
      "purpose",
      createState.acctDept
        ? `【做账分配：${createState.acctDept}】\n${createState.purpose.trim()}`
        : createState.purpose.trim(),
    );
    if (createState.ref1.trim()) {
      formData.append("ref1", createState.ref1.trim());
    }
    if (createState.ref2.trim()) {
      formData.append("ref2", createState.ref2.trim());
    }
    if (createState.vendor_name.trim()) {
      formData.append("vendor_name", createState.vendor_name.trim());
    }
    if (createState.vendor_address.trim()) {
      formData.append("vendor_address", createState.vendor_address.trim());
    }
    if (createState.vendor_contact_number.trim()) {
      formData.append("vendor_contact_number", createState.vendor_contact_number.trim());
    }
    if (createState.purchase_datetime) {
      formData.append("purchase_datetime", createState.purchase_datetime);
    }
    if (createState.selectedEvent?.id) {
      formData.append("event_id", String(createState.selectedEvent.id));
    }
    createState.files.forEach((file) => formData.append("files", file));

    setSubmitting(true);
    try {
      const result = await submitClaim(formData);
      await loadClaims();
      setCreateState(buildInitialCreateState(accountUser));
      setView({ kind: "list" });
      setMessage(`提交成功${result.request_id ? `，单号 #${result.request_id}` : ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecision(action: "approve" | "reject") {
    if (!selectedClaim) {
      return;
    }

    if (!canEditClaims) {
      setError("你没有审批申请的权限");
      return;
    }

    const comment =
      action === "reject"
        ? (await showPromptDialog({
            title: "拒绝申请",
            message: "拒绝原因",
            placeholder: "请输入拒绝原因",
            multiline: true,
            tone: "danger",
          })) || ""
        : (await showPromptDialog({
            title: "审批备注",
            message: "审批备注（可选）",
            placeholder: "可留空",
            multiline: true,
          })) || "";

    if (action === "reject" && !comment.trim()) {
      setError("拒绝必须填写原因");
      return;
    }

    const payload: { action: "approve" | "reject"; comment: string; sign_json_data?: unknown } = {
      action,
      comment,
    };

    if (action === "approve") {
      const sign = await render_sign_modal(null);
      if (!sign?.strokes?.length) {
        setError("批准必须签名");
        return;
      }
      payload.sign_json_data = sign;
    }

    try {
      await decideClaim(selectedClaim.id, payload);
      await loadClaims();
      setMessage(action === "approve" ? "已批准" : "已拒绝");
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function handleDeleteClaim() {
    if (!selectedClaim) {
      return;
    }

    if (!canEditClaims) {
      setError("你没有删除申请的权限");
      return;
    }

    const confirmed = await showConfirmDialog({
      message: `确认删除申请 #${selectedClaim.id} 吗？此操作无法撤销。`,
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    try {
      const payload = await deleteClaim(selectedClaim.id);
      await loadClaims();
      setView({ kind: "list" });
      setMessage(payload.message || "申请已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  function handleFilesChange(event: ChangeEvent<HTMLInputElement>) {
    setCreateState((prev) => ({
      ...prev,
      files: Array.from(event.target.files || []),
    }));
  }

  function handleClaimUpdated(nextClaim: ClaimRecord) {
    setClaims((prev) => prev.map((claim) => (claim.id === nextClaim.id ? nextClaim : claim)));
    setMessage("申请已更新");
    setError(null);
  }

  function handleToggleClaimSelected(claimId: number, selected: boolean) {
    setSelectedClaimIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(claimId);
      } else {
        next.delete(claimId);
      }
      return next;
    });
  }

  function handleSelectPagedClaims() {
    if (!pagedClaims.length) {
      return;
    }
    setSelectedClaimIds((prev) => {
      const next = new Set(prev);
      pagedClaims.forEach((claim) => next.add(claim.id));
      return next;
    });
  }

  function handleClearSelectedClaims() {
    setSelectedClaimIds(new Set());
  }

  async function handleDownloadSelectedClaims() {
    const selectedClaims = claims
      .filter((claim) => selectedClaimIds.has(claim.id))
      .sort((left, right) => right.id - left.id);

    if (!selectedClaims.length) {
      setError("请先选择要下载的报销申请");
      return;
    }

    setError(null);
    setExportingSelected(true);
    try {
      await exportClaimsToExcel(selectedClaims);
      setMessage(`已下载 ${selectedClaims.length} 笔报销申请 XLSX`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "下载 XLSX 失败");
    } finally {
      setExportingSelected(false);
    }
  }

  async function handleDownloadSelectedReport() {
    const selectedClaims = claims
      .filter((claim) => selectedClaimIds.has(claim.id))
      .sort((left, right) => right.id - left.id);

    if (!selectedClaims.length) {
      setError("请先选择要导出 Report 的报销申请");
      return;
    }

    setError(null);
    setExportingReport(true);
    try {
      const blob = await downloadClaimReport(selectedClaims.map((claim) => claim.id));
      downloadBlob(blob, `报销申请_Report_${todayFilenameDate()}_${selectedClaims.length}笔.pdf`);
      setMessage(`已导出 ${selectedClaims.length} 笔报销申请 Report`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出 Report 失败");
    } finally {
      setExportingReport(false);
    }
  }

  return (
    <>
      {message ? (
        <div className="claim-workspace__message claim-workspace__message--success" style={noticeSuccessStyle}>
          <div style={noticeTitleStyle}>操作成功</div>
          <div style={noticeTextStyle}>{message}</div>
        </div>
      ) : null}
      {error ? (
        <div
          className="claim-workspace__message claim-workspace__message--error"
          style={noticeErrorStyle}
          role="alert"
          aria-live="assertive"
        >
          <div style={noticeTitleStyle}>{view.kind === "create" ? "报销申请未提交" : "操作失败"}</div>
          <div style={noticeTextStyle}>{error}</div>
        </div>
      ) : null}

      {view.kind === "list" ? (
        <ClaimList
          isMobile={isMobile}
          loading={loading}
          claims={pagedClaims}
          query={query}
          onQueryChange={setQuery}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          page={safePage}
          pageCount={pageCount}
          total={filteredClaims.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onOpen={(claimId) => setView({ kind: "detail", claimId })}
          selectedClaimIds={selectedClaimIds}
          selectedCount={selectedClaimIds.size}
          exportingSelected={exportingSelected}
          exportingReport={exportingReport}
          onToggleClaimSelected={handleToggleClaimSelected}
          onSelectPageClaims={handleSelectPagedClaims}
          onClearSelectedClaims={handleClearSelectedClaims}
          onDownloadSelectedClaims={() => void handleDownloadSelectedClaims()}
          onDownloadSelectedReport={() => void handleDownloadSelectedReport()}
          scopeLabel={canViewAll || canReadAllClaims ? "范围：全部申请" : "范围：我的申请"}
          onRefresh={() => void loadClaims()}
          canCreate={canSubmitClaims}
          onCreate={() => {
            if (!canSubmitClaims) {
              setError("你没有提交申请的权限");
              return;
            }
            setCreateState(buildInitialCreateState(accountUser));
            setView({ kind: "create" });
          }}
          onBatchAiCreate={() => {
            if (!canSubmitClaims) {
              setError("你没有提交申请的权限");
              return;
            }
            setView({ kind: "batchAi" });
          }}
        />
      ) : null}

      {view.kind === "batchAi" ? (
        <ClaimBatchAiPage
          onBack={() => setView({ kind: "list" })}
          onSubmitted={async (result) => {
            await loadClaims();
            setError(null);
            setView({ kind: "list" });
            setMessage(
              `批量提交成功：${result.count} 个文件${result.claimIds.length ? `，单号 ${result.claimIds.map((id) => `#${id}`).join("、")}` : ""}`,
            );
          }}
        />
      ) : null}

      {view.kind === "create" ? (
        <ClaimCreateForm
          isMobile={isMobile}
          state={createState}
          user={accountUser}
          submitting={submitting}
          aiFilling={aiFilling}
          onBack={() => setView({ kind: "list" })}
          onChange={setCreateState}
          onAiFill={() => void handleAiFillClaim()}
          onPickEvent={() => void handlePickEvent()}
          onSign={() => void handleSignClaim()}
          onSubmit={() => void handleCreateSubmit()}
          onFilesChange={handleFilesChange}
        />
      ) : null}

      {view.kind === "detail" && selectedClaim ? (
        <ClaimDetail
          isMobile={isMobile}
          claim={selectedClaim}
          canEditClaims={canEditClaims}
          isApprovedByMe={isApprovedByMe}
          currentUserId={accountUser?.id}
          onBack={() => setView({ kind: "list" })}
          onApprove={() => void handleDecision("approve")}
          onReject={() => void handleDecision("reject")}
          onDelete={() => void handleDeleteClaim()}
          onClaimUpdated={handleClaimUpdated}
        />
      ) : null}
    </>
  );
}

function getClaimStatusForFilter(claim: ClaimRecord) {
  const approvers = claim.approver_data || [];
  if (approvers.some((approver) => approver.reject)) {
    return "rejected";
  }
  if (approvers.some((approver) => !approver.reject)) {
    return "approved";
  }
  return "pending";
}

function statusTextForFilter(status: string) {
  if (status === "approved") {
    return "已批准";
  }
  if (status === "rejected") {
    return "已拒绝";
  }
  return "待处理";
}

function formatExportMoney(value?: number | string) {
  const amount = Number(value ?? "");
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : "";
}

function formatExportDateTime(value?: string | null) {
  if (!value) {
    return "";
  }
  return value.replace("T", " ").slice(0, 16);
}

function formatAttachmentNames(claim: ClaimRecord) {
  return (claim.attachments || [])
    .map((attachment) => attachment.file_name || attachment.file_path.split(/[\\/]/).pop() || attachment.file_path)
    .filter(Boolean)
    .join(" | ");
}

function formatApproverSummary(claim: ClaimRecord) {
  return (claim.approver_data || [])
    .map((approver) =>
      [
        approver.reject ? "拒绝" : "批准",
        `用户 #${approver.user_id}`,
        approver.decided_at ? formatExportDateTime(approver.decided_at) : "",
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(" | ");
}

function todayFilenameDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

async function exportClaimsToExcel(claims: ClaimRecord[]) {
  const XLSX = await import("xlsx");
  const rows = claims.map((claim) => {
    const claimStatus = getClaimStatusForFilter(claim);
    return {
      单号: claim.id,
      状态: statusTextForFilter(claimStatus),
      申请人: claim.applicant_name || "",
      金额: formatExportMoney(claim.amount),
      申请日期: claim.request_date || "",
      部门: claim.department_name || "",
      用途: claim.purpose || "",
      Ref1: claim.ref1 || "",
      Ref2: claim.ref2 || "",
      商家名称: claim.vendor_name || "",
      商家地址: claim.vendor_address || "",
      商家联络号码: claim.vendor_contact_number || "",
      采购日期: formatExportDateTime(claim.purchase_datetime),
      活动ID: claim.event_id || "",
      活动名称: claim.event_name || "",
      附件数量: (claim.attachments || []).length,
      附件名称: formatAttachmentNames(claim),
      审批记录: formatApproverSummary(claim),
      创建时间: formatExportDateTime(claim.created_at),
      更新时间: formatExportDateTime(claim.updated_at),
    };
  });

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Claims");
  XLSX.writeFile(workbook, `报销申请_${todayFilenameDate()}_${claims.length}笔.xlsx`);
}
