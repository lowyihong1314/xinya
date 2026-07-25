import { useEffect, useState, type CSSProperties } from "react";

import { apiFetch } from "../../../../js/apiFetch";
import { TablePagination } from "../../../shared/TablePagination";
import type { GLSourceEntryRef } from "../gl/api";
import { sortArrow, sortableThStyle, type SortState } from "../shared/tableSort";
import { displayPurpose } from "./purpose";
import type { ApproverUserProfile, ClaimRecord } from "./types";

type ClaimStatusFilter = "all" | "approved" | "unapproved";

type ClaimListProps = {
  isMobile: boolean;
  loading: boolean;
  claims: ClaimRecord[];
  query: string;
  onQueryChange: (value: string) => void;
  statusFilter: ClaimStatusFilter;
  onStatusFilterChange: (value: ClaimStatusFilter) => void;
  dateStart: string;
  dateEnd: string;
  onDateStartChange: (value: string) => void;
  onDateEndChange: (value: string) => void;
  jeMap: Record<string, GLSourceEntryRef>;
  sort: SortState;
  onSort: (key: string) => void;
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
  onBatchWriteJE: () => void;
  canBatchJe: boolean;
  scopeLabel: string;
  onRefresh: () => void;
  onCreate: () => void;
  onBatchAiCreate: () => void;
  canCreate: boolean;
};

const STATUS_TABS: { key: ClaimStatusFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "approved", label: "已批准" },
  { key: "unapproved", label: "未批准" },
];

