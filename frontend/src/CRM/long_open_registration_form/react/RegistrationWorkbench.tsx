import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { io, type Socket } from "socket.io-client";

import { render_sign_modal, renderSignPreviewSvg } from "../../../../../static/js/sign_tools.js";

import { useUserState } from "../../../app/UserState";
import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { copyTextToClipboard } from "../../../js/browserActions";
import { showPromptDialog } from "../../../js/dialogs";
import { FeePanel, type FeeDraft, normalizeFeeDrafts, summarizeFee } from "../../form/react/FeePanel";
import { TablePagination, usePagedRows } from "../../shared/TablePagination";
import {
  PUBLIC_ORIGIN,
  registrationStatusLabel,
  toPublicUrl,
  type CouncilState,
  type DetailField,
  type PaymentRecord,
  type Settings,
  type SignStrokes,
  type WorkbenchConfig,
  type WorkbenchEntry,
} from "./workbenchConfig";

type Notice = { tone: "success" | "error"; text: string };
type TabKey = "list" | "fees" | "public";

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "list", label: "申请列表", icon: "fa-solid fa-table-list" },
  { key: "fees", label: "费率设置", icon: "fa-solid fa-coins" },
  { key: "public", label: "打开公开报名页", icon: "fa-solid fa-arrow-up-right-from-square" },
];

async function copyText(text: string) {
  try {
    await copyTextToClipboard(text);
  } catch {
    await showPromptDialog({
      title: "复制链接",
      message: "请复制下面的内容",
      initialValue: text,
      readOnly: true,
      confirmText: "关闭",
    });
  }
}

function formatAmount(amount: number | string | undefined | null) {
  return `RM ${Number(amount || 0).toFixed(2)}`;
}

function paymentStatusLabel(status: string | undefined) {
  if (status === "checked") return "已确认";
  if (status === "fail") return "已拒绝";
  return "审核中";
}

function latestPaymentOf(entry: WorkbenchEntry): PaymentRecord | null {
  if (entry.latest_payment) return entry.latest_payment;
  return entry.payments && entry.payments.length ? entry.payments[0] : null;
}

function councilOf(entry: WorkbenchEntry): CouncilState {
  return (
    entry.council || {
      required: 1,
      max: 20,
      count: 0,
      approved: false,
      full: false,
      signatures: [],
      viewer_can_sign: false,
      viewer_signed: false,
    }
  );
}

function isFinanceApproved(entry: WorkbenchEntry) {
  return Boolean(entry.finance_approved) || entry.status === "paid";
}

function fieldString(entry: WorkbenchEntry, key?: string): string {
  if (!key) return "";
  const value = entry[key];
  return value == null ? "" : String(value);
}

