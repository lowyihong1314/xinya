import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";

import { useUserState } from "../../../../app/UserState";
import { showConfirmDialog } from "../../../../js/dialogs";
import { select_counterparty_modal, select_single_user_modal } from "../../../select_users_modal";
import { TablePagination, usePagedRows } from "../../../shared/TablePagination";
import {
  cancelAssetStockDocument,
  confirmAssetStockDocument,
  createAssetStockDocument,
  deleteAssetStockDocument,
  fetchAssetDashboard,
  postAssetStockDocumentToFinance,
} from "../asset/api";
import type {
  AssetDashboardPayload,
  AssetStockDocumentRecord,
  AssetSubItemRecord,
} from "../asset/types";

type SalesActionType = "sale_out" | "sale_return";
type SalesViewMode = "overview" | "form" | "detail";
type SalesTypeFilter = "all" | "sale_out" | "sale_return";

type SalesPermissionUser = {
  departments?: Array<{
    permissions?: Array<{ name?: string | null } | null> | null;
  } | null> | null;
} | null;

type SalesLineState = {
  key: string;
  itemId: string;
  subItemId: string;
  quantity: string;
  unitPrice: string;
  remark: string;
};

type SalesFormState = {
  actionType: SalesActionType;
  warehouseId: string;
  counterpartyId: string;
  counterpartyName: string;
  takenByUserId: string;
  takenByName: string;
  destinationText: string;
  note: string;
  lines: SalesLineState[];
};

type SalesItemOption = {
  id: string;
  label: string;
};

type SalesSubItemOption = {
  id: string;
  itemId: string;
  label: string;
  availableQuantity?: number;
};

const TYPE_TABS: { key: SalesTypeFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "sale_out", label: "销售出库" },
  { key: "sale_return", label: "销售退回" },
];

const INITIAL_FORM: SalesFormState = {
  actionType: "sale_out",
  warehouseId: "",
  counterpartyId: "",
  counterpartyName: "",
  takenByUserId: "",
  takenByName: "",
  destinationText: "",
  note: "",
  lines: [],
};

function createSalesLineState(itemId = "", subItemId = ""): SalesLineState {
  return {
    key: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    itemId,
    subItemId,
    quantity: "1",
    unitPrice: "",
    remark: "",
  };
}

function matchesSalesSearch(query: string, ...values: Array<string | number | null | undefined>) {
  if (!query) {
    return true;
  }
  return values.some((value) => String(value ?? "").toLowerCase().includes(query));
}

function buildSubItemOptionLabel(subItem: AssetSubItemRecord) {
  const parts = [subItem.item_name || "未命名 item", subItem.name];
  if (subItem.size) {
    parts.push(`size ${subItem.size}`);
  }
  if (subItem.color) {
    parts.push(subItem.color);
  }
  return parts.filter(Boolean).join(" · ");
}

function getSalesActionLabel(actionType: SalesActionType) {
  return actionType === "sale_out" ? "销售出库" : "销售退回";
}

function getSalesActionHint(actionType: SalesActionType) {
  return actionType === "sale_out"
    ? "从仓库可用库存里选择商品，提交后会自动确认并扣减库存。"
    : "把客户退回的商品重新入库，提交后会自动确认并回补库存。";
}

function getDocumentLabel(documentType: string) {
  return documentType === "sale_return" ? "销售退回" : documentType === "sale_out" ? "销售出库" : documentType;
}

function getDocumentWarehouse(document: AssetStockDocumentRecord) {
  if (document.document_type === "sale_return") {
    return document.target_warehouse_name || "-";
  }
  return document.source_warehouse_name || "-";
}

function getDocumentTotal(document: AssetStockDocumentRecord) {
  return (document.lines || []).reduce((sum, line) => {
    if (line.line_amount != null) {
      return sum + Number(line.line_amount || 0);
    }
    if (line.unit_price != null) {
      return sum + Number(line.unit_price || 0) * Number(line.quantity || 0);
    }
    return sum;
  }, 0);
}

