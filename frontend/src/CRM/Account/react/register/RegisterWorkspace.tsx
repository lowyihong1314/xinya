import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { CachedImage } from "../../../../components/CachedMedia";
import { showConfirmDialog } from "../../../../js/dialogs";
import { downloadBlobOrShare } from "../../../../js/browserActions";
import { useUserState } from "../../../../app/UserState";
import { getUserPermissionNames } from "../../../../app/permissions";
import { useEnsureDesignTokens } from "../../../../theme/designTokens";
import {
  deleteManualFinancePayment,
  deleteRegisterPayment,
  downloadPaymentReport,
  fetchFinancePayments,
  replaceRegisterPaymentProof,
  updateFinancePaymentStatus,
} from "./api";
import { ManualPaymentCreateModal } from "./ManualPaymentCreateModal";
import { SCOPE_FILTERS, STATUS_FILTERS, type FinancePayment } from "./types";
import { TablePagination, usePagedRows } from "../../../shared/TablePagination";
import { DocDetailHeader } from "../shared/DocDetailHeader";
import { WriteJEModal } from "../shared/WriteJEModal";
import { BatchWriteJEModal } from "../shared/BatchWriteJEModal";
import { fetchGLSourceMap, type GLSourceEntryRef } from "../gl/api";
import { sortArrow, sortRows, sortableThStyle, toggleSort, type SortState } from "../shared/tableSort";

type Notice = { tone: "success" | "error"; text: string };

function formatAmount(value: number | string | undefined | null) {
  return `RM ${Number(value || 0).toFixed(2)}`;
}

function paymentStatusLabel(status: string | null | undefined) {
  if (status === "checked") return "已确认";
  if (status === "fail") return "失败";
  return "处理中";
}

function statusTone(status: string | null | undefined): "success" | "danger" | "warning" {
  if (status === "checked") return "success";
  if (status === "fail") return "danger";
  return "warning";
}

function submittedAt(payment: FinancePayment) {
  if (payment.created_at) return payment.created_at.replace("T", " ").slice(0, 19);
  return `${payment.date || "-"} ${payment.time || ""}`.trim();
}

function registrationPath(payment: FinancePayment): string | null {
  if (!payment.registration_id) return null;
  if (payment.source_scope === "membership") {
    return `/crm/permanent_registration?registration_section=membership&entry_id=${payment.registration_id}`;
  }
  if (payment.source_scope === "youth_class") {
    return `/crm/permanent_registration?registration_section=youth_class&entry_id=${payment.registration_id}`;
  }
  if (payment.source_scope === "fahui_ylp") {
    return `/crm/dharma_event?fahui_view=ylp_order&fahui_workspace=ylp&fahui_order_id=${payment.registration_id}`;
  }
  if (payment.source_scope === "sales") {
    return `/crm/finance?account_router=sales_income`;
  }
  return null;
}

