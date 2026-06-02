import { useEffect, useRef, useState, type CSSProperties } from "react";

import { apiFetch } from "../../../../js/apiFetch";
import {
  buttonGhostStyle,
  buttonPrimaryStyle,
  buttonSecondaryStyle,
  chipStyle,
  cardBodyStyle,
  cardButtonStyle,
  cardMetaStyle,
  cardTitleStyle,
  chipRowStyle,
  listStyle,
  paginationRowStyle,
  paginationRowTopStyle,
  paginationActionsStyle,
  placeholderStyle,
  resultContainerStyle,
  searchInputStyle,
  statusBadgeStyle,
  toolbarStyle,
} from "./claimStyles";
import type { ApproverUserProfile, ClaimRecord } from "./types";

type ClaimListProps = {
  isMobile: boolean;
  loading: boolean;
  claims: ClaimRecord[];
  query: string;
  onQueryChange: (value: string) => void;
  statusFilter: "all" | "approved" | "unapproved";
  onStatusFilterChange: (value: "all" | "approved" | "unapproved") => void;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onOpen: (claimId: number) => void;
  selectedClaimIds: Set<number>;
  selectedCount: number;
  exportingSelected: boolean;
  exportingReport: boolean;
  onToggleClaimSelected: (claimId: number, selected: boolean) => void;
  onSelectPageClaims: () => void;
  onClearSelectedClaims: () => void;
  onDownloadSelectedClaims: () => void;
  onDownloadSelectedReport: () => void;
  scopeLabel: string;
  onRefresh: () => void;
  onCreate: () => void;
  onBatchAiCreate: () => void;
  canCreate: boolean;
};