function formatMoney(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function buildDefaultWarehouseId(dashboard: AssetDashboardPayload | null) {
  return dashboard?.warehouses?.[0]?.id ? String(dashboard.warehouses[0].id) : "";
}

function buildSalesItemOptions(
  dashboard: AssetDashboardPayload | null,
  actionType: SalesActionType,
  warehouseId: string,
): SalesItemOption[] {
  if (!dashboard) {
    return [] as SalesItemOption[];
  }

  if (actionType === "sale_out") {
    const itemMap = new Map<string, SalesItemOption>();
    for (const row of dashboard.inventory) {
      if (String(row.warehouse_id) !== warehouseId || Number(row.available_quantity || 0) <= 0 || row.item_id == null) {
        continue;
      }
      const itemId = String(row.item_id);
      if (!itemMap.has(itemId)) {
        itemMap.set(itemId, {
          id: itemId,
          label: `${row.item_name || "未命名 item"}${row.item_code ? ` · ${row.item_code}` : ""}`,
        });
      }
    }
    return Array.from(itemMap.values());
  }

  return (dashboard.items || []).map((item) => ({
    id: String(item.id),
    label: `${item.name}${item.code ? ` · ${item.code}` : ""}`,
  }));
}

function buildSalesSubItemOptions(
  dashboard: AssetDashboardPayload | null,
  actionType: SalesActionType,
  warehouseId: string,
  itemId: string,
): SalesSubItemOption[] {
  if (!dashboard || !itemId) {
    return [] as SalesSubItemOption[];
  }

  if (actionType === "sale_out") {
    return dashboard.inventory
      .filter(
        (row) =>
          String(row.warehouse_id) === warehouseId &&
          Number(row.available_quantity || 0) > 0 &&
          String(row.item_id || "") === itemId,
      )
      .map((row) => ({
        id: String(row.sub_item_id),
        itemId,
        label: `${row.sub_item_name || "未命名规格"}${row.size ? ` · ${row.size}` : ""}${row.color ? ` · ${row.color}` : ""} · 可用 ${row.available_quantity}`,
        availableQuantity: Number(row.available_quantity || 0),
      }));
  }

  return (dashboard.items || [])
    .filter((item) => String(item.id) === itemId)
    .flatMap((item) =>
      (item.sub_items || []).map((subItem) => ({
        id: String(subItem.id),
        itemId,
        label: buildSubItemOptionLabel(subItem),
        availableQuantity: undefined,
      })),
    );
}

function buildInitialForm(dashboard: AssetDashboardPayload | null, actionType: SalesActionType): SalesFormState {
  const warehouseId = buildDefaultWarehouseId(dashboard);
  const itemOptions = buildSalesItemOptions(dashboard, actionType, warehouseId);
  const firstItemId = itemOptions[0]?.id || "";
  const subItemOptions = buildSalesSubItemOptions(dashboard, actionType, warehouseId, firstItemId);
  return {
    ...INITIAL_FORM,
    actionType,
    warehouseId,
    lines: [createSalesLineState(firstItemId, subItemOptions[0]?.id || "")],
  };
}

export function SalesIncomeWorkspace() {
  const { user, isMobile } = useUserState();
  const permissionUser = user as SalesPermissionUser;
  const [dashboard, setDashboard] = useState<AssetDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState<SalesViewMode>("overview");
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [form, setForm] = useState<SalesFormState>(INITIAL_FORM);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<SalesTypeFilter>("all");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    if (!message && !error) {
      return;
    }
    const timer = window.setTimeout(() => {
      setMessage(null);
      setError(null);
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [message, error]);

  const permissionNames = useMemo(() => {
    const rawPermissions = (permissionUser?.departments || []).reduce<Array<{ name?: string | null } | null>>(
      (accumulator, department) => {
        if (Array.isArray(department?.permissions)) {
          accumulator.push(...department.permissions);
        }
        return accumulator;
      },
      [],
    );
    return new Set(rawPermissions.map((permission) => String(permission?.name || "")));
  }, [permissionUser]);

  const canEdit = permissionNames.has("asset_edit") || permissionNames.has("account_edit");
  const itemOptions = useMemo(
    () => buildSalesItemOptions(dashboard, form.actionType, form.warehouseId),
    [dashboard, form.actionType, form.warehouseId],
  );
  const salesOptionsByItem = useMemo(() => {
    const nextMap = new Map<string, SalesSubItemOption[]>();
    for (const item of itemOptions) {
      nextMap.set(
        item.id,
        buildSalesSubItemOptions(dashboard, form.actionType, form.warehouseId, item.id),
      );
    }
    return nextMap;
  }, [dashboard, form.actionType, form.warehouseId, itemOptions]);
  const salesInventoryMap = useMemo(() => {
    const nextMap = new Map<number, number>();
    for (const options of salesOptionsByItem.values()) {
      for (const option of options) {
        nextMap.set(Number(option.id), Number(option.availableQuantity || 0));
      }
    }
    return nextMap;
  }, [salesOptionsByItem]);

  const salesDocuments = useMemo(
    () =>
      (dashboard?.documents || []).filter(
        (document) => document.document_type === "sale_out" || document.document_type === "sale_return",
      ),
    [dashboard],
  );

  const filteredDocuments = useMemo(
    () =>
      salesDocuments
        .filter((document) => typeFilter === "all" || document.document_type === typeFilter)
        .filter((document) =>
          matchesSalesSearch(
            searchQuery.trim().toLowerCase(),
            document.document_no,
            document.counterparty_name,
            document.source_warehouse_name,
            document.target_warehouse_name,
            document.taken_by_name,
            document.destination_text,
            document.note,
            ...((document.lines || []).flatMap((line) => [line.item_name, line.sub_item_name, line.size])),
          ),
        ),
    [salesDocuments, typeFilter, searchQuery],
  );

  const { page, setPage, totalPages, total, pageRows } = usePagedRows(
    filteredDocuments,
    isMobile ? 8 : 12,
    `${typeFilter}|${searchQuery}`,
  );

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAssetDashboard();
      setDashboard(data);
      setForm((current) => {
        if (viewMode === "form") {
          return current;
        }
        return current.warehouseId ? current : buildInitialForm(data, "sale_out");
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "销售收入模块载入失败");
    } finally {
      setLoading(false);
    }
  }

  function openForm(actionType: SalesActionType) {
    setForm(buildInitialForm(dashboard, actionType));
    setViewMode("form");
  }

  function closeForm() {
    setForm(INITIAL_FORM);
    setViewMode("overview");
  }

  function openDetail(documentId: number) {
    setSelectedDocId(documentId);
    setViewMode("detail");
  }

  function closeDetail() {
    setSelectedDocId(null);
    setViewMode("overview");
  }

  async function handleConfirm(documentId: number) {
    setSubmitting(true);
    setError(null);
    try {
      await confirmAssetStockDocument(documentId);
      setMessage("销售已确认并扣减库存，可以推送到收款审核了。");
      await loadDashboard();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "确认失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePostToFinance(documentId: number) {
    setSubmitting(true);
    setError(null);
    try {
      await postAssetStockDocumentToFinance(documentId);
      setMessage("已推送到收款审核，财务可在「收款审核」里确认收款。");
      await loadDashboard();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "推送收款审核失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelDocument(documentId: number) {
    if (!(await showConfirmDialog({ message: "确认作废这笔销售单据？已确认的会回滚库存。", tone: "danger" }))) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await cancelAssetStockDocument(documentId);
      setMessage("销售单据已作废。");
      await loadDashboard();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "作废失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteDocument(documentId: number) {
    if (!(await showConfirmDialog({ message: "确认删除这个草稿单据？", tone: "danger" }))) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await deleteAssetStockDocument(documentId);
      setMessage("草稿单据已删除。");
      closeDetail();
      await loadDashboard();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除失败");
    } finally {
      setSubmitting(false);
    }
  }

  function handleWarehouseChange(warehouseId: string) {
    setForm((current) => {
      const nextItemOptions = buildSalesItemOptions(dashboard, current.actionType, warehouseId);
      const validItemIds = new Set(nextItemOptions.map((option) => option.id));
      return {
        ...current,
        warehouseId,
        lines: current.lines.length
          ? current.lines.map((line, index) => {
              const nextItemId = validItemIds.has(line.itemId) ? line.itemId : index === 0 ? nextItemOptions[0]?.id || "" : "";
              const nextSubItemOptions = buildSalesSubItemOptions(
                dashboard,
                current.actionType,
                warehouseId,
                nextItemId,
              );
              const validSubItemIds = new Set(nextSubItemOptions.map((option) => option.id));
              const nextSubItemId = validSubItemIds.has(line.subItemId)
                ? line.subItemId
                : index === 0
                  ? nextSubItemOptions[0]?.id || ""
                  : "";
              return {
                ...line,
                itemId: nextItemId,
                subItemId: nextSubItemId,
              };
            })
          : [createSalesLineState(nextItemOptions[0]?.id || "", buildSalesSubItemOptions(dashboard, current.actionType, warehouseId, nextItemOptions[0]?.id || "")[0]?.id || "")],
      };
    });
  }

  function handleLineItemChange(index: number, itemId: string) {
    setForm((current) => {
      const nextSubItemOptions = buildSalesSubItemOptions(dashboard, current.actionType, current.warehouseId, itemId);
      return {
        ...current,
        lines: current.lines.map((line, lineIndex) =>
          lineIndex === index
            ? {
                ...line,
                itemId,
                subItemId: nextSubItemOptions[0]?.id || "",
              }
            : line,
        ),
      };
    });
  }

  async function handlePickCustomer() {
    const selectedPartner = await select_counterparty_modal({
      title: "选择客户",
    });
    if (!selectedPartner) {
      return;
    }
    setForm((current) => ({
      ...current,
      counterpartyId: String(selectedPartner.id),
      counterpartyName: selectedPartner.display_name || selectedPartner.username || "",
    }));
  }

  async function handlePickTakenBy() {
    const selectedUser = await select_single_user_modal({
      title: "选择经手对象",
    });
    if (!selectedUser) {
      return;
    }
    setForm((current) => ({
      ...current,
      takenByUserId: String(selectedUser.id),
      takenByName: selectedUser.display_name || selectedUser.username || "",
    }));
  }

  function handleLineChange(index: number, key: keyof Omit<SalesLineState, "key">, value: string) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)),
    }));
  }

  function handleAddLine() {
    const defaultItemId = itemOptions[0]?.id || "";
    const defaultSubItemId = salesOptionsByItem.get(defaultItemId)?.[0]?.id || "";
    setForm((current) => ({
      ...current,
      lines: [...current.lines, createSalesLineState(defaultItemId, defaultSubItemId)],
    }));
  }

  function handleRemoveLine(index: number) {
    const defaultItemId = itemOptions[0]?.id || "";
    const defaultSubItemId = salesOptionsByItem.get(defaultItemId)?.[0]?.id || "";
    setForm((current) => ({
      ...current,
      lines:
        current.lines.length <= 1
          ? [createSalesLineState(defaultItemId, defaultSubItemId)]
          : current.lines.filter((_, lineIndex) => lineIndex !== index),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) {
      setError("你没有创建销售单据的权限");
      return;
    }
    if (!form.warehouseId) {
      setError("请先选择仓库");
      return;
    }
    if (!form.counterpartyId) {
      setError("请先选择客户");
      return;
    }

    const normalizedLines = form.lines.filter((line) => line.itemId && line.subItemId && line.quantity.trim());
    if (!normalizedLines.length) {
      setError("请至少填写一条销售明细");
      return;
    }

    if (form.actionType === "sale_out") {
      const requestedMap = new Map<number, number>();
      for (const line of normalizedLines) {
        const subItemId = Number(line.subItemId);
        const currentRequested = requestedMap.get(subItemId) || 0;
        requestedMap.set(subItemId, currentRequested + Number(line.quantity || 0));
      }
      for (const [subItemId, quantity] of requestedMap.entries()) {
        const available = salesInventoryMap.get(subItemId) || 0;
        if (quantity > available) {
          setError(`库存不足，子 Item #${subItemId} 当前可用 ${available}，不能销售 ${quantity}`);
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      await createAssetStockDocument({
        document_type: form.actionType,
        source_warehouse_id: form.actionType === "sale_out" ? Number(form.warehouseId) : null,
        target_warehouse_id: form.actionType === "sale_return" ? Number(form.warehouseId) : null,
        counterparty_id: null,
        counterparty_name: form.counterpartyName || undefined,
        taken_by_user_id: form.takenByUserId ? Number(form.takenByUserId) : null,
        taken_by_name: form.takenByName,
        destination_type: form.actionType === "sale_out" ? "customer" : "customer_return",
        destination_text: form.destinationText,
        note: form.note,
        lines: normalizedLines.map((line) => ({
          sub_item_id: Number(line.subItemId),
          quantity: Number(line.quantity),
          unit_price: line.unitPrice ? Number(line.unitPrice) : undefined,
          remark: line.remark || undefined,
        })),
      });

      setMessage("销售草稿已保存，进入详情后确认扣库存，再推送到收款审核。");
      setViewMode("overview");
      setForm(INITIAL_FORM);
      await loadDashboard();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "销售单据提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !dashboard) {
    return <div style={emptyStyle}>销售收入模块载入中…</div>;
  }

  if (!dashboard) {
    return <div style={noticeErrorStyle}>{error || "销售收入模块暂时不可用"}</div>;
  }

  return (
    <section style={panelStyle}>
      <style>{TABLE_CSS}</style>

      {message ? <div style={noticeSuccessStyle}>{message}</div> : null}
      {error ? <div style={noticeErrorStyle}>{error}</div> : null}

      <div style={toolbarStyle}>
        <div>
          <div style={eyebrowStyle}>财务 / 销售收入</div>
          <h2 style={titleStyle}>销售收入</h2>
          <div style={mutedStyle}>
            {viewMode === "form"
              ? getSalesActionHint(form.actionType)
              : viewMode === "detail"
                ? "草稿 → 确认(扣库存) → 推送到收款审核"
                : `共 ${salesDocuments.length} 笔销售单据 · 仅显示销售出库与销售退回`}
          </div>
        </div>
        <div style={rowStyle}>
          {viewMode === "overview" ? (
            <>
              <button type="button" style={btnStyle} onClick={() => void loadDashboard()} disabled={loading}>
                {loading ? "刷新中…" : "刷新"}
              </button>
              <button type="button" style={disabledBtn(primaryButtonStyle, !canEdit)} onClick={() => openForm("sale_out")} disabled={!canEdit}>
                新建销售
              </button>
              <button type="button" style={disabledBtn(btnStyle, !canEdit)} onClick={() => openForm("sale_return")} disabled={!canEdit}>
                销售退回
              </button>
            </>
          ) : (
            <button type="button" style={btnStyle} onClick={viewMode === "form" ? closeForm : closeDetail}>
              返回销售列表
            </button>
          )}
        </div>
      </div>

      {viewMode === "overview" ? (
        <>
          <div style={filterBarStyle}>
            <div style={tabBarStyle}>
              {TYPE_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  style={tab.key === typeFilter ? tabActiveStyle : tabStyle}
                  onClick={() => setTypeFilter(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索单号 / 客户 / 仓库 / 经手 / item / size"
              style={searchInputStyle}
            />
          </div>

          {!salesDocuments.length ? (
            <div style={emptyStyle}>还没有销售记录。</div>
          ) : !filteredDocuments.length ? (
            <div style={emptyStyle}>没有匹配的销售记录。</div>
          ) : (
            <div style={{ display: "grid", gap: "8px", padding: "12px 14px 14px" }}>
              <TablePagination page={page} totalPages={totalPages} total={total} onPage={setPage} />

              <div style={tableWrapStyle}>
                <table className="sales-table">
                  <thead>
                    <tr>
                      <th>单号</th>
                      <th>类型</th>
                      <th>状态</th>
                      <th>客户</th>
                      <th>仓库</th>
                      <th>经手</th>
                      <th>明细</th>
                      <th style={{ textAlign: "right" }}>金额</th>
                      <th>日期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((document) => {
                      const totalAmount = getDocumentTotal(document);
                      return (
                        <tr key={document.id} className="sales-row" style={{ cursor: "pointer" }} onClick={() => openDetail(document.id)}>
                          <td style={monoCellStyle}>{document.document_no}</td>
                          <td>
                            <span style={typeChipStyle(document.document_type)}>{getDocumentLabel(document.document_type)}</span>
                          </td>
                          <td>
                            <span style={statusChipStyle(document.status)}>{document.status}</span>
                          </td>
                          <td style={cellStrongStyle}>{document.counterparty_name || "—"}</td>
                          <td>{getDocumentWarehouse(document)}</td>
                          <td>{document.taken_by_name || "—"}</td>
                          <td>
                            {(document.lines || []).length ? (
                              <div style={lineWrapStyle}>
                                {(document.lines || []).map((line) => (
                                  <span key={line.id} style={lineChipStyle}>
                                    {line.item_name || "未命名 item"}
                                    {line.size ? ` · ${line.size}` : ""}
                                    {` · ${line.quantity}件`}
                                    {line.unit_price != null ? ` · RM ${line.unit_price}` : ""}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span style={mutedStyle}>—</span>
                            )}
                          </td>
                          <td style={{ ...cellStrongStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                            {totalAmount > 0 ? `RM ${formatMoney(totalAmount)}` : "—"}
                          </td>
                          <td style={monoCellStyle}>{formatDateTime(document.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : viewMode === "detail" ? (
        (() => {
          const doc =
            salesDocuments.find((d) => d.id === selectedDocId) ||
            (dashboard?.documents || []).find((d) => d.id === selectedDocId) ||
            null;
          if (!doc) {
            return <div style={emptyStyle}>找不到这个销售单据，可能已被删除。</div>;
          }
          const total = getDocumentTotal(doc);
          const posted = Boolean(doc.finance_payment_status);
          const financeLabel =
            doc.finance_payment_status === "checked"
              ? "已确认收款"
              : doc.finance_payment_status === "fail"
                ? "收款失败"
                : "收款审核中";
          return (
            <div style={{ display: "grid", gap: "14px", padding: "14px" }}>
              <div style={editorHeaderCardStyle}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={monoCellStyle}>{doc.document_no}</span>
                  <span style={typeChipStyle(doc.document_type)}>{getDocumentLabel(doc.document_type)}</span>
                  <span style={statusChipStyle(doc.status)}>{doc.status}</span>
                  {posted ? <span style={financeChipStyle(doc.finance_payment_status)}>{financeLabel}</span> : null}
                </div>
                <div style={{ ...mutedStyle, marginTop: "8px" }}>
                  客户 {doc.counterparty_name || "—"} · 仓库 {getDocumentWarehouse(doc)} · 经手 {doc.taken_by_name || "—"} ·
                  金额 {total > 0 ? `RM ${formatMoney(total)}` : "—"} · {formatDateTime(doc.created_at)}
                </div>
                {doc.note ? <div style={{ ...mutedStyle, marginTop: "4px", whiteSpace: "pre-wrap" }}>备注：{doc.note}</div> : null}
              </div>

              {canEdit ? (
                <div style={rowStyle}>
                  {doc.status === "draft" ? (
                    <>
                      <button type="button" style={disabledBtn(primaryButtonStyle, submitting)} disabled={submitting} onClick={() => void handleConfirm(doc.id)}>
                        确认（扣库存）
                      </button>
                      <button type="button" style={disabledBtn(dangerButtonStyle, submitting)} disabled={submitting} onClick={() => void handleDeleteDocument(doc.id)}>
                        删除草稿
                      </button>
                    </>
                  ) : null}
                  {doc.status === "confirmed" && !posted ? (
                    <>
                      <button type="button" style={disabledBtn(primaryButtonStyle, submitting)} disabled={submitting} onClick={() => void handlePostToFinance(doc.id)}>
                        POST 到收款审核
                      </button>
                      <button type="button" style={disabledBtn(dangerButtonStyle, submitting)} disabled={submitting} onClick={() => void handleCancelDocument(doc.id)}>
                        作废（回滚库存）
                      </button>
                    </>
                  ) : null}
                  {doc.status === "confirmed" && posted ? (
                    <>
                      <span style={mutedStyle}>已推送到收款审核，请到「财务 · 收款审核」确认收款。</span>
                      <button type="button" style={disabledBtn(dangerButtonStyle, submitting)} disabled={submitting} onClick={() => void handleCancelDocument(doc.id)}>
                        作废（回滚库存）
                      </button>
                    </>
                  ) : null}
                  {doc.status === "cancelled" ? <span style={mutedStyle}>单据已作废。</span> : null}
                </div>
              ) : null}

              <div style={tableWrapStyle}>
                <table className="sales-table">
                  <thead>
                    <tr>
                      <th>项目</th>
                      <th>规格</th>
                      <th style={{ textAlign: "right" }}>数量</th>
                      <th style={{ textAlign: "right" }}>单价</th>
                      <th style={{ textAlign: "right" }}>金额</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(doc.lines || []).map((line) => (
                      <tr key={line.id}>
                        <td style={cellStrongStyle}>{line.item_name || "未命名 item"}</td>
                        <td>{line.size || "—"}</td>
                        <td style={{ textAlign: "right" }}>{line.quantity}</td>
                        <td style={{ textAlign: "right" }}>{line.unit_price != null ? `RM ${line.unit_price}` : "—"}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{line.line_amount != null ? `RM ${formatMoney(Number(line.line_amount))}` : "—"}</td>
                        <td>{line.remark || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()
      ) : (
        <form onSubmit={handleSubmit} style={formStyle}>
          <div style={editorHeaderCardStyle}>
            <div style={sectionTitleStyle}>{getSalesActionLabel(form.actionType)}</div>
            <div style={mutedStyle}>{getSalesActionHint(form.actionType)}</div>
          </div>

          <div style={fieldGridStyle(isMobile)}>
            <select style={inputStyle} value={form.warehouseId} onChange={(event) => handleWarehouseChange(event.target.value)}>
              <option value="">选择仓库</option>
              {dashboard.warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
            <div style={pickerBlockStyle}>
              <div style={pickerCopyStyle}>
                <div style={pickerLabelStyle}>客户</div>
                <div style={pickerValueStyle}>{form.counterpartyName || "暂未选择客户"}</div>
              </div>
              <div style={formActionRowStyle}>
                <button type="button" style={btnStyle} onClick={() => void handlePickCustomer()} disabled={!canEdit || submitting}>
                  选择客户
                </button>
                {form.counterpartyId ? (
                  <button
                    type="button"
                    style={ghostButtonStyle}
                    onClick={() => setForm((current) => ({ ...current, counterpartyId: "", counterpartyName: "" }))}
                    disabled={!canEdit || submitting}
                  >
                    清除
                  </button>
                ) : null}
              </div>
            </div>
            <div style={pickerBlockStyle}>
              <div style={pickerCopyStyle}>
                <div style={pickerLabelStyle}>经手对象</div>
                <div style={pickerValueStyle}>{form.takenByName || "暂未选择经手对象"}</div>
              </div>
              <div style={formActionRowStyle}>
                <button type="button" style={btnStyle} onClick={() => void handlePickTakenBy()} disabled={!canEdit || submitting}>
                  选择经手对象
                </button>
                {form.takenByUserId || form.takenByName ? (
                  <button
                    type="button"
                    style={ghostButtonStyle}
                    onClick={() => setForm((current) => ({ ...current, takenByUserId: "", takenByName: "" }))}
                    disabled={!canEdit || submitting}
                  >
                    清除
                  </button>
                ) : null}
              </div>
            </div>
            <input
              style={inputStyle}
              placeholder="去向 / 地址"
              value={form.destinationText}
              onChange={(event) => setForm((current) => ({ ...current, destinationText: event.target.value }))}
            />
          </div>

          <div style={lineEditorStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <div style={sectionTitleStyle}>销售明细</div>
                <div style={mutedStyle}>
                  {form.actionType === "sale_out"
                    ? "先选 Item，再选当前仓库可销售的子 Item / size。"
                    : "先选 Item，再选对应的子 Item / size 做退回。"}
                </div>
              </div>
              <button type="button" style={btnStyle} onClick={handleAddLine} disabled={!canEdit || submitting}>
                新增一行
              </button>
            </div>

            {!itemOptions.length ? (
              <div style={placeholderSubtleStyle}>
                {form.actionType === "sale_out"
                  ? "当前仓库没有可销售 item，请先切换仓库或先做入库。"
                  : "还没有可选 item，请先去资产库存建立 Item / 子 Item。"}
              </div>
            ) : null}

            <div style={lineListStyle}>
              {form.lines.map((line, index) => (
                <div key={line.key} style={lineCardStyle}>
                  <div style={sectionHeaderStyle}>
                    <div style={sectionTitleStyle}>明细 #{index + 1}</div>
                    <button type="button" style={ghostButtonStyle} onClick={() => handleRemoveLine(index)} disabled={!canEdit || submitting}>
                      删除
                    </button>
                  </div>
                  <div style={fieldGridStyle(isMobile)}>
                    <select style={inputStyle} value={line.itemId} onChange={(event) => handleLineItemChange(index, event.target.value)}>
                      <option value="">选择 Item</option>
                      {itemOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <select style={inputStyle} value={line.subItemId} onChange={(event) => handleLineChange(index, "subItemId", event.target.value)}>
                      <option value="">选择规格</option>
                      {(salesOptionsByItem.get(line.itemId) || []).map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <input style={inputStyle} placeholder="数量" value={line.quantity} onChange={(event) => handleLineChange(index, "quantity", event.target.value)} />
                    <input style={inputStyle} placeholder="销售单价" value={line.unitPrice} onChange={(event) => handleLineChange(index, "unitPrice", event.target.value)} />
                    <input
                      style={{ ...inputStyle, gridColumn: isMobile ? "auto" : "1 / -1" }}
                      placeholder="备注"
                      value={line.remark}
                      onChange={(event) => handleLineChange(index, "remark", event.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <textarea
            style={textareaStyle}
            placeholder="备注"
            value={form.note}
            onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
          />

          <div style={formActionRowStyle}>
            <button type="submit" style={disabledBtn(primaryButtonStyle, !canEdit || submitting)} disabled={!canEdit || submitting}>
              {submitting ? "提交中…" : form.actionType === "sale_out" ? "确认销售并扣减库存" : "确认退回并回补库存"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function disabledBtn(style: CSSProperties, disabled: boolean): CSSProperties {
  return disabled ? { ...style, opacity: 0.5, cursor: "not-allowed" } : style;
}

const TABLE_CSS = `
.sales-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 960px; }
.sales-table thead th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; padding: 9px 12px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--x-color-ink-muted); background: var(--x-color-canvas-alt);
  border-bottom: 1px solid var(--x-color-line); white-space: nowrap;
}
.sales-table tbody td { padding: 10px 12px; border-bottom: 1px solid var(--x-color-line-soft); vertical-align: middle; color: var(--x-color-ink); }
.sales-table tbody tr.sales-row:hover td { background: var(--x-color-accent-tint); }
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
const titleStyle: CSSProperties = { margin: "2px 0", fontSize: "18px", fontWeight: 800, color: "var(--x-color-ink)" };
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", lineHeight: 1.5 };
const rowStyle: CSSProperties = { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" };

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
const ghostButtonStyle: CSSProperties = {
  padding: "7px 12px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  fontWeight: 600,
  fontSize: "12px",
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

const lineWrapStyle: CSSProperties = { display: "flex", gap: "4px", flexWrap: "wrap", maxWidth: "320px" };
const lineChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "6px",
  fontSize: "11px",
  fontWeight: 600,
  whiteSpace: "nowrap",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
};

function typeChipStyle(documentType: string): CSSProperties {
  const isReturn = documentType === "sale_return";
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 700,
    whiteSpace: "nowrap",
    background: isReturn ? "var(--x-color-warning-soft)" : "var(--x-color-accent-tint)",
    color: isReturn ? "var(--x-color-warning)" : "var(--x-color-accent-strong)",
  };
}

function statusChipStyle(status: string): CSSProperties {
  const palette =
    status === "confirmed"
      ? { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" }
      : status === "draft"
        ? { background: "var(--x-color-info-soft)", color: "var(--x-color-info)" }
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

function financeChipStyle(status?: string | null): CSSProperties {
  const palette =
    status === "checked"
      ? { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" }
      : status === "fail"
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

const noticeSuccessStyle: CSSProperties = {
  margin: "12px 14px 0",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-success-strong)",
  background: "var(--x-color-success-soft)",
  color: "var(--x-color-success)",
  fontWeight: 700,
  fontSize: "13px",
};

const noticeErrorStyle: CSSProperties = {
  margin: "12px 14px 0",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-warning-border)",
  background: "var(--x-color-warning-soft)",
  color: "var(--x-color-warning)",
  fontWeight: 700,
  fontSize: "13px",
};

const formStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
  padding: "14px",
};

const editorHeaderCardStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  padding: "10px 12px",
  borderRadius: "8px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
};

const sectionTitleStyle: CSSProperties = { fontSize: "14px", fontWeight: 700, color: "var(--x-color-accent-strong)" };

function fieldGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: "8px",
  };
}

const inputStyle: CSSProperties = {
  width: "100%",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  minHeight: "34px",
  padding: "7px 10px",
  fontSize: "13px",
  outline: "none",
  boxSizing: "border-box",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "88px",
  resize: "vertical",
};

const pickerBlockStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
};

const pickerCopyStyle: CSSProperties = { display: "grid", gap: "4px" };
const pickerLabelStyle: CSSProperties = { fontSize: "12px", fontWeight: 700, color: "var(--x-color-ink-muted)" };
const pickerValueStyle: CSSProperties = { fontSize: "14px", fontWeight: 700, color: "var(--x-color-ink)" };

const lineEditorStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  padding: "12px",
  borderRadius: "8px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "6px",
  flexWrap: "wrap",
};

const lineListStyle: CSSProperties = { display: "grid", gap: "8px" };

const lineCardStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  padding: "10px 12px",
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line-soft)",
};

const formActionRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  alignItems: "center",
};

const placeholderSubtleStyle: CSSProperties = {
  padding: "12px",
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  border: "1px dashed var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
};