export function RegisterWorkspace() {
  useEnsureDesignTokens();
  const { user, isMobile } = useUserState();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [payments, setPayments] = useState<FinancePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [proofVersion, setProofVersion] = useState(0);
  const [jeOpen, setJeOpen] = useState(false);
  const [batchJeOpen, setBatchJeOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [jeMap, setJeMap] = useState<Record<string, GLSourceEntryRef>>({});
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportingReport, setExportingReport] = useState(false);
  const [query, setQuery] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const proofInputRef = useRef<HTMLInputElement | null>(null);

  const canEdit = useMemo(() => getUserPermissionNames(user).has("account_edit"), [user]);

  const status = searchParams.get("pay_status") || "process";
  const scope = searchParams.get("pay_scope") || "all";
  const selectedId = useMemo(() => {
    const raw = searchParams.get("payment_id");
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const list = await fetchFinancePayments({ scope, status });
      setPayments(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, status]);

  const selected = useMemo(
    () => (selectedId == null ? null : payments.find((p) => p.id === selectedId) || null),
    [payments, selectedId],
  );

  const detailNav = useMemo(() => {
    if (selectedId == null) {
      return { prevId: null as number | null, nextId: null as number | null, position: "" };
    }
    const index = payments.findIndex((p) => p.id === selectedId);
    if (index === -1) {
      return { prevId: null as number | null, nextId: null as number | null, position: "" };
    }
    return {
      prevId: index > 0 ? payments[index - 1].id : null,
      nextId: index < payments.length - 1 ? payments[index + 1].id : null,
      position: `${index + 1} / ${payments.length}`,
    };
  }, [payments, selectedId]);

  const stats = useMemo(() => {
    const checked = payments.filter((p) => p.status === "checked");
    const total = checked.reduce((sum, p) => sum + Number(p.amount ?? p.price ?? 0), 0);
    return { count: payments.length, checkedCount: checked.length, checkedTotal: total };
  }, [payments]);

  const filteredPayments = useMemo(() => {
    const kw = query.trim().toLowerCase();
    const base = payments.filter((p) => {
      if (kw) {
        const hay = [
          p.id,
          p.name,
          p.nric,
          p.phone,
          p.source_scope_label,
          p.source_label,
          p.payment_mode,
          p.counter,
          p.amount ?? p.price,
          paymentStatusLabel(p.status),
        ].map((v) => String(v ?? "").toLowerCase());
        if (!hay.some((v) => v.includes(kw))) return false;
      }
      const day = paymentDateKey(p);
      if (dateStart && (!day || day < dateStart)) return false;
      if (dateEnd && (!day || day > dateEnd)) return false;
      return true;
    });
    return sortRows(base, sort, (p, key) => getPaymentSortValue(p, key, jeMap));
  }, [payments, query, dateStart, dateEnd, sort, jeMap]);

  const paged = usePagedRows(
    filteredPayments,
    undefined,
    `${status}|${scope}|${query}|${dateStart}|${dateEnd}|${sort?.key ?? ""}|${sort?.dir ?? ""}`,
  );

  useEffect(() => {
    if (!payments.length) {
      setJeMap({});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const map = await fetchGLSourceMap("register_payment", payments.map((p) => p.id));
        if (!cancelled) setJeMap(map);
      } catch {
        if (!cancelled) setJeMap({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payments]);

  const pageRowIds = paged.pageRows.map((p) => p.id);
  const allVisibleSelected = pageRowIds.length > 0 && pageRowIds.every((id) => selectedIds.has(id));
  const selectedPayments = payments.filter((p) => selectedIds.has(p.id));

  function toggleSelected(id: number, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectPage(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      pageRowIds.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function handleDownloadXlsx() {
    if (!selectedPayments.length) return;
    setExportingXlsx(true);
    try {
      await exportPaymentsToExcel(selectedPayments, isMobile);
      setNotice({
        tone: "success",
        text: isMobile ? `已分享 ${selectedPayments.length} 笔收款 XLSX` : `已下载 ${selectedPayments.length} 笔收款 XLSX`,
      });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "下载 XLSX 失败" });
    } finally {
      setExportingXlsx(false);
    }
  }

  async function handleDownloadReport() {
    if (!selectedPayments.length) return;
    setExportingReport(true);
    try {
      const blob = await downloadPaymentReport(selectedPayments.map((p) => p.id));
      const filename = `收款审核Report_${selectedPayments.length}笔.pdf`;
      await downloadBlobOrShare(blob, filename, { isMobile, title: filename, text: `${selectedPayments.length} 笔收款 Report` });
      setNotice({ tone: "success", text: "Report 已生成" });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "导出 Report 失败" });
    } finally {
      setExportingReport(false);
    }
  }

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value == null) next.delete(key);
    else next.set(key, value);
    setSearchParams(next);
  }

  function openPayment(id: number) {
    setParam("payment_id", String(id));
  }
  function closePayment() {
    setParam("payment_id", null);
  }

  async function handleStatus(paymentId: number, nextStatus: string) {
    setBusyId(paymentId);
    setNotice(null);
    try {
      const result = await updateFinancePaymentStatus(paymentId, nextStatus);
      setNotice({ tone: "success", text: result.message || "付款状态已更新" });
      await loadData();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "更新失败" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleReplaceProof(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!selected || !file) return;
    setReplacing(true);
    setNotice(null);
    try {
      await replaceRegisterPaymentProof(selected.id, file);
      setProofVersion(Date.now());
      setNotice({ tone: "success", text: "付款截图已更新" });
      await loadData();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "更新失败" });
    } finally {
      setReplacing(false);
      event.target.value = "";
    }
  }

  async function handleRemove() {
    if (!selected) return;
    const ok = await showConfirmDialog({
      message: `确认移除付款记录 #${selected.id}？这个动作无法撤回。`,
      tone: "danger",
    });
    if (!ok) return;
    setRemoving(true);
    setNotice(null);
    try {
      if (selected.source_scope === "manual") await deleteManualFinancePayment(selected.id);
      else await deleteRegisterPayment(selected.id);
      closePayment();
      setNotice({ tone: "success", text: "付款记录已移除" });
      await loadData();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "移除失败" });
    } finally {
      setRemoving(false);
    }
  }

  // ------- Detail view -------
  if (selectedId != null) {
    const isForm = selected?.source_scope === "form";
    const isManual = selected?.source_scope === "manual";
    const proofUrl = selected?.proof_image_url || selected?.proof_image_path || "";
    const proofSrc = proofUrl ? `${proofUrl}${proofUrl.includes("?") ? "&" : "?"}t=${proofVersion}` : "";
    const regPath = selected ? registrationPath(selected) : null;
    const busy = busyId === selectedId || replacing || removing;
    return (
      <div style={pageStyle}>
        <style>{TABLE_CSS}</style>
        <section style={panelStyle}>
          <DocDetailHeader
            eyebrow={`财务 / 收款审核 · #${selectedId}`}
            title={selected?.name || selected?.nric || `付款 #${selectedId}`}
            subtitle={selected ? `${selected.source_scope_label} · ${selected.source_label || "-"} · ${formatAmount(selected.amount ?? selected.price)}` : undefined}
            onBack={closePayment}
            onPrev={detailNav.prevId != null ? () => openPayment(detailNav.prevId as number) : undefined}
            onNext={detailNav.nextId != null ? () => openPayment(detailNav.nextId as number) : undefined}
            positionLabel={detailNav.position}
            statusSlot={selected ? <span style={chipStyle(statusTone(selected.status))}>{paymentStatusLabel(selected.status)}</span> : null}
            actions={
              selected ? (
                <>
                  <button type="button" style={btnStyle} onClick={() => setJeOpen(true)}>
                    写 JE
                  </button>
                  {regPath ? (
                    <button type="button" style={btnStyle} onClick={() => navigate(regPath)}>
                      查看关联申请
                    </button>
                  ) : null}
                </>
              ) : null
            }
          />

          {notice ? <div style={notice.tone === "success" ? successStyle : errorStyle}>{notice.text}</div> : null}
          {error ? <div style={errorStyle}>{error}</div> : null}

          {!selected ? (
            <div style={emptyStyle}>{loading ? "加载中…" : "找不到这笔付款，可能已被移除或数据已刷新。"}</div>
          ) : (
            <div style={bodyStyle}>
              <div style={detailTwoColStyle(isMobile)}>
                <div style={detailInfoColStyle}>
                  <div style={factGridStyle}>
                    <Fact label="来源" value={selected.source_scope_label || "-"} />
                    <Fact label="关联" value={selected.source_label || "-"} />
                    <Fact label="付款人" value={selected.name || "-"} />
                    <Fact label="NRIC" value={selected.nric || "-"} />
                    <Fact label="电话" value={selected.phone || "-"} />
                    <Fact label="金额" value={formatAmount(selected.amount ?? selected.price)} />
                    <Fact label="付款方式" value={selected.payment_mode || "-"} />
                    <Fact label="柜台" value={selected.counter || "-"} />
                    <Fact label="日期" value={selected.date || "-"} />
                    <Fact label="时间" value={selected.time || "-"} />
                    <Fact label="提交时间" value={submittedAt(selected)} />
                    {isManual ? (
                      <Fact
                        label="关联活动"
                        value={selected.event_id ? `${selected.event_name || "未命名活动"} #${selected.event_id}` : "未关联活动"}
                      />
                    ) : null}
                    {isManual && selected.remark ? <Fact label="备注" value={selected.remark} /> : null}
                  </div>

                  {canEdit ? (
                    <div style={sectionStyle}>
                      <div style={sectionTitleStyle}>切换状态</div>
                      <div style={rowStyle}>
                        {(["process", "checked", "fail"] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            className={`fin-btn${s === "checked" ? " fin-btn--go" : s === "fail" ? " fin-btn--danger" : ""}`}
                            style={{ width: "auto", padding: "8px 16px" }}
                            disabled={busy}
                            onClick={() => void handleStatus(selected.id, s)}
                          >
                            {busyId === selected.id ? "更新中…" : paymentStatusLabel(s)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {canEdit && isForm ? (
                    <div style={rowStyle}>
                      {selected.status === "process" ? (
                        <>
                          <input
                            ref={proofInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/heic,image/heif"
                            style={{ display: "none" }}
                            onChange={(event) => void handleReplaceProof(event)}
                          />
                          <button
                            type="button"
                            className="fin-btn"
                            style={{ width: "auto", padding: "8px 16px" }}
                            disabled={busy}
                            onClick={() => proofInputRef.current?.click()}
                          >
                            {replacing ? "替换中…" : proofUrl ? "替换付款截图" : "上传付款截图"}
                          </button>
                        </>
                      ) : null}
                      {selected.status === "fail" ? (
                        <button
                          type="button"
                          className="fin-btn fin-btn--danger"
                          style={{ width: "auto", padding: "8px 16px" }}
                          disabled={busy}
                          onClick={() => void handleRemove()}
                        >
                          {removing ? "移除中…" : "移除记录"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {canEdit && isManual ? (
                    <div style={rowStyle}>
                      <button
                        type="button"
                        className="fin-btn fin-btn--danger"
                        style={{ width: "auto", padding: "8px 16px" }}
                        disabled={busy}
                        onClick={() => void handleRemove()}
                      >
                        {removing ? "移除中…" : "移除记录"}
                      </button>
                    </div>
                  ) : null}
                  {!isForm && !isManual ? (
                    <div style={mutedStyle}>会员 / 青少年佛学班 / 法会 / 销售 的付款截图请在对应模块管理，这里做收款状态审核（确认 = 批准）。</div>
                  ) : null}
                </div>

                <div style={detailProofColStyle}>
                  <div style={sectionTitleStyle}>付款截图</div>
                  {proofSrc ? (
                    <>
                      <a href={proofSrc} target="_blank" rel="noreferrer" style={linkStyle}>查看原图</a>
                      <div style={proofFrameStyle}>
                        <CachedImage
                          src={proofSrc}
                          cacheKey={`finance-payment-proof:${selected.id}`}
                          refreshKey={proofVersion || proofUrl}
                          alt={`payment-proof-${selected.id}`}
                          style={proofImageFillStyle}
                        />
                      </div>
                    </>
                  ) : (
                    <div style={emptyInlineStyle}>这笔付款没有上传截图。</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        <WriteJEModal
          open={jeOpen}
          onClose={() => setJeOpen(false)}
          source="register_payment"
          sourceRefType="register_payment"
          sourceId={selectedId}
          direction="income"
          defaultAmount={Number(selected?.amount ?? selected?.price ?? 0)}
          defaultDate={selected?.date || selected?.created_at || null}
          defaultMemo={`收款 #${selectedId}${selected?.name ? ` · ${selected.name}` : ""}`}
          canEdit={canEdit}
        />
      </div>
    );
  }

  // ------- List view -------
  return (
    <div style={pageStyle}>
      <style>{TABLE_CSS}</style>
      <section style={panelStyle}>
        <div style={toolbarStyle}>
          <div>
            <div style={eyebrowStyle}>财务 / 收款审核</div>
            <h2 style={titleStyle}>收款审核</h2>
            <div style={mutedStyle}>
              共 {stats.count} 笔 · 已确认 {stats.checkedCount} 笔 · 已确认金额 {formatAmount(stats.checkedTotal)}
            </div>
          </div>
          <div style={rowStyle}>
            {canEdit ? (
              <button type="button" style={primaryBulkBtnStyle} onClick={() => setCreateOpen(true)}>
                新建收款
              </button>
            ) : null}
            <button type="button" style={btnStyle} onClick={() => void loadData()} disabled={loading}>
              {loading ? "刷新中…" : "刷新"}
            </button>
          </div>
        </div>

        <div style={filterBarStyle}>
          <div style={tabBarStyle}>
            {STATUS_FILTERS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                style={tab.key === status ? tabActiveStyle : tabStyle}
                onClick={() => setParam("pay_status", tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div style={tabBarStyle}>
            {SCOPE_FILTERS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                style={tab.key === scope ? tabActiveStyle : tabStyle}
                onClick={() => setParam("pay_scope", tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div style={searchBarStyle}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索付款人 / NRIC / 电话 / 来源 / 金额"
            style={searchInputStyle}
          />
          <div style={dateRangeStyle}>
            <span style={mutedStyle}>日期</span>
            <input type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} style={dateInputStyle} />
            <span style={mutedStyle}>–</span>
            <input type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} style={dateInputStyle} />
            {dateStart || dateEnd ? (
              <button type="button" style={btnStyle} onClick={() => { setDateStart(""); setDateEnd(""); }}>
                清除
              </button>
            ) : null}
          </div>
        </div>

        {notice ? <div style={notice.tone === "success" ? successStyle : errorStyle}>{notice.text}</div> : null}
        {error ? <div style={errorStyle}>{error}</div> : null}

        {loading ? <div style={emptyStyle}>加载中…</div> : null}
        {!loading && !filteredPayments.length ? (
          <div style={emptyStyle}>{payments.length ? "没有匹配的收款记录。" : "没有符合条件的收款记录。"}</div>
        ) : null}
        {!loading && filteredPayments.length ? (
          <div style={{ display: "grid", gap: "8px", padding: "12px 14px 4px" }}>
          <div style={bulkBarStyle}>
            <span style={mutedStyle}>已选 {selectedIds.size} 笔</span>
            <button type="button" style={disabledBtn(btnStyle, selectedIds.size <= 0)} onClick={clearSelection} disabled={selectedIds.size <= 0}>
              清空选择
            </button>
            {canEdit ? (
              <button
                type="button"
                style={disabledBtn(primaryBulkBtnStyle, selectedIds.size <= 0)}
                onClick={() => setBatchJeOpen(true)}
                disabled={selectedIds.size <= 0}
              >
                批量写 JE
              </button>
            ) : null}
            <button
              type="button"
              style={disabledBtn(btnStyle, selectedIds.size <= 0 || exportingXlsx)}
              onClick={() => void handleDownloadXlsx()}
              disabled={selectedIds.size <= 0 || exportingXlsx}
            >
              {exportingXlsx ? "生成中…" : "下载 XLSX"}
            </button>
            <button
              type="button"
              style={disabledBtn(btnStyle, selectedIds.size <= 0 || exportingReport)}
              onClick={() => void handleDownloadReport()}
              disabled={selectedIds.size <= 0 || exportingReport}
            >
              {exportingReport ? "生成 Report…" : "导出 Report"}
            </button>
          </div>
          <TablePagination page={paged.page} totalPages={paged.totalPages} total={paged.total} onPage={paged.setPage} />
          <div style={tableWrapStyle}>
            <table className="fin-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      aria-label="当页全选"
                      checked={allVisibleSelected}
                      onChange={(event) => toggleSelectPage(event.target.checked)}
                      style={{ width: 16, height: 16, accentColor: "var(--x-color-accent)" }}
                    />
                  </th>
                  <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "status"))}>状态{sortArrow(sort, "status")}</th>
                  <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "je"))}>JE{sortArrow(sort, "je")}</th>
                  <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "source"))}>来源{sortArrow(sort, "source")}</th>
                  <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "name"))}>付款人{sortArrow(sort, "name")}</th>
                  <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "nric"))}>NRIC{sortArrow(sort, "nric")}</th>
                  <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "amount"))}>金额{sortArrow(sort, "amount")}</th>
                  <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "mode"))}>付款方式{sortArrow(sort, "mode")}</th>
                  <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "link"))}>关联{sortArrow(sort, "link")}</th>
                  <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "submitted"))}>提交时间{sortArrow(sort, "submitted")}</th>
                </tr>
              </thead>
              <tbody>
                {paged.pageRows.map((payment) => (
                  <tr key={`${payment.payment_scope}-${payment.id}`} className="fin-row" onClick={() => openPayment(payment.id)}>
                    <td onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(payment.id)}
                        onChange={(event) => toggleSelected(payment.id, event.target.checked)}
                        style={{ width: 16, height: 16, accentColor: "var(--x-color-accent)" }}
                      />
                    </td>
                    <td>
                      <span style={chipStyle(statusTone(payment.status))}>{paymentStatusLabel(payment.status)}</span>
                    </td>
                    <td>{renderJeCell(jeMap[String(payment.id)])}</td>
                    <td>
                      <span style={scopeChipStyle}>{payment.source_scope_label || payment.payment_scope}</span>
                    </td>
                    <td>
                      <div style={cellStrongStyle}>{payment.name || "-"}</div>
                      <div style={cellSubStyle}>{payment.phone || ""}</div>
                    </td>
                    <td style={monoCellStyle}>{payment.nric || "-"}</td>
                    <td style={cellStrongStyle}>{formatAmount(payment.amount ?? payment.price)}</td>
                    <td>{payment.payment_mode || "-"}</td>
                    <td>{payment.source_label || "-"}</td>
                    <td style={monoCellStyle}>{submittedAt(payment)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        ) : null}
      </section>

      <ManualPaymentCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(message) => {
          setCreateOpen(false);
          setNotice({ tone: "success", text: message || "收款已新建" });
          void loadData();
        }}
      />

      <BatchWriteJEModal
        open={batchJeOpen}
        onClose={() => setBatchJeOpen(false)}
        source="register_payment"
        sourceRefType="register_payment"
        direction="income"
        canEdit={canEdit}
        docs={selectedPayments.map((p) => ({
          id: p.id,
          amount: Number(p.amount ?? p.price ?? 0),
          date: p.date || p.created_at || null,
          memo: `收款 #${p.id}${p.name ? ` · ${p.name}` : ""}`,
        }))}
        onDone={() => void loadData()}
      />
    </div>
  );
}