export function ClaimList(props: ClaimListProps) {
  const {
    loading,
    claims,
    query,
    onQueryChange,
    statusFilter,
    onStatusFilterChange,
    dateStart,
    dateEnd,
    onDateStartChange,
    onDateEndChange,
    jeMap,
    sort,
    onSort,
    page,
    pageCount,
    total,
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
    onBatchWriteJE,
    canBatchJe,
    scopeLabel,
    onRefresh,
    onCreate,
    onBatchAiCreate,
    canCreate,
  } = props;

  const [approverUsers, setApproverUsers] = useState<Record<number, ApproverUserProfile>>({});
  const allVisibleSelected = claims.length > 0 && claims.every((claim) => selectedClaimIds.has(claim.id));

  useEffect(() => {
    const approverIds = Array.from(
      new Set(claims.flatMap((claim) => (claim.approver_data || []).map((a) => a.user_id).filter(Boolean))),
    );
    if (!approverIds.length) {
      setApproverUsers({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        approverIds.map(async (userId) => {
          try {
            const response = await apiFetch(`/api/user_control/get_user_detail/${userId}`, { credentials: "include" });
            const payload = (await response.json().catch(() => ({}))) as ApproverUserProfile;
            return response.ok ? ([userId, payload] as const) : null;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setApproverUsers(Object.fromEntries(entries.filter((item): item is readonly [number, ApproverUserProfile] => Boolean(item))));
    })();
    return () => {
      cancelled = true;
    };
  }, [claims]);

  return (
    <section style={panelStyle}>
      <style>{TABLE_CSS}</style>

      <div style={toolbarStyle}>
        <div>
          <div style={eyebrowStyle}>财务 / 报销申请</div>
          <h2 style={titleStyle}>报销申请</h2>
          <div style={mutedStyle}>
            {scopeLabel} · 共 {total} 笔 · 已选 {selectedCount}
          </div>
        </div>
        <div style={rowStyle}>
          <button type="button" style={btnStyle} onClick={onRefresh} disabled={loading}>
            {loading ? "刷新中…" : "刷新"}
          </button>
          {canCreate ? (
            <>
              <button type="button" style={primaryButtonStyle} onClick={onCreate}>新建申请</button>
              <button type="button" style={btnStyle} onClick={onBatchAiCreate}>批量申请AI</button>
            </>
          ) : null}
        </div>
      </div>

      <div style={filterBarStyle}>
        <div style={tabBarStyle}>
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              style={tab.key === statusFilter ? tabActiveStyle : tabStyle}
              onClick={() => onStatusFilterChange(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div style={filterRightStyle}>
          <div style={dateRangeStyle}>
            <span style={mutedStyle}>日期</span>
            <input type="date" value={dateStart} onChange={(event) => onDateStartChange(event.target.value)} style={dateInputStyle} />
            <span style={mutedStyle}>–</span>
            <input type="date" value={dateEnd} onChange={(event) => onDateEndChange(event.target.value)} style={dateInputStyle} />
            {dateStart || dateEnd ? (
              <button
                type="button"
                style={btnStyle}
                onClick={() => {
                  onDateStartChange("");
                  onDateEndChange("");
                }}
              >
                清除
              </button>
            ) : null}
          </div>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索姓名、用途、活动、状态、金额或单号"
            style={searchInputStyle}
          />
        </div>
      </div>

      {loading ? <div style={emptyStyle}>载入申请记录中…</div> : null}
      {!loading && !claims.length ? <div style={emptyStyle}>{query ? "没有匹配的申请记录" : "暂无申请记录"}</div> : null}

      {!loading && claims.length ? (
        <div style={{ display: "grid", gap: "8px", padding: "12px 14px 4px" }}>
          <div style={bulkBarStyle}>
            <button type="button" style={disabledBtn(btnStyle, allVisibleSelected)} onClick={onSelectPageClaims} disabled={allVisibleSelected}>
              {allVisibleSelected ? "本页已选" : "选择本页"}
            </button>
            <button type="button" style={disabledBtn(btnStyle, selectedCount <= 0)} onClick={onClearSelectedClaims} disabled={selectedCount <= 0}>
              清空选择
            </button>
            <button type="button" style={disabledBtn(primaryButtonStyle, selectedCount <= 0 || exportingSelected)} onClick={onDownloadSelectedClaims} disabled={selectedCount <= 0 || exportingSelected}>
              {exportingSelected ? "生成中…" : "下载 XLSX"}
            </button>
            <button type="button" style={disabledBtn(btnStyle, selectedCount <= 0 || exportingReport)} onClick={onDownloadSelectedReport} disabled={selectedCount <= 0 || exportingReport}>
              {exportingReport ? "生成 Report…" : "导出 Report"}
            </button>
            {canBatchJe ? (
              <button type="button" style={disabledBtn(primaryButtonStyle, selectedCount <= 0)} onClick={onBatchWriteJE} disabled={selectedCount <= 0}>
                批量写 JE
              </button>
            ) : null}
          </div>

          <TablePagination page={page} totalPages={pageCount} total={total} onPage={onPageChange} />

          <div style={tableWrapStyle}>
            <table className="claim-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      aria-label="当页全选"
                      checked={allVisibleSelected}
                      onChange={(event) => {
                        if (event.target.checked) {
                          onSelectPageClaims();
                        } else {
                          claims.forEach((claim) => onToggleClaimSelected(claim.id, false));
                        }
                      }}
                      style={{ width: 16, height: 16, accentColor: "var(--x-color-accent)" }}
                    />
                  </th>
                  <th style={sortableThStyle} onClick={() => onSort("status")}>状态{sortArrow(sort, "status")}</th>
                  <th style={sortableThStyle} onClick={() => onSort("je")}>JE{sortArrow(sort, "je")}</th>
                  <th style={sortableThStyle} onClick={() => onSort("applicant")}>申请人{sortArrow(sort, "applicant")}</th>
                  <th style={sortableThStyle} onClick={() => onSort("amount")}>金额{sortArrow(sort, "amount")}</th>
                  <th style={sortableThStyle} onClick={() => onSort("event")}>活动{sortArrow(sort, "event")}</th>
                  <th style={sortableThStyle} onClick={() => onSort("purpose")}>用途{sortArrow(sort, "purpose")}</th>
                  <th style={sortableThStyle} onClick={() => onSort("id")}>单号{sortArrow(sort, "id")}</th>
                  <th style={sortableThStyle} onClick={() => onSort("request_date")}>日期{sortArrow(sort, "request_date")}</th>
                  <th style={sortableThStyle} onClick={() => onSort("approver")}>审批{sortArrow(sort, "approver")}</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((claim) => {
                  const status = getClaimStatus(claim);
                  const selected = selectedClaimIds.has(claim.id);
                  return (
                    <tr key={claim.id} className="claim-row" onClick={() => onOpen(claim.id)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(event) => onToggleClaimSelected(claim.id, event.target.checked)}
                          style={{ width: 16, height: 16, accentColor: "var(--x-color-accent)" }}
                        />
                      </td>
                      <td><span style={chipStyle(statusTone(status))}>{statusText(status)}</span></td>
                      <td>{renderJeCell(jeMap[String(claim.id)])}</td>
                      <td style={cellStrongStyle}>{claim.applicant_name || "未填姓名"}</td>
                      <td style={cellStrongStyle}>RM {safeMoney(claim.amount)}</td>
                      <td>{claim.event_name || "-"}</td>
                      <td style={purposeCellStyle} title={displayPurpose(claim.purpose)}>{displayPurpose(claim.purpose) || "-"}</td>
                      <td style={monoCellStyle}>#{claim.id}</td>
                      <td style={monoCellStyle}>{claim.request_date || "-"}</td>
                      <td>
                        {claim.approver_data?.length ? (
                          <div style={approverWrapStyle}>
                            {claim.approver_data.map((approver) => (
                              <span
                                key={`${claim.id}-${approver.user_id}-${approver.decided_at || ""}`}
                                style={approverChipStyle(approver.reject)}
                              >
                                {approver.reject ? "拒" : "批"} {resolveApproverName(approver.user_id, approverUsers)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={mutedStyle}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function disabledBtn(style: CSSProperties, disabled: boolean): CSSProperties {
  return disabled ? { ...style, opacity: 0.5, cursor: "not-allowed" } : style;
}

function safeMoney(value?: number | string) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function statusText(status: string) {
  if (status === "approved") return "已批准";
  if (status === "rejected") return "已拒绝";
  return "待处理";
}

function statusTone(status: string): "success" | "danger" | "warning" {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  return "warning";
}

function getClaimStatus(claim: ClaimRecord) {
  const approvers = claim.approver_data || [];
  if (approvers.some((approver) => approver.reject)) return "rejected";
  if (approvers.some((approver) => !approver.reject)) return "approved";
  return "pending";
}

function resolveApproverName(userId: number, users: Record<number, ApproverUserProfile>) {
  return users[userId]?.display_name || users[userId]?.name_NRIC || users[userId]?.username || `#${userId}`;
}

function renderJeCell(je?: GLSourceEntryRef) {
  if (!je) {
    return <span style={jeNoneStyle}>未入账</span>;
  }
  return (
    <span style={jeChipStyle} title={`凭证 ${je.entry_no} · ${je.status === "posted" ? "已过账" : je.status}`}>
      {je.entry_no}
    </span>
  );
}

const jeChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "3px 8px",
  borderRadius: "6px",
  fontFamily: "var(--x-font-mono)",
  fontSize: "11.5px",
  fontWeight: 700,
  whiteSpace: "nowrap",
  background: "var(--x-color-success-soft)",
  color: "var(--x-color-success)",
};

const jeNoneStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };

const TABLE_CSS = `
.claim-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 900px; }
.claim-table thead th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; padding: 9px 12px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--x-color-ink-muted); background: var(--x-color-canvas-alt);
  border-bottom: 1px solid var(--x-color-line); white-space: nowrap;
}
.claim-table tbody td { padding: 10px 12px; border-bottom: 1px solid var(--x-color-line-soft); vertical-align: middle; color: var(--x-color-ink); }
.claim-table tbody tr.claim-row { cursor: pointer; }
.claim-table tbody tr.claim-row:hover td { background: var(--x-color-accent-tint); }
`;

const panelStyle: CSSProperties = {
  borderRadius: "12px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 1px 2px var(--x-color-shadow-soft)",
  overflow: "hidden",
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "12px",
  flexWrap: "wrap",
  padding: "16px 18px",
  borderBottom: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
};

const filterBarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap",
  alignItems: "center",
  padding: "10px 14px",
  borderBottom: "1px solid var(--x-color-line-soft)",
};

const tabBarStyle: CSSProperties = { display: "flex", gap: "6px", flexWrap: "wrap" };
const tabStyle: CSSProperties = {
  padding: "7px 13px",
  borderRadius: "8px",
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--x-color-ink-muted)",
  fontWeight: 600,
  fontSize: "13px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const tabActiveStyle: CSSProperties = {
  ...tabStyle,
  border: "1px solid var(--x-color-accent-border)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-accent-strong)",
  boxShadow: "0 1px 2px var(--x-color-shadow-soft)",
};

const eyebrowStyle: CSSProperties = { fontSize: "11px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--x-color-ink-muted)", fontWeight: 700 };
const titleStyle: CSSProperties = { margin: "2px 0", fontSize: "18px", fontWeight: 800 };
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
const rowStyle: CSSProperties = { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" };
const bulkBarStyle: CSSProperties = { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" };

const btnStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 600,
  fontSize: "13px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const primaryButtonStyle: CSSProperties = {
  padding: "8px 16px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-accent-strong)",
  background: "var(--x-color-accent)",
  color: "white",
  fontWeight: 700,
  fontSize: "13px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const searchInputStyle: CSSProperties = {
  flex: "1 1 240px",
  minHeight: "34px",
  padding: "7px 10px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontSize: "13px",
  boxSizing: "border-box",
};

const filterRightStyle: CSSProperties = { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", flex: "1 1 auto", justifyContent: "flex-end" };
const dateRangeStyle: CSSProperties = { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" };
const dateInputStyle: CSSProperties = {
  minHeight: "34px",
  padding: "6px 8px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontSize: "13px",
  boxSizing: "border-box",
};

const emptyStyle: CSSProperties = {
  margin: "16px",
  padding: "28px",
  borderRadius: "10px",
  border: "1px dashed var(--x-color-line)",
  textAlign: "center",
  color: "var(--x-color-ink-muted)",
};

const tableWrapStyle: CSSProperties = { width: "100%", overflowX: "auto" };
const cellStrongStyle: CSSProperties = { fontWeight: 700, lineHeight: 1.4 };
const monoCellStyle: CSSProperties = { fontFamily: "var(--x-font-mono)", fontSize: "12.5px", whiteSpace: "nowrap" };
const purposeCellStyle: CSSProperties = { maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const approverWrapStyle: CSSProperties = { display: "flex", gap: "4px", flexWrap: "wrap" };

function approverChipStyle(reject: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: "6px",
    fontSize: "11px",
    fontWeight: 700,
    whiteSpace: "nowrap",
    background: reject ? "var(--x-color-danger-soft)" : "var(--x-color-success-soft)",
    color: reject ? "var(--x-color-danger)" : "var(--x-color-success)",
  };
}

function chipStyle(tone: "success" | "danger" | "warning"): CSSProperties {
  const palette =
    tone === "success"
      ? { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" }
      : tone === "danger"
        ? { background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" }
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
