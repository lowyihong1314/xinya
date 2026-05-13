import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";

import { useUserState } from "../../../../app/UserState";
import { designTokens } from "../../../../theme/designTokens";
import { select_counterparty_modal, select_single_user_modal } from "../../../select_users_modal";
import {
  confirmAssetStockDocument,
  createAssetStockDocument,
  deleteAssetStockDocument,
  fetchAssetDashboard,
} from "../asset/api";
import type {
  AssetDashboardPayload,
  AssetSubItemRecord,
} from "../asset/types";

type SalesActionType = "sale_out" | "sale_return";
type SalesViewMode = "overview" | "form";

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

const colors = designTokens.colors;
const radius = designTokens.radius;

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
  const [form, setForm] = useState<SalesFormState>(INITIAL_FORM);
  const [searchQuery, setSearchQuery] = useState("");
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
  const filteredDocuments = useMemo(
    () =>
      (dashboard?.documents || [])
        .filter(
          (document) =>
            document.document_type === "sale_out" || document.document_type === "sale_return",
        )
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
    [dashboard, searchQuery],
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
      const created = await createAssetStockDocument({
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

      try {
        await confirmAssetStockDocument(created.id);
      } catch (nextError) {
        try {
          await deleteAssetStockDocument(created.id);
          throw new Error(
            `${nextError instanceof Error ? nextError.message : "销售单据确认失败"}，系统已自动清掉 draft 单据`,
          );
        } catch (cleanupError) {
          throw cleanupError instanceof Error
            ? cleanupError
            : new Error("销售单据确认失败，请到资产库存里检查 draft 单据");
        }
      }

      setMessage(form.actionType === "sale_out" ? "销售记录已入账并扣减库存" : "销售退回已入账并回补库存");
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
    return <div className="sales-income sales-income--loading" style={placeholderStyle}>销售收入模块载入中…</div>;
  }

  if (!dashboard) {
    return <div className="sales-income sales-income--error" style={errorStyle}>{error || "销售收入模块暂时不可用"}</div>;
  }

  return (
    <div className="sales-income" style={workspaceStyle}>
      {message ? <div className="sales-income__alert sales-income__alert--success" style={successStyle}>{message}</div> : null}
      {error ? <div className="sales-income__alert sales-income__alert--error" style={errorStyle}>{error}</div> : null}

      <section className="sales-income__panel sales-income__panel--editor" style={panelStyle}>
        <div className="sales-income__panel-header" style={panelHeaderStyle(isMobile)}>
          <div className="sales-income__panel-copy" style={panelCopyStyle}>
            <div className="sales-income__panel-title" style={panelTitleStyle}>销售收入</div>
            <div className="sales-income__panel-hint" style={panelHintStyle}>
              直接从仓库库存选择商品销售，或把客户退货重新入库。
            </div>
          </div>
          {viewMode === "form" ? (
            <button className="sales-income__button sales-income__button--secondary" type="button" style={secondaryButtonStyle} onClick={closeForm}>
              返回销售列表
            </button>
          ) : null}
        </div>

        {viewMode === "overview" ? (
          <div className="sales-income__overview" style={overviewStyle}>
            <div className="sales-income__action-grid" style={actionGridStyle(isMobile)}>
              <button
                className="sales-income__action-card sales-income__action-card--sale"
                type="button"
                style={actionCardStyle}
                onClick={() => openForm("sale_out")}
                disabled={!canEdit}
              >
                <div style={actionTitleStyle}>新建销售</div>
                <div style={actionHintStyle}>选择仓库现有库存，提交后自动生成卖出记录并扣减库存。</div>
              </button>
              <button
                className="sales-income__action-card sales-income__action-card--return"
                type="button"
                style={actionCardStyle}
                onClick={() => openForm("sale_return")}
                disabled={!canEdit}
              >
                <div style={actionTitleStyle}>销售退回</div>
                <div style={actionHintStyle}>把客户退回的商品重新入库，系统自动写回退回记录。</div>
              </button>
            </div>

            <div className="sales-income__list-block" style={listBlockStyle}>
              <div className="sales-income__toolbar" style={toolbarStyle(isMobile)}>
                <div>
                  <div style={sectionTitleStyle}>最近销售记录</div>
                  <div style={panelHintStyle}>这里只显示销售出库和销售退回产生的库存单据。</div>
                </div>
                <input
                  className="sales-income__search-input"
                  style={inputStyle}
                  placeholder="搜索单号 / 客户 / 仓库 / item / size"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>

              <div className="sales-income__document-list" style={documentListStyle}>
                {filteredDocuments.map((document) => (
                  <article key={document.id} className="sales-income__document-card" style={documentCardStyle}>
                    <div style={documentHeaderStyle}>
                      <div>
                        <div style={documentNoStyle}>{document.document_no}</div>
                        <div style={documentMetaStyle}>
                          {getDocumentLabel(document.document_type)} · {document.status}
                          {document.source_warehouse_name ? ` · 出自 ${document.source_warehouse_name}` : ""}
                          {document.target_warehouse_name ? ` · 入到 ${document.target_warehouse_name}` : ""}
                        </div>
                      </div>
                      <div style={statusChipStyle(document.status)}>{document.status}</div>
                    </div>
                    <div style={documentMetaStyle}>
                      {document.counterparty_name ? `客户：${document.counterparty_name}` : "未选择客户"}
                      {document.destination_text ? ` · 去向：${document.destination_text}` : ""}
                    </div>
                    <div style={documentMetaStyle}>
                      {document.taken_by_name ? `经手：${document.taken_by_name}` : "未填写经手人"} · {formatDateTime(document.created_at)}
                    </div>
                    <div style={lineWrapStyle}>
                      {(document.lines || []).map((line) => (
                        <div key={line.id} style={lineChipStyle}>
                          {line.item_name || "未命名 item"}
                          {line.size ? ` · ${line.size}` : ""}
                          {` · ${line.quantity} 件`}
                          {line.unit_price != null ? ` · RM ${line.unit_price}` : ""}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
                {!dashboard.documents.some((document) => document.document_type === "sale_out" || document.document_type === "sale_return") ? (
                  <div style={placeholderSubtleStyle}>还没有销售记录。</div>
                ) : null}
                {dashboard.documents.some((document) => document.document_type === "sale_out" || document.document_type === "sale_return") && !filteredDocuments.length ? (
                  <div style={placeholderSubtleStyle}>没有匹配的销售记录。</div>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <form className="sales-income__form" onSubmit={handleSubmit} style={formStyle}>
            <div style={editorHeaderCardStyle}>
              <div style={sectionTitleStyle}>{getSalesActionLabel(form.actionType)}</div>
              <div style={panelHintStyle}>{getSalesActionHint(form.actionType)}</div>
            </div>

            <div className="sales-income__field-grid" style={fieldGridStyle(isMobile)}>
              <select
                className="sales-income__field sales-income__field--warehouse"
                style={inputStyle}
                value={form.warehouseId}
                onChange={(event) => handleWarehouseChange(event.target.value)}
              >
                <option value="">选择仓库</option>
                {dashboard.warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
              <div className="sales-income__picker sales-income__picker--customer" style={pickerBlockStyle}>
                <div style={pickerCopyStyle}>
                  <div style={pickerLabelStyle}>客户</div>
                  <div style={pickerValueStyle}>
                    {form.counterpartyName || "暂未选择客户"}
                  </div>
                </div>
                <div style={formActionRowStyle}>
                  <button
                    className="sales-income__button sales-income__button--secondary"
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => void handlePickCustomer()}
                    disabled={!canEdit || submitting}
                  >
                    选择客户
                  </button>
                  {form.counterpartyId ? (
                    <button
                      className="sales-income__button sales-income__button--ghost"
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
              <div className="sales-income__picker sales-income__picker--taken-by" style={pickerBlockStyle}>
                <div style={pickerCopyStyle}>
                  <div style={pickerLabelStyle}>经手对象</div>
                  <div style={pickerValueStyle}>{form.takenByName || "暂未选择经手对象"}</div>
                </div>
                <div style={formActionRowStyle}>
                  <button
                    className="sales-income__button sales-income__button--secondary"
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => void handlePickTakenBy()}
                    disabled={!canEdit || submitting}
                  >
                    选择经手对象
                  </button>
                  {form.takenByUserId || form.takenByName ? (
                    <button
                      className="sales-income__button sales-income__button--ghost"
                      type="button"
                      style={ghostButtonStyle}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          takenByUserId: "",
                          takenByName: "",
                        }))
                      }
                      disabled={!canEdit || submitting}
                    >
                      清除
                    </button>
                  ) : null}
                </div>
              </div>
              <input
                className="sales-income__field sales-income__field--destination"
                style={inputStyle}
                placeholder="去向 / 地址"
                value={form.destinationText}
                onChange={(event) => setForm((current) => ({ ...current, destinationText: event.target.value }))}
              />
            </div>

            <div className="sales-income__line-editor" style={lineEditorStyle}>
              <div style={sectionHeaderStyle}>
                <div>
                  <div style={sectionTitleStyle}>销售明细</div>
                  <div style={panelHintStyle}>
                    {form.actionType === "sale_out"
                      ? "先选 Item，再选当前仓库可销售的子 Item / size。"
                      : "先选 Item，再选对应的子 Item / size 做退回。"}
                  </div>
                </div>
                <button
                  className="sales-income__button sales-income__button--secondary"
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={handleAddLine}
                  disabled={!canEdit || submitting}
                >
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
                  <div key={line.key} className="sales-income__line-card" style={lineCardStyle}>
                    <div style={sectionHeaderStyle}>
                      <div style={sectionTitleStyle}>明细 #{index + 1}</div>
                      <button
                        className="sales-income__button sales-income__button--ghost"
                        type="button"
                        style={ghostButtonStyle}
                        onClick={() => handleRemoveLine(index)}
                        disabled={!canEdit || submitting}
                      >
                        删除
                      </button>
                    </div>
                    <div style={fieldGridStyle(isMobile)}>
                      <select
                        className="sales-income__field sales-income__field--item"
                        style={inputStyle}
                        value={line.itemId}
                        onChange={(event) => handleLineItemChange(index, event.target.value)}
                      >
                        <option value="">选择 Item</option>
                        {itemOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className="sales-income__field sales-income__field--sub-item"
                        style={inputStyle}
                        value={line.subItemId}
                        onChange={(event) => handleLineChange(index, "subItemId", event.target.value)}
                      >
                        <option value="">选择规格</option>
                        {(salesOptionsByItem.get(line.itemId) || []).map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <input
                        className="sales-income__field sales-income__field--quantity"
                        style={inputStyle}
                        placeholder="数量"
                        value={line.quantity}
                        onChange={(event) => handleLineChange(index, "quantity", event.target.value)}
                      />
                      <input
                        className="sales-income__field sales-income__field--unit-price"
                        style={inputStyle}
                        placeholder="销售单价"
                        value={line.unitPrice}
                        onChange={(event) => handleLineChange(index, "unitPrice", event.target.value)}
                      />
                      <input
                        className="sales-income__field sales-income__field--remark"
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
              className="sales-income__textarea sales-income__textarea--note"
              style={textareaStyle}
              placeholder="备注"
              value={form.note}
              onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
            />

            <div style={formActionRowStyle}>
              <button
                className="sales-income__button sales-income__button--primary"
                type="submit"
                style={primaryButtonStyle}
                disabled={!canEdit || submitting}
              >
                {submitting ? "提交中…" : form.actionType === "sale_out" ? "确认销售并扣减库存" : "确认退回并回补库存"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

const workspaceStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
  height: "100%",
  overflowY: "auto",
  paddingRight: "2px",
};

const panelStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
  padding: "10px",
  borderRadius: radius.sm,
  background: colors.panelStrong,
  border: `1px solid ${colors.lineSoft}`,
  boxShadow: "none",
};

function panelHeaderStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto",
    gap: "8px",
    alignItems: "center",
  };
}

const panelCopyStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

const panelTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 700,
  color: colors.ink,
};

const panelHintStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.6,
  color: colors.inkMuted,
};

const overviewStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

function actionGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: "8px",
  };
}

const actionCardStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  textAlign: "left",
  padding: "10px",
  borderRadius: radius.sm,
  border: `1px solid ${colors.accentBorder}`,
  background: `linear-gradient(145deg, ${colors.panel}, ${colors.accentTint})`,
  color: colors.ink,
  cursor: "pointer",
};

const actionTitleStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: colors.accentStrong,
};

const actionHintStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.6,
  color: colors.inkMuted,
};

const listBlockStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

function toolbarStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(280px, 360px)",
    gap: "8px",
    alignItems: "center",
  };
}

const sectionTitleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: colors.accentStrong,
};

const documentListStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const documentCardStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  padding: "8px 10px",
  borderRadius: radius.sm,
  border: `1px solid ${colors.lineSoft}`,
  background: colors.panelAlt,
};

const documentHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "10px",
};

const documentNoStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: colors.ink,
};

const documentMetaStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.6,
  color: colors.inkMuted,
};

function statusChipStyle(status: string): CSSProperties {
  const palette =
    status === "confirmed"
      ? { background: colors.successSoft, color: colors.success, border: colors.successStrong }
      : status === "draft"
        ? { background: colors.infoSoft, color: colors.info, border: colors.infoTintStrong }
        : { background: colors.warningSoft, color: colors.warning, border: colors.warningBorder };
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "4px 7px",
    borderRadius: "999px",
    border: `1px solid ${palette.border}`,
    background: palette.background,
    color: palette.color,
    fontSize: "12px",
    fontWeight: 700,
    whiteSpace: "nowrap",
  };
}

const lineWrapStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
};

const lineChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 7px",
  borderRadius: "999px",
  background: colors.panel,
  border: `1px solid ${colors.lineSoft}`,
  fontSize: "12px",
  color: colors.inkMuted,
};

const formStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const editorHeaderCardStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  padding: "8px 10px",
  borderRadius: radius.sm,
  background: colors.panelAlt,
  border: `1px solid ${colors.lineSoft}`,
};

function fieldGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: "8px",
  };
}

const inputStyle: CSSProperties = {
  width: "100%",
  borderRadius: radius.sm,
  border: `1px solid ${colors.line}`,
  background: colors.panel,
  color: colors.ink,
  minHeight: "32px",
  padding: "6px 8px",
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
  borderRadius: radius.sm,
  border: `1px solid ${colors.lineSoft}`,
  background: colors.panel,
};

const pickerCopyStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const pickerLabelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  color: colors.inkMuted,
};

const pickerValueStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: colors.ink,
};

const lineEditorStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  padding: "10px",
  borderRadius: radius.sm,
  background: colors.panelAlt,
  border: `1px solid ${colors.lineSoft}`,
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "6px",
  flexWrap: "wrap",
};

const lineListStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const lineCardStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  padding: "8px 10px",
  borderRadius: radius.sm,
  background: colors.panel,
  border: `1px solid ${colors.lineSoft}`,
};

const formActionRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
  alignItems: "center",
};

const primaryButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: radius.sm,
  background: `linear-gradient(135deg, ${colors.accent}, ${colors.accentStrong})`,
  color: colors.panel,
  padding: "7px 10px",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "13px",
};

const secondaryButtonStyle: CSSProperties = {
  border: `1px solid ${colors.accentBorder}`,
  borderRadius: radius.sm,
  background: colors.panel,
  color: colors.accentStrong,
  padding: "7px 10px",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "13px",
};

const ghostButtonStyle: CSSProperties = {
  border: `1px solid ${colors.lineSoft}`,
  borderRadius: radius.sm,
  background: colors.panelStrong,
  color: colors.inkMuted,
  padding: "6px 8px",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "12px",
};

const successStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: radius.sm,
  border: `1px solid ${colors.successStrong}`,
  background: colors.successSoft,
  color: colors.success,
  fontWeight: 700,
};

const errorStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: radius.sm,
  border: `1px solid ${colors.warningBorder}`,
  background: colors.warningSoft,
  color: colors.warning,
  fontWeight: 700,
};

const placeholderStyle: CSSProperties = {
  padding: "14px",
  borderRadius: radius.sm,
  background: colors.panelStrong,
  border: `1px solid ${colors.lineSoft}`,
  color: colors.inkMuted,
};

const placeholderSubtleStyle: CSSProperties = {
  padding: "10px",
  borderRadius: radius.sm,
  background: colors.panelAlt,
  border: `1px dashed ${colors.lineSoft}`,
  color: colors.inkMuted,
  fontSize: "13px",
};
