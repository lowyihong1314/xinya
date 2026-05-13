import { useEffect, useState, type CSSProperties } from "react";

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
  cardTopStyle,
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
  scopeLabel: string;
  onRefresh: () => void;
  onCreate: () => void;
  canCreate: boolean;
};

export function ClaimList({
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
  scopeLabel,
  onRefresh,
  onCreate,
  canCreate,
}: ClaimListProps) {
  const [approverUsers, setApproverUsers] = useState<Record<number, ApproverUserProfile>>({});
  const [approverLoadError, setApproverLoadError] = useState("");

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

  return (
    <div className="claim-list" style={{ display: "grid", gap: "14px", minHeight: 0 }}>
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

              {canCreate ? (
                <button type="button" style={buttonPrimaryStyle} onClick={onCreate}>
                  新建申请
                </button>
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

          <div className="claim-list__results" style={resultContainerStyle}>
            <div className="claim-list__cards" style={listStyle}>
              {claims.map((claim) => (
                <button key={claim.id} type="button" style={cardButtonStyle} onClick={() => onOpen(claim.id)}>
                  <div className="claim-list__card-top" style={cardTopStyle}>
                    <div className="claim-list__card-head">
                      <div className="claim-list__card-title" style={cardTitleStyle}>
                        {claim.applicant_name || "未填姓名"} · RM {safeMoney(claim.amount)}
                      </div>
                      <div className="claim-list__card-meta" style={cardMetaStyle}>
                        单号 #{claim.id} | 日期：{claim.request_date || "-"} | 部门：
                        {claim.department_name || "-"}
                      </div>
                    </div>
                    <div className="claim-list__card-status" style={statusBadgeStyle(getClaimStatus(claim))}>
                      {statusText(getClaimStatus(claim))}
                    </div>
                  </div>
                  {claim.purpose ? <div className="claim-list__card-body" style={cardBodyStyle}>{claim.purpose}</div> : null}
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
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

const statusFilterSelectStyle = {
  ...searchInputStyle,
  width: "150px",
} satisfies CSSProperties;

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