export function RegistrationWorkbench({ config }: { config: WorkbenchConfig }) {
  useEnsureDesignTokens();

  const { isMobile } = useUserState();
  const [searchParams, setSearchParams] = useSearchParams();
  const [entries, setEntries] = useState<WorkbenchEntry[]>([]);
  const [settings, setSettings] = useState<Settings>({ fees: [] });
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [updatingPaymentId, setUpdatingPaymentId] = useState<number | null>(null);
  const [councilBusy, setCouncilBusy] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [paymentPreview, setPaymentPreview] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("list");

  const applicationUrl = `${PUBLIC_ORIGIN}${config.publicFormPath}`;

  const selectedId = useMemo(() => {
    const raw = searchParams.get("entry_id");
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [entryPayload, settingsPayload] = await Promise.all([
        config.endpoints.fetchEntries(),
        config.endpoints.fetchSettings(),
      ]);
      setEntries(Array.isArray(entryPayload.entries) ? entryPayload.entries : []);
      const nextSettings = settingsPayload.settings || {};
      setSettings({
        id: nextSettings.id ?? null,
        fees: normalizeFeeDrafts(nextSettings.fees || nextSettings.fee_options),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (config.canRead) void loadData();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.scope]);

  // 青少年佛学班使用 socket 实时刷新（会员未配置 socket 时此 effect 直接跳过）。
  useEffect(() => {
    const sc = config.socket;
    if (!sc || !config.canRead) return;
    const socket: Socket = io(sc.origin, { withCredentials: true, transports: ["websocket", "polling"] });
    const join = () => socket.emit("join_room", { room: sc.room });
    socket.on("connect", join);
    if (socket.connected) join();
    const handler = (payload: { event?: string; message?: string }) => {
      if (sc.noticeText && payload?.message) setNotice({ tone: "success", text: payload.message });
      void loadData();
    };
    socket.on(sc.event, handler);
    return () => {
      socket.off("connect", join);
      socket.off(sc.event, handler);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.scope, config.canRead]);

  const stats = useMemo(() => {
    const approved = entries.filter((entry) => entry.status === "paid").length;
    const processing = entries.filter((entry) => entry.status === "process").length;
    return { approved, processing };
  }, [entries]);

  const selectedEntry = useMemo(
    () => (selectedId == null ? null : entries.find((entry) => entry.id === selectedId) || null),
    [entries, selectedId],
  );

  async function handleCopyLink(url: string | null | undefined) {
    if (!url) {
      setNotice({ tone: "error", text: "还没有可复制的链接。" });
      return;
    }
    try {
      await copyText(url);
      setNotice({ tone: "success", text: "链接已复制。" });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "复制失败" });
    }
  }

  async function handleSaveSettings() {
    setSavingSettings(true);
    setNotice(null);
    try {
      const result = await config.endpoints.saveSettings(settings);
      const nextSettings = result.settings || settings;
      setSettings({
        id: nextSettings.id ?? null,
        fees: normalizeFeeDrafts(nextSettings.fees || nextSettings.fee_options),
      });
      setNotice({ tone: "success", text: result.message || config.feesSavedNotice });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handlePaymentStatus(paymentId: number, status: string) {
    setUpdatingPaymentId(paymentId);
    setNotice(null);
    try {
      const result = await config.endpoints.updatePaymentStatus(paymentId, status);
      setNotice({ tone: "success", text: result.message || "付款状态已更新" });
      await loadData();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "更新失败" });
    } finally {
      setUpdatingPaymentId(null);
    }
  }

  async function handleCouncilSign(registrationId: number) {
    let signature: SignStrokes | null = null;
    try {
      signature = (await render_sign_modal({ strokes: [] })) as SignStrokes | null;
    } catch {
      signature = null;
    }
    if (!signature || !Array.isArray(signature.strokes) || !signature.strokes.length) return;

    setCouncilBusy(true);
    setNotice(null);
    try {
      const result = await config.endpoints.signCouncil(registrationId, signature);
      setNotice({ tone: "success", text: result.message || "签名已记录" });
      await loadData();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "操作失败" });
    } finally {
      setCouncilBusy(false);
    }
  }

  function toggleSelected(id: number, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAll(ids: number[], checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function handleCreateBatchUrl() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setBatchBusy(true);
    setNotice(null);
    try {
      const result = await config.endpoints.batchSignUrl(ids);
      const url = toPublicUrl(result.url);
      if (!url) throw new Error("生成批量签名 URL 失败");
      await copyText(url);
      setNotice({ tone: "success", text: `批量理事会审核 URL 已复制（${result.count ?? ids.length} 份），可发给理事签名。` });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "生成失败" });
    } finally {
      setBatchBusy(false);
    }
  }

  async function handleSaveField(registrationId: number, field: string, value: string) {
    setSavingField(field);
    setNotice(null);
    try {
      const result = await config.endpoints.updateFields(registrationId, { [field]: value });
      setNotice({ tone: "success", text: result.message || "资料已更新" });
      await loadData();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "更新失败" });
    } finally {
      setSavingField(null);
    }
  }

  async function handleRemove(registrationId: number) {
    if (typeof window !== "undefined" && !window.confirm("确定要移除这份申请吗？移除后将不再显示。")) return;
    setNotice(null);
    try {
      const result = await config.endpoints.remove(registrationId);
      closeEntry();
      setNotice({ tone: "success", text: result.message || "已移除。" });
      await loadData();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "移除失败" });
    }
  }

  async function handleUpgrade(registrationId: number) {
    if (!config.upgradeToMembership) return;
    setNotice(null);
    try {
      const result = await config.upgradeToMembership(registrationId);
      setNotice({ tone: "success", text: result.message || "已升级为会员申请。" });
      await loadData();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "升级失败" });
    }
  }

  function createLocalFeeId() {
    return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  function handleAddFee(payload: FeeDraft) {
    setSettings((prev) => ({ ...prev, fees: [...(prev.fees || []), { ...payload, id: createLocalFeeId() }] }));
  }
  function handleEditFee(feeId: number | string, payload: FeeDraft) {
    setSettings((prev) => ({
      ...prev,
      fees: (prev.fees || []).map((fee) => (String(fee.id) === String(feeId) ? { ...payload, id: fee.id ?? feeId } : fee)),
    }));
  }
  function handleDeleteFee(feeId: number | string) {
    setSettings((prev) => ({ ...prev, fees: (prev.fees || []).filter((fee) => String(fee.id) !== String(feeId)) }));
  }

  function openEntry(id: number) {
    const next = new URLSearchParams(searchParams);
    next.set("entry_id", String(id));
    setSearchParams(next);
  }
  function closeEntry() {
    const next = new URLSearchParams(searchParams);
    next.delete("entry_id");
    setSearchParams(next);
  }
  function selectTab(key: TabKey) {
    if (searchParams.has("entry_id")) closeEntry();
    setActiveTab(key);
  }

  if (!config.canRead) {
    return (
      <div style={pageStyle(isMobile)}>
        <section style={panelStyle}>
          <div style={emptyStyle}>你没有查看该工作台的权限。</div>
        </section>
      </div>
    );
  }

  // Detail page — selected entry lives in the URL (?entry_id=), so refresh keeps this view.
  if (selectedId != null) {
    return (
      <div style={pageStyle(isMobile)}>
        <style>{TABLE_CSS}</style>
        {selectedEntry ? (
          <>
            <WorkbenchDetailPage
              config={config}
              entry={selectedEntry}
              isMobile={isMobile}
              notice={notice}
              error={error}
              updatingPaymentId={updatingPaymentId}
              councilBusy={councilBusy}
              savingField={savingField}
              onBack={closeEntry}
              onCopyLink={(url) => void handleCopyLink(url)}
              onPaymentStatus={(paymentId, status) => void handlePaymentStatus(paymentId, status)}
              onCouncilSign={() => void handleCouncilSign(selectedEntry.id)}
              onCopySignUrl={() => void handleCopyLink(toPublicUrl(selectedEntry.council_sign_url))}
              onSaveField={(field, value) => handleSaveField(selectedEntry.id, field, value)}
              onOpenPayment={() => setPaymentPreview(toPublicUrl(selectedEntry.payment_url))}
              onRemove={() => void handleRemove(selectedEntry.id)}
              onUpgrade={config.upgradeToMembership ? () => void handleUpgrade(selectedEntry.id) : undefined}
            />
            {paymentPreview ? (
              <PhonePreviewOverlay src={paymentPreview} title={config.paymentPageTitle} onClose={() => setPaymentPreview(null)} />
            ) : null}
          </>
        ) : (
          <section style={panelStyle}>
            <div style={detailHeaderStyle(isMobile)}>
              <div style={detailHeaderLeftStyle}>
                <button type="button" style={erpButtonStyle} onClick={closeEntry}>
                  ← 返回列表
                </button>
                <div>
                  <div style={eyebrowStyle}>{config.detailEyebrowPrefix}{selectedId}</div>
                  <h2 style={panelTitleStyle}>{loading ? "加载中…" : "记录不存在"}</h2>
                </div>
              </div>
            </div>
            <div style={emptyStyle}>{loading ? "正在加载…" : "找不到这条记录，可能已被处理，或数据已刷新。"}</div>
          </section>
        )}
      </div>
    );
  }

  return (
    <div style={pageStyle(isMobile)}>
      <style>{TABLE_CSS}</style>

      <section style={panelStyle}>
        <div style={tabHeaderStyle(isMobile)}>
          <div style={tabBarStyle}>
            {TABS.map((tab) => {
              const active = tab.key === activeTab;
              return (
                <button key={tab.key} type="button" style={active ? tabActiveStyle : tabStyle} onClick={() => selectTab(tab.key)}>
                  <i className={tab.icon} style={{ fontSize: "13px" }} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
          {activeTab === "list" ? (
            <div style={tabHeaderActionsStyle(isMobile)}>
              <span style={statLineStyle}>
                共 {entries.length} 条 · 处理中 {stats.processing} · 已生效 {stats.approved}
              </span>
              <button type="button" style={erpButtonStyle} onClick={() => void loadData()} disabled={loading}>
                {loading ? "刷新中…" : "刷新"}
              </button>
            </div>
          ) : null}
        </div>

        {notice ? <div style={notice.tone === "success" ? successStyle : errorStyle}>{notice.text}</div> : null}
        {error ? <div style={errorStyle}>{error}</div> : null}

        {activeTab === "list" ? (
          <ListView
            config={config}
            entries={entries}
            loading={loading}
            onSelect={openEntry}
            selectedIds={selectedIds}
            onToggleRow={toggleSelected}
            onToggleAll={toggleSelectAll}
          />
        ) : null}

        {activeTab === "fees" ? (
          <div style={sectionBodyStyle}>
            <div style={feeSectionHeadStyle}>
              <h3 style={subTitleStyle}>{config.feesTitle}</h3>
              <span style={mutedStyle}>{settings.fees?.length ? `已配置 ${settings.fees.length} 条费率` : "尚未配置年龄费率"}</span>
            </div>
            <FeePanel
              fees={(settings.fees || []).map((fee, index) => ({ ...fee, id: fee.id ?? `${config.scope}-fee-${index}` }))}
              onAdd={handleAddFee}
              onEdit={handleEditFee}
              onDelete={handleDeleteFee}
              readOnly={!config.canEdit}
              addButtonLabel={config.feePanel.addButtonLabel}
              saveButtonLabel={config.feePanel.saveButtonLabel}
              emptyText={config.feePanel.emptyText}
              showCategory={false}
              enableImageUpload
              imageLabel={config.feePanel.imageLabel}
              descriptionPlaceholder={config.feePanel.descriptionPlaceholder}
            />
            {config.canEdit ? (
              <div style={feeFooterStyle}>
                <button type="button" style={erpPrimaryButtonStyle} onClick={() => void handleSaveSettings()} disabled={savingSettings}>
                  {savingSettings ? "保存中…" : config.feesSaveLabel}
                </button>
              </div>
            ) : (
              <div style={mutedStyle}>当前为只读模式。</div>
            )}
          </div>
        ) : null}

        {activeTab === "public" ? (
          <div style={sectionBodyStyle}>
            <div style={feeSectionHeadStyle}>
              <h3 style={subTitleStyle}>统一公开报名页</h3>
              <button type="button" style={erpButtonStyle} onClick={() => void handleCopyLink(applicationUrl)}>
                复制报名链接
              </button>
            </div>
            <div style={urlBoxStyle}>{applicationUrl}</div>
            <PhoneFrame src={applicationUrl} title="统一公开报名页" />
          </div>
        ) : null}
      </section>

      {activeTab === "list" && selectedIds.size > 0 ? (
        <div style={actionBarStyle}>
          <span style={actionBarCountStyle}>已选 {selectedIds.size} 份</span>
          <button type="button" className="mrp-btn mrp-btn--go" style={actionBarBtnStyle} disabled={batchBusy} onClick={() => void handleCreateBatchUrl()}>
            {batchBusy ? "生成中…" : "创建批量理事会审核 URL"}
          </button>
          <button type="button" className="mrp-btn" style={actionBarBtnStyle} onClick={clearSelection}>
            清空
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ListView({
  config,
  entries,
  loading,
  onSelect,
  selectedIds,
  onToggleRow,
  onToggleAll,
}: {
  config: WorkbenchConfig;
  entries: WorkbenchEntry[];
  loading: boolean;
  onSelect: (id: number) => void;
  selectedIds: Set<number>;
  onToggleRow: (id: number, checked: boolean) => void;
  onToggleAll: (ids: number[], checked: boolean) => void;
}) {
  const { page, totalPages, total, pageRows, setPage } = usePagedRows(entries);
  if (loading) return <div style={emptyStyle}>加载中…</div>;
  if (!entries.length) return <div style={emptyStyle}>{config.emptyListText}</div>;

  const allIds = entries.map((entry) => entry.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));

  return (
    <div style={{ display: "grid", gap: "8px", padding: "12px 14px 4px" }}>
      <TablePagination page={page} totalPages={totalPages} total={total} onPage={setPage} />
      <div style={tableWrapStyle}>
      <table className="mrp-table">
        <thead>
          <tr>
            <th style={{ width: 36 }}>
              <input
                type="checkbox"
                aria-label="全选"
                checked={allSelected}
                onChange={(e) => onToggleAll(allIds, e.target.checked)}
                style={checkboxStyle}
              />
            </th>
            <th>状态</th>
            <th>财政审核</th>
            <th>理事会审核</th>
            {config.listColumns.map((col) => (
              <th key={col.header}>{col.header}</th>
            ))}
            <th>最新付款</th>
            <th>提交时间</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((entry) => {
            const latest = latestPaymentOf(entry);
            const council = councilOf(entry);
            const financeOk = isFinanceApproved(entry);
            return (
              <tr key={entry.id} className="mrp-row" onClick={() => onSelect(entry.id)}>
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(entry.id)}
                    onChange={(e) => onToggleRow(entry.id, e.target.checked)}
                    style={checkboxStyle}
                  />
                </td>
                <td>
                  <span style={statusChipStyle(entry.status === "paid" ? "success" : entry.status === "reject" ? "danger" : "info")}>
                    {registrationStatusLabel(entry.status)}
                  </span>
                </td>
                <td>
                  <span style={statusChipStyle(financeOk ? "success" : "info")}>{financeOk ? "已通过" : "待通过"}</span>
                </td>
                <td>
                  <div style={councilCellStyle}>
                    <span style={statusChipStyle(council.approved ? "success" : "info")}>{council.approved ? "已通过" : "收集中"}</span>
                    <span style={councilCountStyle}>
                      {council.count} / {council.approved ? council.max : council.required}
                    </span>
                  </div>
                </td>
                {config.listColumns.map((col) => (
                  <td key={col.header} style={col.mono ? monoCellStyle : undefined}>
                    <div style={cellStrongStyle}>{col.value(entry) || "—"}</div>
                    {col.sub ? <div style={cellSubStyle}>{col.sub(entry)}</div> : null}
                  </td>
                ))}
                <td>
                  {latest ? (
                    <>
                      <div style={cellStrongStyle}>{formatAmount(latest.amount)}</div>
                      <div style={cellSubStyle}>{paymentStatusLabel(latest.status)}</div>
                    </>
                  ) : (
                    <span style={mutedStyle}>无付款</span>
                  )}
                </td>
                <td style={monoCellStyle}>{entry.submitted_at || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function WorkbenchDetailPage({
  config,
  entry,
  isMobile,
  notice,
  error,
  updatingPaymentId,
  councilBusy,
  savingField,
  onBack,
  onCopyLink,
  onPaymentStatus,
  onCouncilSign,
  onCopySignUrl,
  onSaveField,
  onOpenPayment,
  onRemove,
  onUpgrade,
}: {
  config: WorkbenchConfig;
  entry: WorkbenchEntry;
  isMobile: boolean;
  notice: Notice | null;
  error: string;
  updatingPaymentId: number | null;
  councilBusy: boolean;
  savingField: string | null;
  onBack: () => void;
  onCopyLink: (url: string | null | undefined) => void;
  onPaymentStatus: (paymentId: number, status: string) => void;
  onCouncilSign: () => void;
  onCopySignUrl: () => void;
  onSaveField: (field: string, value: string) => void;
  onOpenPayment: () => void;
  onRemove: () => void;
  onUpgrade?: () => void;
}) {
  const payments = entry.payments || [];
  const council = councilOf(entry);
  const financeOk = isFinanceApproved(entry);
  const activated = Boolean(entry.activated) || entry.status === "paid";
  const editable = !activated && config.canEdit;

  function renderField(field: DetailField, idx: number) {
    if (field.editable) {
      return (
        <EditableFact
          key={idx}
          label={field.label}
          value={fieldString(entry, field.key)}
          field={field.putKey || field.key || ""}
          link={field.kind === "link"}
          placeholder={field.placeholder}
          editable={editable}
          saving={savingField === (field.putKey || field.key)}
          onSave={onSaveField}
        />
      );
    }
    const raw = field.value ? field.value(entry) : fieldString(entry, field.key);
    return <Fact key={idx} label={field.label} value={raw && raw.trim() ? raw : "未填写"} />;
  }

  return (
    <section style={panelStyle}>
      <div style={detailHeaderStyle(isMobile)}>
        <div style={detailHeaderLeftStyle}>
          <button type="button" style={erpButtonStyle} onClick={onBack}>
            ← 返回列表
          </button>
          <div>
            <div style={eyebrowStyle}>{config.detailEyebrowPrefix}{entry.id}</div>
            <h2 style={panelTitleStyle}>{config.pageTitleFor(entry)}</h2>
            <div style={statLineStyle}>{config.detailSubline(entry)}</div>
          </div>
        </div>
        <div style={detailHeaderRightStyle(isMobile)}>
          <span style={statusChipStyle(entry.status === "paid" ? "success" : entry.status === "reject" ? "danger" : "info")}>
            {registrationStatusLabel(entry.status)}
          </span>
          <button type="button" style={erpButtonStyle} disabled={!entry.payment_url} onClick={onOpenPayment}>
            打开付款页
          </button>
          <button type="button" style={erpButtonStyle} onClick={() => onCopyLink(toPublicUrl(entry.payment_url))}>
            复制付款链接
          </button>
          {activated && onUpgrade ? (
            <button type="button" style={erpPrimaryButtonStyle} onClick={onUpgrade}>
              升级为会员
            </button>
          ) : null}
          {!activated && config.canEdit ? (
            <button type="button" style={dangerButtonStyle} onClick={onRemove}>
              移除申请
            </button>
          ) : null}
        </div>
      </div>

      {notice ? <div style={notice.tone === "success" ? successStyle : errorStyle}>{notice.text}</div> : null}
      {error ? <div style={errorStyle}>{error}</div> : null}

      <div style={sectionBodyStyle}>
        {editable ? (
          <div style={editHintStyle}>
            <i className="fa-solid fa-pen" style={{ fontSize: "11px" }} /> 未通过前可编辑资料：点右上角的笔即可修改，改完点保存。
          </div>
        ) : null}
        <div style={detailGridStyle(isMobile)}>{config.detailFields.map(renderField)}</div>

        <div style={paymentsHeadStyle}>审批进度</div>
        <div style={approvalGridStyle(isMobile)}>
          <div style={approvalCardStyle}>
            <div style={approvalCardHeadStyle}>
              <span style={approvalCardTitleStyle}>财政审核</span>
              <span style={statusChipStyle(financeOk ? "success" : "info")}>{financeOk ? "已通过" : "待通过"}</span>
            </div>
            <div style={mutedStyle}>只要有一条付款记录审核通过即视为财政通过（见下方付款记录）。</div>
          </div>

          <div style={approvalCardStyle}>
            <div style={approvalCardHeadStyle}>
              <span style={approvalCardTitleStyle}>理事会审核</span>
              <span style={statusChipStyle(council.approved ? "success" : "info")}>
                {council.approved ? `已通过 · ${council.count} / ${council.max}` : `${council.count} / ${council.required}`}
              </span>
            </div>
            <div style={councilProgressTrackStyle}>
              <div
                style={{
                  ...councilProgressFillStyle,
                  width: `${Math.min(100, (council.count / Math.max(1, council.approved ? council.max : council.required)) * 100)}%`,
                }}
              />
            </div>
            <div style={mutedStyle}>
              需要 ≥ {council.required} 位有 council_approve 权限的理事签名；生效后仍可继续补签，最多 {council.max} 个。签名后不可撤回。
            </div>
            {council.signatures.length ? (
              <div style={signatureListStyle}>
                {council.signatures.map((sig) => (
                  <div key={sig.id} style={signatureCardStyle} title={sig.signed_at || undefined}>
                    <SignaturePreview data={sig.signature} />
                    <div style={signatureNameStyle}>{sig.signer_name || `用户 #${sig.user_id}`}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={mutedStyle}>还没有理事签名。</div>
            )}
            {activated ? (
              <div style={mutedStyle}>已生效，注册日期已开始{council.full ? "" : "（仍可继续补签）"}。</div>
            ) : null}
            <div style={councilActionRowStyle}>
              {council.viewer_can_sign && !council.viewer_signed && !council.full ? (
                <button type="button" className="mrp-btn mrp-btn--go" style={{ width: "auto", padding: "8px 16px" }} disabled={councilBusy} onClick={onCouncilSign}>
                  {councilBusy ? "处理中…" : "我要签名"}
                </button>
              ) : null}
              {!council.full ? (
                <button type="button" className="mrp-btn" style={{ width: "auto", padding: "8px 16px" }} onClick={onCopySignUrl}>
                  <i className="fa-solid fa-link" style={{ marginRight: "6px" }} />
                  复制签名 URL
                </button>
              ) : null}
            </div>
            {council.viewer_signed ? <div style={mutedStyle}>你已签名（不可撤回）。</div> : null}
            {council.full ? <div style={mutedStyle}>理事会签名已满（{council.max} 个）。</div> : null}
            {!council.viewer_can_sign ? (
              <div style={mutedStyle}>你没有 council_approve 权限，无法亲自签名；可复制签名 URL 发给有权限的理事。</div>
            ) : null}
          </div>
        </div>

        <div style={paymentsHeadStyle}>付款记录</div>
        {payments.length ? (
          <div style={tableWrapStyle}>
            <table className="mrp-table mrp-table--inner">
              <thead>
                <tr>
                  {config.canEdit ? <th style={{ width: isMobile ? 176 : 210 }}>审核</th> : null}
                  <th>付款单号</th>
                  <th>金额</th>
                  <th>状态</th>
                  <th>提交时间</th>
                  <th>付款截图</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => {
                  const isUpdating = updatingPaymentId === payment.id;
                  const proofUrl = payment.proof_image_url || "";
                  return (
                    <tr key={payment.id}>
                      {config.canEdit ? (
                        <td>
                          <div style={actionTripleStyle}>
                            <button type="button" className="mrp-btn" disabled={isUpdating} onClick={() => onPaymentStatus(payment.id, "process")}>
                              处理中
                            </button>
                            <button type="button" className="mrp-btn mrp-btn--go" disabled={isUpdating} onClick={() => onPaymentStatus(payment.id, "checked")}>
                              通过
                            </button>
                            <button type="button" className="mrp-btn mrp-btn--danger" disabled={isUpdating} onClick={() => onPaymentStatus(payment.id, "fail")}>
                              退回
                            </button>
                          </div>
                        </td>
                      ) : null}
                      <td style={monoCellStyle}>#{payment.id}</td>
                      <td style={cellStrongStyle}>{formatAmount(payment.amount)}</td>
                      <td>{paymentStatusLabel(payment.status)}</td>
                      <td style={monoCellStyle}>{payment.created_at || `${payment.date || "-"} ${payment.time || ""}`.trim()}</td>
                      <td>
                        {proofUrl ? (
                          <a href={proofUrl} target="_blank" rel="noreferrer" style={proofLinkStyle}>
                            查看截图
                          </a>
                        ) : (
                          <span style={mutedStyle}>没有截图</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={emptyInlineStyle}>这条记录还没有提交付款截图，可以直接复制上方链接重新发给对方。</div>
        )}
      </div>
    </section>
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

function EditableFact({
  label,
  value,
  field,
  editable,
  saving,
  onSave,
  placeholder,
  link,
}: {
  label: string;
  value?: string | null;
  field: string;
  editable: boolean;
  saving: boolean;
  onSave: (field: string, value: string) => void;
  placeholder?: string;
  link?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  function begin() {
    setDraft(value ?? "");
    setEditing(true);
  }
  function commit() {
    onSave(field, draft.trim());
    setEditing(false);
  }

  const display = value && value.trim() ? value : "未填写";

  return (
    <div style={factStyle}>
      <div style={factHeadStyle}>
        <div style={factLabelStyle}>{label}</div>
        {editable ? (
          editing ? (
            <div style={factIconGroupStyle}>
              <button type="button" style={factIconButtonStyle} title="保存" disabled={saving} onClick={commit}>
                <i className={saving ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-floppy-disk"} />
              </button>
              <button type="button" style={factIconButtonStyle} title="取消" disabled={saving} onClick={() => setEditing(false)}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          ) : (
            <button type="button" style={factIconButtonStyle} title="编辑" onClick={begin}>
              <i className="fa-solid fa-pen" />
            </button>
          )
        ) : null}
      </div>
      {editing ? (
        <input
          style={factInputStyle}
          value={draft}
          placeholder={placeholder}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : link && value && value.trim() ? (
        <a href={value} target="_blank" rel="noreferrer" style={{ ...factValueStyle, ...proofLinkStyle }}>
          {value}
        </a>
      ) : (
        <div style={factValueStyle}>{display}</div>
      )}
    </div>
  );
}

function SignaturePreview({ data }: { data?: SignStrokes | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = "";
    if (data && Array.isArray(data.strokes) && data.strokes.length) {
      try {
        renderSignPreviewSvg(el, data);
      } catch {
        el.textContent = "✓";
      }
    } else {
      el.textContent = "✓";
    }
  }, [data]);
  return <div ref={ref} style={signaturePreviewBoxStyle} />;
}

function PhoneFrame({ src, title }: { src: string; title: string }) {
  return (
    <div style={phoneShellStyle}>
      <div style={phoneNotchStyle} />
      <div style={phoneScreenWrapStyle}>
        <iframe src={src} title={title} style={phoneScreenStyle} />
      </div>
      <div style={phoneHomeBarStyle} />
    </div>
  );
}

function PhonePreviewOverlay({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  return (
    <div style={qrBackdropStyle} onClick={onClose}>
      <div style={phonePreviewInnerStyle} onClick={(e) => e.stopPropagation()}>
        <div style={phonePreviewHeadStyle}>
          <span style={qrTitleStyle}>{title}</span>
          <button type="button" style={erpButtonStyle} onClick={onClose}>
            关闭
          </button>
        </div>
        <PhoneFrame src={src} title={title} />
      </div>
    </div>
  );
}

const TABLE_CSS = `
.mrp-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 820px; }
.mrp-table--inner { min-width: 640px; }
.mrp-table thead th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; padding: 9px 12px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--x-color-ink-muted);
  background: var(--x-color-canvas-alt);
  border-bottom: 1px solid var(--x-color-line);
  white-space: nowrap;
}
.mrp-table--inner thead th { position: static; background: var(--x-color-panel-alt); }
.mrp-table tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--x-color-line-soft);
  vertical-align: middle;
  color: var(--x-color-ink);
}
.mrp-table tbody tr.mrp-row { cursor: pointer; }
.mrp-table tbody tr.mrp-row:hover td { background: var(--x-color-accent-tint); }
.mrp-btn {
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--x-color-line);
  background: var(--x-color-panel);
  color: var(--x-color-ink);
  font-size: 12px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.mrp-btn:hover:not(:disabled) { border-color: var(--x-color-accent-border); background: var(--x-color-accent-soft); }
.mrp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.mrp-btn--go { border-color: rgba(21,128,61,0.28); background: var(--x-color-success-soft); color: var(--x-color-success); }
.mrp-btn--go:hover:not(:disabled) { background: var(--x-color-success-soft); border-color: rgba(21,128,61,0.5); }
.mrp-btn--danger { border-color: var(--x-color-danger-border); background: var(--x-color-danger-soft); color: var(--x-color-danger); }
.mrp-btn--danger:hover:not(:disabled) { background: var(--x-color-danger-soft); border-color: rgba(194,65,12,0.5); }
`;

function pageStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gap: isMobile ? "12px" : "16px" };
}

const panelStyle: CSSProperties = {
  padding: "0",
  borderRadius: "12px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 1px 2px var(--x-color-shadow-soft)",
  display: "grid",
  gap: "0",
  overflow: "hidden",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "11px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
};

const panelTitleStyle: CSSProperties = { margin: "2px 0", fontSize: "18px", fontWeight: 800 };
const subTitleStyle: CSSProperties = { margin: 0, fontSize: "15px", fontWeight: 700 };
const statLineStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };

function tabHeaderStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: isMobile ? "stretch" : "center",
    gap: "12px",
    flexWrap: "wrap",
    flexDirection: isMobile ? "column" : "row",
    padding: isMobile ? "10px" : "10px 14px",
    borderBottom: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
  };
}

const tabBarStyle: CSSProperties = { display: "flex", gap: "6px", flexWrap: "wrap" };

const tabStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 14px",
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

function tabHeaderActionsStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    justifyContent: isMobile ? "space-between" : "flex-end",
    width: isMobile ? "100%" : undefined,
  };
}

const erpButtonStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 600,
  fontSize: "13px",
  cursor: "pointer",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const erpPrimaryButtonStyle: CSSProperties = {
  padding: "9px 18px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-accent-strong)",
  background: "var(--x-color-accent)",
  color: "white",
  fontWeight: 700,
  fontSize: "13px",
  cursor: "pointer",
};

const dangerButtonStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 700,
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

const sectionBodyStyle: CSSProperties = { padding: "16px 18px", display: "grid", gap: "14px" };

const feeSectionHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap",
};

const feeFooterStyle: CSSProperties = { display: "flex", justifyContent: "flex-end" };

const urlBoxStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: "8px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
  fontFamily: "var(--x-font-mono)",
  fontSize: "12.5px",
  wordBreak: "break-all",
};

const tableWrapStyle: CSSProperties = { width: "100%", overflowX: "auto" };
const checkboxStyle: CSSProperties = { width: "16px", height: "16px", accentColor: "var(--x-color-accent)", cursor: "pointer" };

const actionBarStyle: CSSProperties = {
  position: "fixed",
  left: "50%",
  bottom: "18px",
  transform: "translateX(-50%)",
  zIndex: 900,
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "10px 14px",
  borderRadius: "12px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 12px 32px var(--x-color-shadow)",
  flexWrap: "wrap",
  maxWidth: "calc(100% - 32px)",
};
const actionBarCountStyle: CSSProperties = { fontSize: "13px", fontWeight: 800, color: "var(--x-color-ink)" };
const actionBarBtnStyle: CSSProperties = { width: "auto", padding: "8px 16px" };

const cellStrongStyle: CSSProperties = { fontWeight: 700, lineHeight: 1.4 };
const cellSubStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", marginTop: "2px" };
const monoCellStyle: CSSProperties = { fontFamily: "var(--x-font-mono)", fontSize: "12.5px", whiteSpace: "nowrap" };
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };

const actionTripleStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" };

function detailHeaderStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: isMobile ? "stretch" : "flex-start",
    gap: "12px",
    flexWrap: "wrap",
    flexDirection: isMobile ? "column" : "row",
    padding: isMobile ? "12px" : "16px 18px",
    borderBottom: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
  };
}

const detailHeaderLeftStyle: CSSProperties = { display: "flex", gap: "12px", alignItems: "flex-start" };

function detailHeaderRightStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    width: isMobile ? "100%" : undefined,
  };
}

function detailGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))",
    gap: "8px",
  };
}

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

const proofLinkStyle: CSSProperties = {
  color: "var(--x-color-accent-strong)",
  textDecoration: "none",
  fontWeight: 700,
  wordBreak: "break-all",
};

const paymentsHeadStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const councilCellStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" };
const councilCountStyle: CSSProperties = { fontFamily: "var(--x-font-mono)", fontSize: "12.5px", fontWeight: 700 };

function approvalGridStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: "10px" };
}

const approvalCardStyle: CSSProperties = {
  padding: "14px",
  borderRadius: "10px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
  display: "grid",
  gap: "10px",
  alignContent: "start",
};

const approvalCardHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
};

const approvalCardTitleStyle: CSSProperties = { fontSize: "14px", fontWeight: 800 };

const councilProgressTrackStyle: CSSProperties = {
  height: "8px",
  borderRadius: "999px",
  background: "var(--x-color-line-soft)",
  overflow: "hidden",
};

const councilProgressFillStyle: CSSProperties = {
  height: "100%",
  borderRadius: "999px",
  background: "var(--x-color-success)",
  transition: "width 0.2s ease",
};

const signatureListStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: "10px" };

const signatureCardStyle: CSSProperties = {
  width: "132px",
  padding: "8px",
  borderRadius: "10px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  display: "grid",
  gap: "6px",
  justifyItems: "center",
};

const signaturePreviewBoxStyle: CSSProperties = {
  width: "100%",
  height: "64px",
  display: "grid",
  placeItems: "center",
  borderRadius: "6px",
  background: "#fff",
  border: "1px solid var(--x-color-line-soft)",
  overflow: "hidden",
  color: "var(--x-color-success)",
  fontWeight: 800,
};

const signatureNameStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  textAlign: "center",
  wordBreak: "break-word",
  lineHeight: 1.3,
};

const councilActionRowStyle: CSSProperties = { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" };

const editHintStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: "8px",
  background: "var(--x-color-info-soft)",
  color: "var(--x-color-info)",
  fontSize: "12.5px",
  fontWeight: 600,
};

const factHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
};

