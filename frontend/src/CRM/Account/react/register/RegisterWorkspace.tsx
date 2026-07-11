import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { CachedImage } from "../../../../components/CachedMedia";
import { showConfirmDialog } from "../../../../js/dialogs";
import { useUserState } from "../../../../app/UserState";
import { getUserPermissionNames } from "../../../../app/permissions";
import { useEnsureDesignTokens } from "../../../../theme/designTokens";
import {
  deleteRegisterPayment,
  fetchFinancePayments,
  replaceRegisterPaymentProof,
  updateFinancePaymentStatus,
} from "./api";
import { SCOPE_FILTERS, STATUS_FILTERS, type FinancePayment } from "./types";
import { TablePagination, usePagedRows } from "../../../shared/TablePagination";

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
  return null;
}

export function RegisterWorkspace() {
  useEnsureDesignTokens();
  const { user } = useUserState();
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

  const stats = useMemo(() => {
    const checked = payments.filter((p) => p.status === "checked");
    const total = checked.reduce((sum, p) => sum + Number(p.amount ?? p.price ?? 0), 0);
    return { count: payments.length, checkedCount: checked.length, checkedTotal: total };
  }, [payments]);

  const paged = usePagedRows(payments, undefined, `${status}|${scope}`);

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
      await deleteRegisterPayment(selected.id);
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
    const proofUrl = selected?.proof_image_url || selected?.proof_image_path || "";
    const proofSrc = proofUrl ? `${proofUrl}${proofUrl.includes("?") ? "&" : "?"}t=${proofVersion}` : "";
    const regPath = selected ? registrationPath(selected) : null;
    const busy = busyId === selectedId || replacing || removing;
    return (
      <div style={pageStyle}>
        <style>{TABLE_CSS}</style>
        <section style={panelStyle}>
          <div style={headerStyle}>
            <div style={headerLeftStyle}>
              <button type="button" style={btnStyle} onClick={closePayment}>
                ← 返回列表
              </button>
              <div>
                <div style={eyebrowStyle}>收款记录 #{selectedId}</div>
                <h2 style={titleStyle}>{selected?.name || selected?.nric || `付款 #${selectedId}`}</h2>
                {selected ? (
                  <div style={mutedStyle}>
                    {selected.source_scope_label} · {selected.source_label || "-"}
                  </div>
                ) : null}
              </div>
            </div>
            {selected ? (
              <div style={headerRightStyle}>
                <span style={chipStyle(statusTone(selected.status))}>{paymentStatusLabel(selected.status)}</span>
                {regPath ? (
                  <button type="button" style={btnStyle} onClick={() => navigate(regPath)}>
                    查看关联申请
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {notice ? <div style={notice.tone === "success" ? successStyle : errorStyle}>{notice.text}</div> : null}
          {error ? <div style={errorStyle}>{error}</div> : null}

          {!selected ? (
            <div style={emptyStyle}>{loading ? "加载中…" : "找不到这笔付款，可能已被移除或数据已刷新。"}</div>
          ) : (
            <div style={bodyStyle}>
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

              <div style={sectionStyle}>
                <div style={sectionTitleStyle}>付款截图</div>
                {proofSrc ? (
                  <>
                    <a href={proofSrc} target="_blank" rel="noreferrer" style={linkStyle}>
                      查看原图
                    </a>
                    <CachedImage
                      src={proofSrc}
                      cacheKey={`finance-payment-proof:${selected.id}`}
                      refreshKey={proofVersion || proofUrl}
                      alt={`payment-proof-${selected.id}`}
                      style={proofImageStyle}
                    />
                  </>
                ) : (
                  <div style={emptyInlineStyle}>这笔付款没有上传截图。</div>
                )}
              </div>

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
              {!isForm ? (
                <div style={mutedStyle}>会员 / 青少年佛学班的付款截图与记录请在对应模块管理，这里只做收款状态审核。</div>
              ) : null}
            </div>
          )}
        </section>
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
          <button type="button" style={btnStyle} onClick={() => void loadData()} disabled={loading}>
            {loading ? "刷新中…" : "刷新"}
          </button>
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

        {notice ? <div style={notice.tone === "success" ? successStyle : errorStyle}>{notice.text}</div> : null}
        {error ? <div style={errorStyle}>{error}</div> : null}

        {loading ? <div style={emptyStyle}>加载中…</div> : null}
        {!loading && !payments.length ? <div style={emptyStyle}>没有符合条件的收款记录。</div> : null}
        {!loading && payments.length ? (
          <div style={{ display: "grid", gap: "8px", padding: "12px 14px 4px" }}>
          <TablePagination page={paged.page} totalPages={paged.totalPages} total={paged.total} onPage={paged.setPage} />
          <div style={tableWrapStyle}>
            <table className="fin-table">
              <thead>
                <tr>
                  <th>状态</th>
                  <th>来源</th>
                  <th>付款人</th>
                  <th>NRIC</th>
                  <th>金额</th>
                  <th>付款方式</th>
                  <th>关联</th>
                  <th>提交时间</th>
                </tr>
              </thead>
              <tbody>
                {paged.pageRows.map((payment) => (
                  <tr key={`${payment.payment_scope}-${payment.id}`} className="fin-row" onClick={() => openPayment(payment.id)}>
                    <td>
                      <span style={chipStyle(statusTone(payment.status))}>{paymentStatusLabel(payment.status)}</span>
                    </td>
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
    </div>
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

const TABLE_CSS = `
.fin-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 820px; }
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

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "12px",
  flexWrap: "wrap",
  padding: "16px 18px",
  borderBottom: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
};
const headerLeftStyle: CSSProperties = { display: "flex", gap: "12px", alignItems: "flex-start" };
const headerRightStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" };

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

const proofImageStyle: CSSProperties = {
  width: "100%",
  maxHeight: "440px",
  objectFit: "contain",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
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
