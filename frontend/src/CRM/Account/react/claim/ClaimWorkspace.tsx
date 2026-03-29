import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { useUserState } from "../../../../app/UserState";
import { showEventPicker } from "../../../shared/showEventPicker";
import { render_sign_modal } from "../../../../../../static/js/sign_tools.js";
import { decideClaim, deleteClaim, fetchClaims, submitClaim } from "./api";
import { ClaimCreateForm, type CreateState } from "./ClaimCreateForm";
import { ClaimDetail } from "./ClaimDetail";
import { ClaimList } from "./ClaimList";
import {
  chipStyle,
  noticeErrorStyle,
  noticeSuccessStyle,
  noticeTextStyle,
  noticeTitleStyle,
  scrollPanelStyle,
  shellStyle,
} from "./claimStyles";
import type { AccountUser, ClaimRecord } from "./types";

type ViewState =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "detail"; claimId: number };

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
    selectedEvent: null,
    files: [],
    signJsonData: null,
  };
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const scrollPanelRef = useRef<HTMLDivElement | null>(null);

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
  }, [query]);

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
    scrollPanelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
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
    if (!keyword) {
      return sorted;
    }
    return sorted.filter((claim) =>
      [
        claim.id,
        claim.applicant_name,
        claim.purpose,
        claim.event_name,
        claim.event_id,
        claim.department_name,
        claim.request_date,
        claim.status,
        claim.amount,
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .some((value) => value.includes(keyword)),
    );
  }, [claims, query]);

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
  const canSubmitClaims = claimPermissionNames.has("account_submit");
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
        ? window.prompt("拒绝原因") || ""
        : window.prompt("审批备注（可选）") || "";

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

    const confirmed = window.confirm(`确认删除申请 #${selectedClaim.id} 吗？此操作无法撤销。`);
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
    setMessage("活动已更新");
    setError(null);
  }

  return (
    <div className="claim-workspace" style={shellStyle}>
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

      <div className="claim-workspace__scroll-panel" style={scrollPanelStyle} ref={scrollPanelRef}>
        {view.kind === "list" ? (
          <ClaimList
            loading={loading}
            claims={pagedClaims}
            query={query}
            onQueryChange={setQuery}
            page={safePage}
            pageCount={pageCount}
            total={filteredClaims.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onOpen={(claimId) => setView({ kind: "detail", claimId })}
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
          />
        ) : null}

        {view.kind === "create" ? (
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
      </div>
    </div>
  );
}
