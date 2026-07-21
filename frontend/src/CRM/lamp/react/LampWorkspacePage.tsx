import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";

import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { useUserState } from "../../../app/UserState";
import { getUserPermissionNames } from "../../../app/permissions";
import { showConfirmDialog } from "../../../js/dialogs";
import { LAMP_META } from "../../../lamp/lampMeta";
import { usePagedRows } from "../../shared/TablePagination";
import { sortArrow, sortRows, sortableThStyle, toggleSort, type SortState } from "../../Account/react/shared/tableSort";
import { deleteLampRegistration, fetchLampRegistrations, updateLampRegistration } from "./api";
import type { LampItem, LampRegistrationRecord } from "./types";

type Notice = { tone: "success" | "error"; text: string };

const STATUS_TABS: { key: string; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "draft", label: "草稿" },
  { key: "confirm", label: "已确认" },
  { key: "cancel", label: "已取消" },
];

function formatAmount(value: number | string | undefined | null) {
  return `RM ${Number(value || 0).toFixed(2)}`;
}

function normalizeStatus(status?: string | null) {
  return status === "confirm" || status === "cancel" ? status : "draft";
}

function statusLabel(status?: string | null) {
  const s = normalizeStatus(status);
  if (s === "confirm") return "已确认";
  if (s === "cancel") return "已取消";
  return "草稿";
}

function statusTone(status?: string | null): "success" | "danger" | "warning" {
  const s = normalizeStatus(status);
  if (s === "confirm") return "success";
  if (s === "cancel") return "danger";
  return "warning";
}

function lampTypeLabel(type: string) {
  return (LAMP_META as Record<string, { label?: string }>)[type]?.label || type;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  return String(value).replace("T", " ").slice(0, 19);
}

