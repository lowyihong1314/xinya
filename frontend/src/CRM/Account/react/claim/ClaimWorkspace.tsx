import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";

import { useUserState } from "../../../../app/UserState";
import { downloadBlobOrShare } from "../../../../js/browserActions";
import { showConfirmDialog, showPromptDialog } from "../../../../js/dialogs";
import { showEventPicker } from "../../../shared/showEventPicker";
import { render_sign_modal } from "../../../../../../static/js/sign_tools.js";
import { decideClaim, deleteClaim, downloadClaimReport, fetchClaims, readClaimBill, submitClaim } from "./api";
import { buildClaimFormData, buildInitialCreateState, validateCreateState } from "./submitCreate";
import { ClaimBatchAiPage } from "./ClaimBatchAiPage";
import { ClaimCreateForm, isReadableBillFile, type CreateState } from "./ClaimCreateForm";
import { buildReadBillFill } from "./readBillFill";
import { summarizeLineItems } from "./lineItems";
import type { AiFillOutcome } from "./AiFillPanel";
import { ClaimDetail } from "./ClaimDetail";
import { ClaimList } from "./ClaimList";
import { BatchWriteJEModal } from "../shared/BatchWriteJEModal";
import { fetchGLSourceMap, type GLSourceEntryRef } from "../gl/api";
import { sortRows, toggleSort, type SortState } from "../shared/tableSort";
import {
  chipStyle,
  noticeErrorStyle,
  noticeSuccessStyle,
  noticeTextStyle,
  noticeTitleStyle,
} from "./claimStyles";
import type { AccountUser, ClaimRecord } from "./types";

type ViewState =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "batchAi" }
  | { kind: "detail"; claimId: number };

type ClaimStatusFilter = "all" | "approved" | "unapproved";

const PAGE_SIZE_DESKTOP = 8;
const PAGE_SIZE_MOBILE = 6;