function disabledBtn(style: CSSProperties, disabled: boolean): CSSProperties {
  return disabled ? { ...style, opacity: 0.5, cursor: "not-allowed" } : style;
}

function paymentDateKey(payment: FinancePayment): string {
  if (payment.date && /^\d{4}-\d{2}-\d{2}/.test(payment.date)) return payment.date.slice(0, 10);
  if (payment.created_at) return String(payment.created_at).slice(0, 10);
  return "";
}

function getPaymentSortValue(
  payment: FinancePayment,
  key: string,
  jeMap: Record<string, GLSourceEntryRef>,
): number | string | null {
  switch (key) {
    case "status":
      return paymentStatusLabel(payment.status);
    case "je":
      return jeMap[String(payment.id)]?.entry_no ?? null;
    case "source":
      return payment.source_scope_label || payment.payment_scope || "";
    case "name":
      return payment.name || "";
    case "nric":
      return payment.nric || "";
    case "amount":
      return Number(payment.amount ?? payment.price ?? 0);
    case "mode":
      return payment.payment_mode || "";
    case "link":
      return payment.source_label || "";
    case "submitted":
      return paymentDateKey(payment) || submittedAt(payment);
    default:
      return null;
  }
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

async function exportPaymentsToExcel(payments: FinancePayment[], isMobile: boolean) {
  const XLSX = await import("xlsx");
  const rows = payments.map((payment) => ({
    ID: payment.id,
    状态: paymentStatusLabel(payment.status),
    来源: payment.source_scope_label || payment.payment_scope || "",
    关联: payment.source_label || "",
    付款人: payment.name || "",
    NRIC: payment.nric || "",
    电话: payment.phone || "",
    金额: Number(payment.amount ?? payment.price ?? 0).toFixed(2),
    付款方式: payment.payment_mode || "",
    柜台: payment.counter || "",
    日期: payment.date || "",
    时间: payment.time || "",
    提交时间: submittedAt(payment),
  }));
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Payments");
  const filename = `收款审核_${payments.length}笔.xlsx`;
  const workbookArray = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  await downloadBlobOrShare(
    new Blob([workbookArray], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename,
    { isMobile, title: filename, text: `${payments.length} 笔收款 XLSX` },
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={factStyle}>
      <div style={factLabelStyle}>{label}</div>
      <div style={factValueStyle}>{value}</div>
    </div>
  );
}

const bulkBarStyle: CSSProperties = { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" };
const primaryBulkBtnStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-accent-strong)",
  background: "var(--x-color-accent)",
  color: "white",
  fontWeight: 700,
  fontSize: "13px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
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
.fin-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 900px; }
.fin-table thead th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; padding: 9px 12px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--x-color-ink-muted);
  background: var(--x-color-canvas-alt);
  border-bottom: 1px solid var(--x-color-line);
  white-space: nowrap;
}
.fin-table tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--x-color-line-soft);
  vertical-align: middle;
  color: var(--x-color-ink);
}
.fin-table tbody tr.fin-row { cursor: pointer; }
.fin-table tbody tr.fin-row:hover td { background: var(--x-color-accent-tint); }
.fin-btn {
  width: 100%; padding: 6px 8px; border-radius: 6px;
  border: 1px solid var(--x-color-line); background: var(--x-color-panel);
  color: var(--x-color-ink); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.fin-btn:hover:not(:disabled) { border-color: var(--x-color-accent-border); background: var(--x-color-accent-soft); }
.fin-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.fin-btn--go { border-color: rgba(21,128,61,0.28); background: var(--x-color-success-soft); color: var(--x-color-success); }
.fin-btn--danger { border-color: var(--x-color-danger-border); background: var(--x-color-danger-soft); color: var(--x-color-danger); }
`;

const pageStyle: CSSProperties = { display: "grid", gap: "16px" };

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
  padding: "10px 14px",
  borderBottom: "1px solid var(--x-color-line-soft)",
};

const tabBarStyle: CSSProperties = { display: "flex", gap: "6px", flexWrap: "wrap" };

const searchBarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap",
  alignItems: "center",
  padding: "10px 14px",
  borderBottom: "1px solid var(--x-color-line-soft)",
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

const eyebrowStyle: CSSProperties = {
  fontSize: "11px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
};
const titleStyle: CSSProperties = { margin: "2px 0", fontSize: "18px", fontWeight: 800 };
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };

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

const errorStyle: CSSProperties = {
  margin: "12px 14px 0",
  padding: "10px 14px",
  borderRadius: "8px",
  background: "var(--x-color-danger-soft)",
  border: "1px solid var(--x-color-danger-border)",
  color: "var(--x-color-danger)",
  fontSize: "13px",
};
const successStyle: CSSProperties = {
  margin: "12px 14px 0",
  padding: "10px 14px",
  borderRadius: "8px",
  background: "var(--x-color-success-soft)",
  border: "1px solid rgba(21,128,61,0.28)",
  color: "var(--x-color-success)",
  fontSize: "13px",
};

const emptyStyle: CSSProperties = {
  margin: "16px",
  padding: "28px",
  borderRadius: "10px",
  border: "1px dashed var(--x-color-line)",
  textAlign: "center",
  color: "var(--x-color-ink-muted)",
};
const emptyInlineStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "8px",
  border: "1px dashed var(--x-color-line)",
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
};

const tableWrapStyle: CSSProperties = { width: "100%", overflowX: "auto" };
const cellStrongStyle: CSSProperties = { fontWeight: 700, lineHeight: 1.4 };
const cellSubStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", marginTop: "2px" };
const monoCellStyle: CSSProperties = { fontFamily: "var(--x-font-mono)", fontSize: "12.5px", whiteSpace: "nowrap" };

const bodyStyle: CSSProperties = { padding: "16px 18px", display: "grid", gap: "14px" };
const sectionStyle: CSSProperties = { display: "grid", gap: "8px" };
const sectionTitleStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};
const rowStyle: CSSProperties = { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" };

const factGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: "8px",
};
const factStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: "8px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
  display: "grid",
  gap: "3px",
};
const factLabelStyle: CSSProperties = {
  fontSize: "10.5px",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};
const factValueStyle: CSSProperties = { fontSize: "13px", lineHeight: 1.5, wordBreak: "break-word", fontWeight: 600 };

const linkStyle: CSSProperties = {
  color: "var(--x-color-accent-strong)",
  textDecoration: "none",
  fontWeight: 700,
  fontSize: "12px",
  width: "fit-content",
};

function detailTwoColStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1.1fr)",
    gap: "16px",
    alignItems: "start",
  };
}
const detailInfoColStyle: CSSProperties = { display: "grid", gap: "14px", minWidth: 0 };
const detailProofColStyle: CSSProperties = { display: "grid", gap: "8px", minWidth: 0 };
const proofFrameStyle: CSSProperties = {
  width: "100%",
  height: "min(72vh, 600px)",
  borderRadius: "10px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const proofImageFillStyle: CSSProperties = {
  maxWidth: "100%",
  maxHeight: "100%",
  objectFit: "contain",
};

const scopeChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  borderRadius: "6px",
  fontSize: "12px",
  fontWeight: 700,
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
  color: "var(--x-color-ink)",
  whiteSpace: "nowrap",
};

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