export function ClaimList({
  isMobile,
  loading,
  claims,
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
  onOpen,
  selectedClaimIds,
  selectedCount,
  exportingSelected,
  exportingReport,
  onToggleClaimSelected,
  onSelectPageClaims,
  onClearSelectedClaims,
  onDownloadSelectedClaims,
  onDownloadSelectedReport,
  scopeLabel,
  onRefresh,
  onCreate,
  onBatchAiCreate,
  canCreate,
}: ClaimListProps) {
  const [approverUsers, setApproverUsers] = useState<Record<number, ApproverUserProfile>>({});
  const [approverLoadError, setApproverLoadError] = useState("");
  const [resultMaxHeight, setResultMaxHeight] = useState("calc(100dvh - 160px)");
  const resultContainerRef = useRef<HTMLDivElement | null>(null);
  const allVisibleSelected = claims.length > 0 && claims.every((claim) => selectedClaimIds.has(claim.id));

  useEffect(() => {
    const approverIds = Array.from(
      new Set(
        claims.flatMap((claim) => (claim.approver_data || []).map((approver) => approver.user_id).filter(Boolean)),
      ),
    );

    if (!approverIds.length) {
      setApproverUsers({});
      setApproverLoadError("");
      return;
    }

    let cancelled = false;

    async function loadApproverUsers() {
      let hasError = false;
      const entries = await Promise.all(
        approverIds.map(async (userId) => {
          try {
            const response = await apiFetch(`/api/user_control/get_user_detail/${userId}`, {
              credentials: "include",
            });
            const payload = (await response.json().catch(() => ({}))) as ApproverUserProfile;
            if (!response.ok) {
              hasError = true;
              return null;
            }
            return [userId, payload] as const;
          } catch {
            hasError = true;
            return null;
          }
        }),
      );

      if (cancelled) {
        return;
      }

      setApproverUsers(
        Object.fromEntries(entries.filter((item): item is readonly [number, ApproverUserProfile] => Boolean(item))),
      );
      setApproverLoadError(hasError ? "部分审批人信息加载失败" : "");
    }

    void loadApproverUsers();

    return () => {
      cancelled = true;
    };
  }, [claims]);

  useEffect(() => {
    if (loading || !claims.length) {
      return;
    }

    const element = resultContainerRef.current;
    if (!element) {
      return;
    }

    let animationFrame = 0;
    const updateResultMaxHeight = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const elementTop = element.getBoundingClientRect().top;
        const bottomPadding = 8;
        const nextHeight = Math.max(260, Math.floor(viewportHeight - elementTop - bottomPadding));
        setResultMaxHeight(`${nextHeight}px`);
      });
    };

    updateResultMaxHeight();
    window.addEventListener("resize", updateResultMaxHeight);
    window.visualViewport?.addEventListener("resize", updateResultMaxHeight);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updateResultMaxHeight);
      window.visualViewport?.removeEventListener("resize", updateResultMaxHeight);
    };
  }, [claims.length, loading, page, pageCount, query, statusFilter, approverLoadError]);

  return (
    <>
      <div className="claim-list__toolbar" style={toolbarStyle}>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索姓名、用途、活动、状态、金额或单号"
          style={searchInputStyle}
        />
        <select
          value={statusFilter}
          onChange={(event) => onStatusFilterChange(event.target.value as "all" | "approved" | "unapproved")}
          style={statusFilterSelectStyle}
        >
          <option value="all">全部</option>
          <option value="approved">已批准</option>
          <option value="unapproved">未批准</option>
        </select>
        <div className="claim-list__toolbar-spacer" />
        {query ? (
          <button type="button" style={buttonGhostStyle} onClick={() => onQueryChange("")}>
            清空搜索
          </button>
        ) : (
          <div className="claim-list__toolbar-placeholder" />
        )}
      </div>

      {loading ? <div className="claim-list__placeholder" style={placeholderStyle}>载入申请记录中…</div> : null}
      {!loading && !claims.length ? (
        <div className="claim-list__placeholder" style={placeholderStyle}>{query ? "没有匹配的申请记录" : "暂无申请记录"}</div>
      ) : null}
      {approverLoadError ? <div style={{ ...chipStyle, color: "var(--x-color-danger)" }}>{approverLoadError}</div> : null}

      {!loading && claims.length ? (
        <>
          <div className="claim-list__pagination claim-list__pagination--top" style={paginationRowTopStyle}>
            <div className="claim-list__pagination-actions" style={paginationActionsStyle}>
              <span style={chipStyle}>{scopeLabel}</span>
              <span style={chipStyle}>共 {total} 笔 · 已选 {selectedCount}</span>
              <button
                type="button"
                style={disabledButtonStyle(buttonSecondaryStyle, !claims.length || allVisibleSelected)}
                onClick={onSelectPageClaims}
                disabled={!claims.length || allVisibleSelected}
              >
                {allVisibleSelected ? "本页已选" : "选择本页"}
              </button>
              <button
                type="button"
                style={disabledButtonStyle(buttonGhostStyle, selectedCount <= 0)}
                onClick={onClearSelectedClaims}
                disabled={selectedCount <= 0}
              >
                清空选择
              </button>
              <button
                type="button"
                style={disabledButtonStyle(buttonPrimaryStyle, selectedCount <= 0 || exportingSelected)}
                onClick={onDownloadSelectedClaims}
                disabled={selectedCount <= 0 || exportingSelected}
              >
                {exportingSelected ? "生成中…" : "下载XLSX"}
              </button>
              <button
                type="button"
                style={disabledButtonStyle(buttonSecondaryStyle, selectedCount <= 0 || exportingReport)}
                onClick={onDownloadSelectedReport}
                disabled={selectedCount <= 0 || exportingReport}
              >
                {exportingReport ? "生成Report…" : "导出Report"}
              </button>

              {canCreate ? (
                <>
                  <button type="button" style={buttonPrimaryStyle} onClick={onCreate}>
                    新建申请
                  </button>
                  <button type="button" style={buttonSecondaryStyle} onClick={onBatchAiCreate}>
                    批量申请AI
                  </button>
                </>
              ) : null}
            </div>
            <div className="claim-list__pagination-actions" style={paginationActionsStyle}>
              <span style={chipStyle}>
                第 {page} / {pageCount} 页
              </span>
              <button
                type="button"
                style={buttonSecondaryStyle}
                onClick={() => onPageChange(page - 1)}
                disabled={page <= 1}
              >
                上一页
              </button>
              <button
                type="button"
                style={buttonSecondaryStyle}
                onClick={() => onPageChange(page + 1)}
                disabled={page >= pageCount}
              >
                下一页
              </button>
            </div>
          </div>

          <div
            className="claim-list__results"
            ref={resultContainerRef}
            style={{ ...resultContainerStyle, maxHeight: resultMaxHeight }}
          >
            <div className="claim-list__cards" style={claimListStyle(isMobile)}>
              {claims.map((claim) => {
                const claimStatus = getClaimStatus(claim);
                const selected = selectedClaimIds.has(claim.id);
                return (
                  <div key={claim.id} className="claim-list__card" style={claimCardShellStyle(isMobile, selected)}>
                    <div className="claim-list__card-select-row" style={cardSelectRowStyle}>
                      <label className="claim-list__card-select" style={cardSelectLabelStyle}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(event) => onToggleClaimSelected(claim.id, event.target.checked)}
                          style={cardSelectInputStyle}
                        />
                        <span>选择</span>
                      </label>
                      <div className="claim-list__card-status" style={statusBadgeStyle(claimStatus)}>
                        {statusText(claimStatus)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="claim-list__card-open"
                      style={claimCardOpenStyle}
                      onClick={() => onOpen(claim.id)}
                    >
                      <div className="claim-list__card-head">
                        <div className="claim-list__card-title" style={cardTitleStyle}>
                          {claim.applicant_name || "未填姓名"} · RM {safeMoney(claim.amount)}
                        </div>
                        <div className="claim-list__card-meta" style={cardMetaStyle}>
                          单号 #{claim.id} | 日期：{claim.request_date || "-"} | 部门：
                          {claim.department_name || "-"}
                        </div>
                      </div>
                      {claim.purpose ? (
                        <div className="claim-list__card-body" style={cardBodyStyle}>
                          {claim.purpose}
                        </div>
                      ) : null}
                      <div className="claim-list__card-chips" style={chipRowStyle}>
                        <span style={chipStyle}>附件 {(claim.attachments || []).length}</span>
                        {claim.event_id ? <span style={chipStyle}>活动 #{claim.event_id}</span> : null}
                        <span style={chipStyle}>创建 {formatDateTime(claim.created_at)}</span>
                      </div>
                      {claim.approver_data?.length ? (
                        <div className="claim-list__approvers" style={chipRowStyle}>
                          {claim.approver_data.map((approver) => (
                            <span
                              key={`${claim.id}-${approver.user_id}-${approver.decided_at || ""}`}
                              style={{
                                ...chipStyle,
                                color: approver.reject ? "var(--x-color-danger)" : "var(--x-color-success)",
                              }}
                            >
                              {approver.reject ? "拒" : "批"}
                              {resolveApproverName(approver.user_id, approverUsers)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

const statusFilterSelectStyle = {
  ...searchInputStyle,
  width: "150px",
} satisfies CSSProperties;

function disabledButtonStyle(style: CSSProperties, disabled: boolean): CSSProperties {
  return disabled ? { ...style, opacity: 0.55, cursor: "not-allowed" } : style;
}

function claimListStyle(isMobile: boolean): CSSProperties {
  if (isMobile) {
    return listStyle;
  }
  return {
    display: "grid",
    width: "100%",
    minWidth: 0,
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 350px))",
    justifyContent: "center",
    gap: "8px",
    alignItems: "stretch",
  };
}

function claimCardStyle(isMobile: boolean): CSSProperties {
  if (isMobile) {
    return cardButtonStyle;
  }
  return {
    ...cardButtonStyle,
    width: "100%",
    maxWidth: "350px",
    height: "250px",
    alignSelf: "stretch",
  };
}

function claimCardShellStyle(isMobile: boolean, selected: boolean): CSSProperties {
  const base = claimCardStyle(isMobile);
  return {
    ...base,
    cursor: "default",
    border: selected ? "1px solid var(--x-color-accent)" : base.border,
    boxShadow: selected ? "0 0 0 1px var(--x-color-accent)" : "none",
  };
}

const cardSelectRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  minWidth: 0,
  gap: "8px",
  alignItems: "center",
};

const cardSelectLabelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  minHeight: "26px",
  fontSize: "12px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
  cursor: "pointer",
};

const cardSelectInputStyle: CSSProperties = {
  width: "16px",
  height: "16px",
  margin: 0,
  accentColor: "var(--x-color-accent)",
};

const claimCardOpenStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  border: "none",
  padding: 0,
  background: "transparent",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
  display: "grid",
  gap: "7px",
};

function safeMoney(value?: number | string) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return "0.00";
  }
  return amount.toFixed(2);
}

function statusText(status?: string) {
  if (status === "approved") {
    return "已批准";
  }
  if (status === "rejected") {
    return "已拒绝";
  }
  return "待处理";
}

function getClaimStatus(claim: ClaimRecord) {
  const approvers = claim.approver_data || [];
  if (approvers.some((approver) => approver.reject)) {
    return "rejected";
  }
  if (approvers.some((approver) => !approver.reject)) {
    return "approved";
  }
  return "pending";
}

function formatDateTime(value?: string) {
  if (!value) {
    return "-";
  }
  return value.replace("T", " ").slice(0, 16);
}

function resolveApproverName(userId: number, users: Record<number, ApproverUserProfile>) {
  return (
    users[userId]?.display_name ||
    users[userId]?.name_NRIC ||
    users[userId]?.username ||
    `#${userId}`
  );
}