export function ClaimWorkspace() {
  const { user, isMobile } = useUserState();
  const accountUser = (user as AccountUser | null) ?? null;
  const pageSize = 15;
  const [searchParams, setSearchParams] = useSearchParams();

  const detailClaimId = useMemo(() => {
    const raw = searchParams.get("claim_id");
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);

  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [canViewAll, setCanViewAll] = useState(false);
  const [view, setView] = useState<ViewState>({ kind: "list" });
  const [createState, setCreateState] = useState<CreateState>(() => buildInitialCreateState(accountUser));
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [aiFilling, setAiFilling] = useState(false);
  const [aiOutcome, setAiOutcome] = useState<AiFillOutcome>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  // AI 填写前的整份状态，供「撤销这次填写」还原
  const [aiSnapshot, setAiSnapshot] = useState<CreateState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ClaimStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<number>>(() => new Set());
  const [exportingSelected, setExportingSelected] = useState(false);
  const [exportingReport, setExportingReport] = useState(false);
  const [batchJeOpen, setBatchJeOpen] = useState(false);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [jeMap, setJeMap] = useState<Record<string, GLSourceEntryRef>>({});

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
    if (detailClaimId == null) {
      return null;
    }
    return claims.find((item) => item.id === detailClaimId) ?? null;
  }, [claims, detailClaimId]);

  function openDetail(claimId: number) {
    const next = new URLSearchParams(searchParams);
    next.set("claim_id", String(claimId));
    setSearchParams(next);
    setView({ kind: "list" });
  }

  function closeDetail() {
    const next = new URLSearchParams(searchParams);
    next.delete("claim_id");
    setSearchParams(next);
    setView({ kind: "list" });
  }

  const filteredClaims = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const base = [...claims].sort((left, right) => right.id - left.id).filter((claim) => {
      const claimStatus = getClaimStatusForFilter(claim);
      if (statusFilter === "approved" && claimStatus !== "approved") {
        return false;
      }
      if (statusFilter === "unapproved" && claimStatus === "approved") {
        return false;
      }
      const day = (claim.request_date || "").slice(0, 10);
      if (dateStart && (!day || day < dateStart)) {
        return false;
      }
      if (dateEnd && (!day || day > dateEnd)) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return [
        claim.id,
        claim.applicant_name,
        claim.purpose,
        summarizeLineItems(claim.line_items),
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
    return sortRows(base, sort, (claim, key) => getClaimSortValue(claim, key, jeMap));
  }, [claims, query, statusFilter, dateStart, dateEnd, sort, jeMap]);

  useEffect(() => {
    if (!claims.length) {
      setJeMap({});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const map = await fetchGLSourceMap("reimbursement_request", claims.map((claim) => claim.id));
        if (!cancelled) setJeMap(map);
      } catch {
        if (!cancelled) setJeMap({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claims]);

  const detailNav = useMemo(() => {
    if (detailClaimId == null) {
      return { prevId: null as number | null, nextId: null as number | null, position: "" };
    }
    const index = filteredClaims.findIndex((claim) => claim.id === detailClaimId);
    if (index === -1) {
      return { prevId: null as number | null, nextId: null as number | null, position: "" };
    }
    return {
      prevId: index > 0 ? filteredClaims[index - 1].id : null,
      nextId: index < filteredClaims.length - 1 ? filteredClaims[index + 1].id : null,
      position: `${index + 1} / ${filteredClaims.length}`,
    };
  }, [filteredClaims, detailClaimId]);

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

  async function handleAiFillClaim(model: "auto" | "byteplus" = "auto") {
    setError(null);
    setMessage(null);

    if (!canSubmitClaims) {
      setError("你没有提交申请的权限");
      return;
    }

    const receiptFile = createState.files.find(isReadableBillFile);
    if (!receiptFile) {
      setAiError("请先选择收据图片或 PDF");
      return;
    }

    setAiError(null);
    setAiFilling(true);
    try {
      const result = await readClaimBill(receiptFile, model);
      const data = result.data;
      if (!data) {
        throw new Error("AI 读单没有返回识别结果");
      }

      const { patch, filledLabels, lineCount, total } = buildReadBillFill(data);
      if (!filledLabels.length) {
        setAiError("AI 没有识别到可填写的内容，请手动输入");
        return;
      }

      // 存一份填写前的状态，让「撤销这次填写」能一键还原
      setAiSnapshot(createState);
      setCreateState((prev) => ({ ...prev, ...patch }));
      setAiOutcome({
        filledLabels,
        lineCount,
        total,
        confidence: result.meta?.confidence,
        model,
      });
      setMessage(`AI 读单已填写：${filledLabels.join("、")}`);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI 读单失败");
    } finally {
      setAiFilling(false);
    }
  }

  function handleUndoAiFill() {
    if (!aiSnapshot) return;
    setCreateState(aiSnapshot);
    setAiSnapshot(null);
    setAiOutcome(null);
    setMessage("已撤销这次 AI 填写");
  }

  async function handleCreateSubmit() {
    setError(null);

    if (!canSubmitClaims) {
      setError("你没有提交申请的权限");
      return;
    }

    const validationError = validateCreateState(createState);
    if (validationError) {
      setError(validationError);
      return;
    }

    const formData = buildClaimFormData(createState, accountUser);

    setSubmitting(true);
    try {
      const result = await submitClaim(formData);
      await loadClaims();
      setCreateState(buildInitialCreateState(accountUser));
      setAiOutcome(null);
      setAiSnapshot(null);
      setAiError(null);
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
      closeDetail();
      setMessage(payload.message || "申请已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
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
      await exportClaimsToExcel(selectedClaims, isMobile);
      setMessage(isMobile ? `已分享 ${selectedClaims.length} 笔报销申请 XLSX` : `已下载 ${selectedClaims.length} 笔报销申请 XLSX`);
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
      const filename = `报销申请_Report_${todayFilenameDate()}_${selectedClaims.length}笔.pdf`;
      await downloadBlobOrShare(blob, filename, {
        isMobile,
        title: filename,
        text: `${selectedClaims.length} 笔报销申请 Report`,
        mimeType: "application/pdf",
      });
      setMessage(isMobile ? `已分享 ${selectedClaims.length} 笔报销申请 Report` : `已导出 ${selectedClaims.length} 笔报销申请 Report`);
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

      {detailClaimId == null && view.kind === "list" ? (
        <ClaimList
          isMobile={isMobile}
          loading={loading}
          claims={pagedClaims}
          query={query}
          onQueryChange={setQuery}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          dateStart={dateStart}
          dateEnd={dateEnd}
          onDateStartChange={setDateStart}
          onDateEndChange={setDateEnd}
          jeMap={jeMap}
          sort={sort}
          onSort={(key) => setSort((current) => toggleSort(current, key))}
          page={safePage}
          pageCount={pageCount}
          total={filteredClaims.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onOpen={(claimId) => openDetail(claimId)}
          selectedClaimIds={selectedClaimIds}
          selectedCount={selectedClaimIds.size}
          exportingSelected={exportingSelected}
          exportingReport={exportingReport}
          onToggleClaimSelected={handleToggleClaimSelected}
          onSelectPageClaims={handleSelectPagedClaims}
          onClearSelectedClaims={handleClearSelectedClaims}
          onDownloadSelectedClaims={() => void handleDownloadSelectedClaims()}
          onDownloadSelectedReport={() => void handleDownloadSelectedReport()}
          onBatchWriteJE={() => setBatchJeOpen(true)}
          canBatchJe={canEditClaims}
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

      {detailClaimId == null && view.kind === "batchAi" ? (
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

      {detailClaimId == null && view.kind === "create" ? (
        <ClaimCreateForm
          isMobile={isMobile}
          state={createState}
          user={accountUser}
          submitting={submitting}
          onBack={() => setView({ kind: "list" })}
          onChange={setCreateState}
          onPickEvent={() => void handlePickEvent()}
          onSign={() => void handleSignClaim()}
          onSubmit={() => void handleCreateSubmit()}
          ai={{
            parsing: aiFilling,
            canParse: createState.files.some(isReadableBillFile),
            onParse: (model) => void handleAiFillClaim(model),
            outcome: aiOutcome,
            error: aiError,
            onUndo: aiSnapshot ? handleUndoAiFill : undefined,
          }}
        />
      ) : null}

      {detailClaimId != null ? (
        selectedClaim ? (
          <ClaimDetail
            isMobile={isMobile}
            claim={selectedClaim}
            canEditClaims={canEditClaims}
            isApprovedByMe={isApprovedByMe}
            currentUserId={accountUser?.id}
            onBack={closeDetail}
            onApprove={() => void handleDecision("approve")}
            onReject={() => void handleDecision("reject")}
            onDelete={() => void handleDeleteClaim()}
            onClaimUpdated={handleClaimUpdated}
            onPrev={detailNav.prevId != null ? () => openDetail(detailNav.prevId as number) : undefined}
            onNext={detailNav.nextId != null ? () => openDetail(detailNav.nextId as number) : undefined}
            positionLabel={detailNav.position}
          />
        ) : (
          <div style={claimDetailFallbackStyle}>
            <button type="button" style={claimBackButtonStyle} onClick={closeDetail}>
              ← 返回列表
            </button>
            <div style={{ padding: "24px", textAlign: "center", color: "var(--x-color-ink-muted)" }}>
              {loading ? "正在加载申请…" : "找不到这条报销申请，可能已被删除或数据已刷新。"}
            </div>
          </div>
        )
      ) : null}

      <BatchWriteJEModal
        open={batchJeOpen}
        onClose={() => setBatchJeOpen(false)}
        source="reimbursement"
        sourceRefType="reimbursement_request"
        direction="expense"
        canEdit={canEditClaims}
        docs={claims
          .filter((claim) => selectedClaimIds.has(claim.id))
          .map((claim) => ({
            id: claim.id,
            amount: Number(claim.amount ?? 0),
            date: claim.request_date,
            memo: `报销 #${claim.id}${claim.purpose ? ` · ${claim.purpose}` : ""}`,
          }))}
        onDone={() => void loadClaims()}
      />
    </>
  );
}

const claimDetailFallbackStyle: CSSProperties = {
  borderRadius: "12px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  padding: "16px 18px",
  display: "grid",
  gap: "12px",
};
const claimBackButtonStyle: CSSProperties = {
  width: "fit-content",
  padding: "8px 14px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 600,
  fontSize: "13px",
  cursor: "pointer",
};

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

function getClaimSortValue(
  claim: ClaimRecord,
  key: string,
  jeMap: Record<string, GLSourceEntryRef>,
): number | string | null {
  switch (key) {
    case "status":
      return getClaimStatusForFilter(claim);
    case "je":
      return jeMap[String(claim.id)]?.entry_no ?? null;
    case "applicant":
      return claim.applicant_name || "";
    case "amount":
      return Number(claim.amount ?? 0);
    case "department":
      return claim.department_name || "";
    case "event":
      return claim.event_name || "";
    case "purpose":
      return summarizeLineItems(claim.line_items) || claim.purpose || "";
    case "id":
      return claim.id;
    case "request_date":
      return claim.request_date || "";
    case "approver":
      return (claim.approver_data || []).length;
    default:
      return null;
  }
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

async function exportClaimsToExcel(claims: ClaimRecord[], isMobile: boolean) {
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
      用途说明: claim.purpose || "",
      用途明细: summarizeLineItems(claim.line_items),
      明细行数: (claim.line_items || []).length,
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
  const filename = `报销申请_${todayFilenameDate()}_${claims.length}笔.xlsx`;
  const workbookArray = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  await downloadBlobOrShare(
    new Blob([workbookArray], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename,
    {
      isMobile,
      title: filename,
      text: `${claims.length} 笔报销申请 XLSX`,
    },
  );
}