export function LampWorkspacePage() {
  useEnsureDesignTokens();
  const { user } = useUserState();
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<LampRegistrationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState<SortState>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ devotee_name: "", phone: "", address: "" });

  const canEdit = useMemo(() => getUserPermissionNames(user).has("account_edit"), [user]);

  const selectedId = useMemo(() => {
    const raw = searchParams.get("lamp_id");
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);

  const selected = useMemo(
    () => (selectedId == null ? null : rows.find((r) => r.id === selectedId) || null),
    [rows, selectedId],
  );

  const orderStatus = normalizeStatus(selected?.status);
  const editable = canEdit && orderStatus === "draft";

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const res = await fetchLampRegistrations();
      setRows(res.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    setForm({
      devotee_name: selected?.devotee_name || "",
      phone: selected?.phone || "",
      address: selected?.address || "",
    });
  }, [selected?.id]);

  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase();
    const base = rows.filter((r) => {
      if (statusFilter !== "all" && normalizeStatus(r.status) !== statusFilter) return false;
      if (!kw) return true;
      return [r.id, r.devotee_name, r.phone, r.address, statusLabel(r.status)]
        .map((v) => String(v ?? "").toLowerCase())
        .some((v) => v.includes(kw));
    });
    return sortRows(base, sort, (r, key) => {
      switch (key) {
        case "name":
          return r.devotee_name || "";
        case "phone":
          return r.phone || "";
        case "amount":
          return Number(r.total_amount || 0);
        case "status":
          return statusLabel(r.status);
        case "created_at":
          return r.created_at || "";
        default:
          return null;
      }
    });
  }, [rows, query, statusFilter, sort]);

  const paged = usePagedRows(filtered, undefined, `${query}|${statusFilter}|${sort?.key ?? ""}|${sort?.dir ?? ""}`);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value == null) next.delete(key);
    else next.set(key, value);
    setSearchParams(next);
  }

  async function handleSaveInfo(id: number) {
    setSaving(true);
    setNotice(null);
    try {
      await updateLampRegistration(id, {
        devotee_name: form.devotee_name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
      });
      setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...form } : r)));
      setNotice({ tone: "success", text: "资料已保存" });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSetStatus(id: number, status: string) {
    if (status === "cancel") {
      const ok = await showConfirmDialog({ message: `确认取消登记 #${id}？`, tone: "danger" });
      if (!ok) return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await updateLampRegistration(id, { status });
      setRows((cur) => cur.map((r) => (r.id === id ? { ...r, status } : r)));
      setNotice({ tone: "success", text: "状态已更新" });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "更新失败" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    const ok = await showConfirmDialog({ message: `确认删除登记 #${id}？`, tone: "danger" });
    if (!ok) return;
    setSaving(true);
    try {
      await deleteLampRegistration(id);
      setParam("lamp_id", null);
      setRows((cur) => cur.filter((r) => r.id !== id));
      setNotice({ tone: "success", text: "登记已删除" });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "删除失败" });
    } finally {
      setSaving(false);
    }
  }

  // -------- Detail --------
  if (selectedId != null) {
    return (
      <div style={pageStyle}>
        <style>{TABLE_CSS}</style>
        <section style={panelStyle}>
          <div style={toolbarStyle}>
            <div style={rowStyle}>
              <button type="button" style={btnStyle} onClick={() => setParam("lamp_id", null)}>← 返回列表</button>
              <div>
                <div style={eyebrowStyle}>点灯登记 · #{selectedId}</div>
                <h2 style={titleStyle}>{selected?.devotee_name || `登记 #${selectedId}`}</h2>
              </div>
            </div>
            <span style={chipStyle(statusTone(selected?.status))}>{statusLabel(selected?.status)}</span>
          </div>

          {notice ? <div style={notice.tone === "success" ? successStyle : errorStyle}>{notice.text}</div> : null}

          {!selected ? (
            <div style={emptyStyle}>{loading ? "加载中…" : "找不到这条登记，可能已被删除或数据已刷新。"}</div>
          ) : (
            <div style={bodyStyle}>
              {canEdit ? (
                <div style={sectionStyle}>
                  <div style={sectionHeadStyle}>
                    <div style={sectionTitleStyle}>状态控制</div>
                  </div>
                  <div style={rowStyle}>
                    {orderStatus === "draft" ? (
                      <button type="button" style={disabledBtn(primaryBtnStyle, saving)} disabled={saving} onClick={() => void handleSetStatus(selected.id, "confirm")}>
                        确认 (Confirm)
                      </button>
                    ) : null}
                    {orderStatus === "confirm" ? (
                      <>
                        <button type="button" style={disabledBtn(btnStyle, saving)} disabled={saving} onClick={() => void handleSetStatus(selected.id, "draft")}>
                          取消确认 (回草稿)
                        </button>
                        <button type="button" style={disabledBtn(dangerBtnStyle, saving)} disabled={saving} onClick={() => void handleSetStatus(selected.id, "cancel")}>
                          取消登记
                        </button>
                      </>
                    ) : null}
                    {orderStatus === "cancel" ? (
                      <button type="button" style={disabledBtn(btnStyle, saving)} disabled={saving} onClick={() => void handleSetStatus(selected.id, "draft")}>
                        重新打开 (草稿)
                      </button>
                    ) : null}
                    <button type="button" style={disabledBtn(dangerBtnStyle, saving)} disabled={saving} onClick={() => void handleDelete(selected.id)}>
                      删除登记
                    </button>
                  </div>
                </div>
              ) : null}

              <div style={sectionStyle}>
                <div style={sectionHeadStyle}>
                  <div style={sectionTitleStyle}>登记资料{editable ? "" : "（只读）"}</div>
                  {editable ? (
                    <button type="button" style={disabledBtn(primaryBtnStyle, saving)} disabled={saving} onClick={() => void handleSaveInfo(selected.id)}>
                      {saving ? "保存中…" : "保存资料"}
                    </button>
                  ) : null}
                </div>
                <div style={tableWrapStyle}>
                  <table className="lamp-kv">
                    <tbody>
                      <tr><th>登记编号</th><td>{selected.id}</td></tr>
                      <tr>
                        <th>祈福者</th>
                        <td>{editable ? <input style={inputStyle} value={form.devotee_name} disabled={saving} onChange={(e) => setForm((p) => ({ ...p, devotee_name: e.target.value }))} /> : form.devotee_name || "-"}</td>
                      </tr>
                      <tr>
                        <th>电话</th>
                        <td>{editable ? <input style={inputStyle} value={form.phone} disabled={saving} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} /> : form.phone || "-"}</td>
                      </tr>
                      <tr>
                        <th>地址</th>
                        <td>{editable ? <input style={inputStyle} value={form.address} disabled={saving} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} /> : form.address || "-"}</td>
                      </tr>
                      <tr><th>合计</th><td style={cellStrongStyle}>{formatAmount(selected.total_amount)}</td></tr>
                      <tr><th>登记时间</th><td style={monoCellStyle}>{formatDateTime(selected.created_at)}</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={sectionStyle}>
                <div style={sectionHeadStyle}>
                  <div style={sectionTitleStyle}>供灯明细（共 {(selected.lamps || []).length} 项）</div>
                </div>
                {(selected.lamps || []).length ? (
                  <div style={tableWrapStyle}>
                    <table className="lamp-kv">
                      <thead>
                        <tr><th>灯种</th><th>金额</th><th>备注</th></tr>
                      </thead>
                      <tbody>
                        {(selected.lamps || []).map((lamp: LampItem, index) => (
                          <tr key={index}>
                            <td>{lampTypeLabel(lamp.lamp_type)}</td>
                            <td>{formatAmount(lamp.amount)}</td>
                            <td>{lamp.note || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={emptyInlineStyle}>暂无供灯明细。</div>
                )}
              </div>

              <div style={mutedStyle}>点灯付款审核已移至「财政 · 收款审核」统一管理。</div>
            </div>
          )}
        </section>
      </div>
    );
  }

  // -------- List --------
  return (
    <div style={pageStyle}>
      <style>{TABLE_CSS}</style>
      <section style={panelStyle}>
        <div style={toolbarStyle}>
          <div>
            <div style={eyebrowStyle}>点灯法会 (LAMP)</div>
            <h2 style={titleStyle}>点灯登记</h2>
            <div style={mutedStyle}>共 {rows.length} 条登记</div>
          </div>
          <button type="button" style={btnStyle} onClick={() => void loadData()} disabled={loading}>
            {loading ? "刷新中…" : "刷新"}
          </button>
        </div>

        <div style={filterBarStyle}>
          <div style={tabBarStyle}>
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                style={tab.key === statusFilter ? tabActiveStyle : tabStyle}
                onClick={() => setStatusFilter(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索祈福者 / 电话 / 地址 / 状态" style={searchInputStyle} />
        </div>

        {notice ? <div style={notice.tone === "success" ? successStyle : errorStyle}>{notice.text}</div> : null}
        {error ? <div style={errorStyle}>{error}</div> : null}

        {loading ? <div style={emptyStyle}>加载中…</div> : null}
        {!loading && !filtered.length ? <div style={emptyStyle}>{rows.length ? "没有匹配的登记。" : "暂无点灯登记。"}</div> : null}

        {!loading && filtered.length ? (
          <div style={{ display: "grid", gap: "8px", padding: "12px 14px 4px" }}>
            <nav style={pagerStyle}>
              <button
                type="button"
                onClick={() => paged.setPage(Math.max(1, paged.page - 1))}
                disabled={paged.page <= 1}
                style={{ ...pageBtnStyle, ...(paged.page <= 1 ? pageBtnDisabledStyle : null) }}
              >
                上一页
              </button>
              <span style={pageIndicatorStyle}>{`${paged.page} / ${paged.totalPages}`}</span>
              <button
                type="button"
                onClick={() => paged.setPage(Math.min(paged.totalPages, paged.page + 1))}
                disabled={paged.page >= paged.totalPages}
                style={{ ...pageBtnStyle, ...(paged.page >= paged.totalPages ? pageBtnDisabledStyle : null) }}
              >
                下一页
              </button>
              <span style={mutedStyle}>{`共 ${paged.total} 条`}</span>
            </nav>
            <div style={tableWrapStyle}>
              <table className="lamp-table">
                <thead>
                  <tr>
                    <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "status"))}>状态{sortArrow(sort, "status")}</th>
                    <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "name"))}>祈福者{sortArrow(sort, "name")}</th>
                    <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "phone"))}>电话{sortArrow(sort, "phone")}</th>
                    <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "amount"))}>金额{sortArrow(sort, "amount")}</th>
                    <th>供灯</th>
                    <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "created_at"))}>登记时间{sortArrow(sort, "created_at")}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.pageRows.map((r) => (
                    <tr key={r.id} className="lamp-row" onClick={() => setParam("lamp_id", String(r.id))}>
                      <td><span style={chipStyle(statusTone(r.status))}>{statusLabel(r.status)}</span></td>
                      <td style={cellStrongStyle}>{r.devotee_name || "-"}</td>
                      <td style={monoCellStyle}>{r.phone || "-"}</td>
                      <td style={cellStrongStyle}>{formatAmount(r.total_amount)}</td>
                      <td>{(r.lamps || []).length} 项</td>
                      <td style={monoCellStyle}>{formatDateTime(r.created_at)}</td>
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

function disabledBtn(style: CSSProperties, disabled: boolean): CSSProperties {
  return disabled ? { ...style, opacity: 0.5, cursor: "not-allowed" } : style;
}

const TABLE_CSS = `
.lamp-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 720px; }
.lamp-table thead th {
  position: sticky; top: 0; z-index: 1; text-align: left; padding: 9px 12px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--x-color-ink-muted); background: var(--x-color-canvas-alt);
  border-bottom: 1px solid var(--x-color-line); white-space: nowrap;
}
.lamp-table tbody td { padding: 10px 12px; border-bottom: 1px solid var(--x-color-line-soft); vertical-align: middle; color: var(--x-color-ink); }
.lamp-table tbody tr.lamp-row { cursor: pointer; }
.lamp-table tbody tr.lamp-row:hover td { background: var(--x-color-accent-tint); }
.lamp-kv { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 420px; }
.lamp-kv th { text-align: left; padding: 8px 10px; font-weight: 700; white-space: nowrap; color: var(--x-color-ink-muted); background: var(--x-color-canvas-alt); border-bottom: 1px solid var(--x-color-line-soft); }
.lamp-kv thead th { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
.lamp-kv tbody td { padding: 8px 10px; border-bottom: 1px solid var(--x-color-line-soft); vertical-align: middle; color: var(--x-color-ink); }
`;

const pageStyle: CSSProperties = { display: "grid", gap: "16px" };
const panelStyle: CSSProperties = {
  borderRadius: "12px", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line)",
  boxShadow: "0 1px 2px var(--x-color-shadow-soft)", overflow: "hidden",
};
const toolbarStyle: CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap",
  padding: "16px 18px", borderBottom: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-alt)",
};
const filterBarStyle: CSSProperties = {
  display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "center",
  padding: "10px 14px", borderBottom: "1px solid var(--x-color-line-soft)",
};
const tabBarStyle: CSSProperties = { display: "flex", gap: "6px", flexWrap: "wrap" };
const tabStyle: CSSProperties = {
  padding: "7px 13px", borderRadius: "8px", border: "1px solid transparent", background: "transparent",
  color: "var(--x-color-ink-muted)", fontWeight: 600, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap",
};
const tabActiveStyle: CSSProperties = {
  ...tabStyle, border: "1px solid var(--x-color-accent-border)", background: "var(--x-color-panel)",
  color: "var(--x-color-accent-strong)", boxShadow: "0 1px 2px var(--x-color-shadow-soft)",
};
const pagerStyle: CSSProperties = { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" };
const pageIndicatorStyle: CSSProperties = {
  display: "inline-flex", alignItems: "center", padding: "0 4px", color: "var(--x-color-ink-muted)", fontSize: "13px", fontWeight: 700,
};
const pageBtnStyle: CSSProperties = {
  minWidth: "40px", padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 700, fontSize: "13px", cursor: "pointer",
};
const pageBtnDisabledStyle: CSSProperties = { opacity: 0.5, cursor: "not-allowed" };
const searchInputStyle: CSSProperties = {
  flex: "1 1 240px", minHeight: "34px", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontSize: "13px", boxSizing: "border-box",
};
const eyebrowStyle: CSSProperties = { fontSize: "11px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--x-color-ink-muted)", fontWeight: 700 };
const titleStyle: CSSProperties = { margin: "2px 0", fontSize: "18px", fontWeight: 800 };
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
const rowStyle: CSSProperties = { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" };

const btnStyle: CSSProperties = {
  padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)",
  color: "var(--x-color-ink)", fontWeight: 600, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap",
};
const primaryBtnStyle: CSSProperties = {
  padding: "8px 16px", borderRadius: "8px", border: "1px solid var(--x-color-accent-strong)", background: "var(--x-color-accent)",
  color: "white", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap",
};
const dangerBtnStyle: CSSProperties = {
  padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap",
};

const errorStyle: CSSProperties = {
  margin: "12px 14px 0", padding: "10px 14px", borderRadius: "8px", background: "var(--x-color-danger-soft)",
  border: "1px solid var(--x-color-danger-border)", color: "var(--x-color-danger)", fontSize: "13px",
};
const successStyle: CSSProperties = {
  margin: "12px 14px 0", padding: "10px 14px", borderRadius: "8px", background: "var(--x-color-success-soft)",
  border: "1px solid rgba(21,128,61,0.28)", color: "var(--x-color-success)", fontSize: "13px",
};
const emptyStyle: CSSProperties = {
  margin: "16px", padding: "28px", borderRadius: "10px", border: "1px dashed var(--x-color-line)",
  textAlign: "center", color: "var(--x-color-ink-muted)",
};
const emptyInlineStyle: CSSProperties = {
  padding: "12px 14px", borderRadius: "8px", border: "1px dashed var(--x-color-line)", color: "var(--x-color-ink-muted)", fontSize: "13px",
};
const tableWrapStyle: CSSProperties = { width: "100%", overflowX: "auto" };
const cellStrongStyle: CSSProperties = { fontWeight: 700, lineHeight: 1.4 };
const monoCellStyle: CSSProperties = { fontFamily: "var(--x-font-mono)", fontSize: "12.5px", whiteSpace: "nowrap" };
const bodyStyle: CSSProperties = { padding: "16px 18px", display: "grid", gap: "14px" };
const sectionStyle: CSSProperties = { display: "grid", gap: "8px" };
const sectionHeadStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" };
const sectionTitleStyle: CSSProperties = { fontSize: "12px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" };
const inputStyle: CSSProperties = {
  width: "100%", minWidth: "160px", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)", color: "var(--x-color-ink)", boxSizing: "border-box", fontSize: "13px",
};

function chipStyle(tone: "success" | "danger" | "warning"): CSSProperties {
  const palette =
    tone === "success"
      ? { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" }
      : tone === "danger"
        ? { background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" }
        : { background: "var(--x-color-warning-soft)", color: "var(--x-color-warning)" };
  return {
    display: "inline-flex", alignItems: "center", padding: "4px 10px", borderRadius: "6px",
    fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap", ...palette,
  };
}