const factIconGroupStyle: CSSProperties = { display: "inline-flex", gap: "4px" };

const factIconButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "24px",
  height: "24px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink-muted)",
  cursor: "pointer",
  fontSize: "11px",
  flexShrink: 0,
};

const factInputStyle: CSSProperties = {
  width: "100%",
  padding: "7px 9px",
  borderRadius: "7px",
  border: "1px solid var(--x-color-accent-border)",
  background: "var(--x-color-panel)",
  fontSize: "13px",
  fontWeight: 600,
  boxSizing: "border-box",
};

const qrBackdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.55)",
  display: "grid",
  placeItems: "center",
  padding: "20px",
  zIndex: 1000,
};

const qrTitleStyle: CSSProperties = { fontSize: "16px", fontWeight: 800 };

const phoneShellStyle: CSSProperties = {
  position: "relative",
  width: "min(390px, 100%)",
  margin: "0 auto",
  background: "linear-gradient(160deg, #1b2432, #0b1220)",
  borderRadius: "46px",
  padding: "14px",
  boxShadow: "0 30px 60px rgba(15,23,42,0.35), inset 0 0 0 2px rgba(255,255,255,0.06)",
  boxSizing: "border-box",
};

const phoneNotchStyle: CSSProperties = {
  position: "absolute",
  top: "22px",
  left: "50%",
  transform: "translateX(-50%)",
  width: "128px",
  height: "24px",
  borderRadius: "999px",
  background: "#05070c",
  zIndex: 2,
};

const phoneScreenWrapStyle: CSSProperties = {
  borderRadius: "34px",
  overflow: "hidden",
  background: "#fff",
  border: "1px solid rgba(0,0,0,0.35)",
};

const phoneScreenStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: "min(76vh, 760px)",
  border: "none",
  background: "#fff",
};

const phoneHomeBarStyle: CSSProperties = {
  width: "120px",
  height: "5px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.5)",
  margin: "10px auto 2px",
};

const phonePreviewInnerStyle: CSSProperties = {
  width: "min(430px, 100%)",
  display: "grid",
  gap: "12px",
  maxHeight: "92vh",
};

const phonePreviewHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  color: "#fff",
};

const emptyInlineStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "8px",
  border: "1px dashed var(--x-color-line)",
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
};

function statusChipStyle(tone: "success" | "danger" | "info"): CSSProperties {
  const palette =
    tone === "success"
      ? { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" }
      : tone === "danger"
        ? { background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" }
        : { background: "var(--x-color-info-soft)", color: "var(--x-color-info)" };
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
