import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { useUserState } from "../../../../app/UserState";
import { openPreviewModal } from "../../../../js/attachment_preview";
import { downloadBlobOrShare } from "../../../../js/browserActions";
import { showConfirmDialog } from "../../../../js/dialogs";
import { designTokens } from "../../../../theme/designTokens";
import { select_counterparty_modal, select_single_user_modal } from "../../../select_users_modal";
import { showClaimPicker } from "../../../shared/showClaimPicker";
import {
  cancelAssetStockDocument,
  confirmAssetStockDocument,
  createAssetItem,
  createAssetPartner,
  createAssetStockDocument,
  createAssetSubItem,
  createAssetWarehouse,
  deleteAssetItem,
  deleteAssetPartner,
  deleteAssetStockDocument,
  deleteAssetSubItem,
  deleteAssetWarehouse,
  fetchAssetDocumentsData,
  fetchAssetInventoryData,
  fetchAssetMasterData,
  fetchAssetMovementsData,
  updateAssetItem,
  updateAssetInventoryThreshold,
  updateAssetPartner,
  updateAssetStockDocument,
  updateAssetSubItem,
  updateAssetWarehouse,
  uploadAssetDocumentInvoice,
} from "./api";
import type {
  AssetDashboardPayload,
  AssetItemRecord,
  AssetPartnerRecord,
  AssetStockDocumentRecord,
  AssetSubItemRecord,
  AssetWarehouseRecord,
} from "./types";

type WarehouseFormState = {
  name: string;
  code: string;
  location: string;
};

type ItemFormState = {
  name: string;
  code: string;
  category: string;
  unit: string;
};

type PartnerFormState = {
  name: string;
  code: string;
  partnerType: "supplier" | "customer" | "both";
  contactPerson: string;
  phone: string;
  address: string;
};

type SubItemFormState = {
  itemId: string;
  name: string;
  sku: string;
  size: string;
  color: string;
};

type DocumentFormState = {
  documentType:
    | "purchase_in"
    | "manual_in"
    | "issue_out"
    | "transfer"
    | "sale_out"
    | "sale_return"
    | "adjust";
  sourceWarehouseId: string;
  targetWarehouseId: string;
  counterpartyId: string;
  takenByUserId: string;
  takenByName: string;
  destinationText: string;
  counterpartyName: string;
  referenceClaimId: string;
  invoiceNo: string;
  note: string;
  lines: DocumentLineState[];
};

type DocumentLineState = {
  key: string;
  subItemId: string;
  quantity: string;
  unitPrice: string;
  unitCost: string;
  remark: string;
};

type ItemSummaryRow = {
  itemId: number;
  itemName: string;
  itemCode: string;
  totalAvailable: number;
  totalReserved: number;
  warehouseCount: number;
  subItemCount: number;
  lowStockCount: number;
};

type MovementSummaryRow = {
  id: number;
  documentId: number;
  documentNo: string;
  documentType: string;
  movementType: string;
  documentStatus: string;
  warehouseName: string;
  itemName: string;
  subItemName: string;
  quantityDelta: number;
  quantityAfter: number;
  takenByName?: string | null;
  destinationText?: string | null;
  invoiceNo?: string | null;
  createdAt?: string | null;
};

type MasterEditorMode = "overview" | "warehouse" | "item" | "partner" | "sub_item";
type DocumentEditorMode = "overview" | "form";
type AssetPanelKey = "master" | "documents" | "inventory" | "low_stock" | "item_summary" | "movements";
type AssetDataKey = "master" | "documents" | "inventory" | "movements";

type AssetPermissionUser = {
  departments?: Array<{
    permissions?: Array<{ name?: string | null } | null> | null;
  } | null> | null;
} | null;

const INITIAL_WAREHOUSE_FORM: WarehouseFormState = {
  name: "",
  code: "",
  location: "",
};

const INITIAL_ITEM_FORM: ItemFormState = {
  name: "",
  code: "",
  category: "",
  unit: "件",
};

const INITIAL_PARTNER_FORM: PartnerFormState = {
  name: "",
  code: "",
  partnerType: "both",
  contactPerson: "",
  phone: "",
  address: "",
};

const INITIAL_SUB_ITEM_FORM: SubItemFormState = {
  itemId: "",
  name: "",
  sku: "",
  size: "",
  color: "",
};

const INITIAL_COLLAPSED_SECTIONS: Record<AssetPanelKey, boolean> = {
  master: false,
  documents: true,
  inventory: true,
  low_stock: true,
  item_summary: true,
  movements: true,
};

const ASSET_PANEL_KEYS: AssetPanelKey[] = ["master", "documents", "inventory", "low_stock", "item_summary", "movements"];

function resolveAssetPanelKey(value: string | null): AssetPanelKey {
  return ASSET_PANEL_KEYS.includes(value as AssetPanelKey) ? (value as AssetPanelKey) : "master";
}

const ASSET_PANEL_DATA_KEY: Record<AssetPanelKey, AssetDataKey> = {
  master: "master",
  documents: "documents",
  inventory: "inventory",
  low_stock: "inventory",
  item_summary: "inventory",
  movements: "movements",
};

const INITIAL_ASSET_DATA_LOADED: Record<AssetDataKey, boolean> = {
  master: false,
  documents: false,
  inventory: false,
  movements: false,
};

const EMPTY_ASSET_DASHBOARD: AssetDashboardPayload = {
  metrics: {
    warehouse_count: 0,
    item_count: 0,
    sub_item_count: 0,
    inventory_unit_count: 0,
    draft_document_count: 0,
  },
  warehouses: [],
  partners: [],
  items: [],
  inventory: [],
  documents: [],
};

const PRIMARY_BUTTON_CLASS_NAME = "asset-workspace__button asset-workspace__button--primary";
const SECONDARY_BUTTON_CLASS_NAME = "asset-workspace__button asset-workspace__button--secondary";
const GHOST_BUTTON_CLASS_NAME = "asset-workspace__button asset-workspace__button--ghost";
const GHOST_DANGER_BUTTON_CLASS_NAME = "asset-workspace__button asset-workspace__button--ghost-danger";
const PANEL_TOGGLE_BUTTON_CLASS_NAME = "asset-workspace__button asset-workspace__button--panel-toggle";
const INPUT_CLASS_NAME = "asset-workspace__field asset-workspace__field--input";
const SELECT_CLASS_NAME = "asset-workspace__field asset-workspace__field--select";
const TEXTAREA_CLASS_NAME = "asset-workspace__field asset-workspace__field--textarea";

function createDocumentLineState(subItemId = ""): DocumentLineState {
  return {
    key: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    subItemId,
    quantity: "1",
    unitPrice: "",
    unitCost: "",
    remark: "",
  };
}

const INITIAL_DOCUMENT_FORM: DocumentFormState = {
  documentType: "manual_in",
  sourceWarehouseId: "",
  targetWarehouseId: "",
  counterpartyId: "",
  takenByUserId: "",
  takenByName: "",
  destinationText: "",
  counterpartyName: "",
  referenceClaimId: "",
  invoiceNo: "",
  note: "",
  lines: [createDocumentLineState()],
};

export function AssetWorkspace() {
  const { user, isMobile } = useUserState();
  const [searchParams] = useSearchParams();
  const permissionUser = user as AssetPermissionUser;
  const requestedPanelKey = resolveAssetPanelKey(searchParams.get("asset_panel"));
  const [dashboard, setDashboard] = useState<AssetDashboardPayload>(EMPTY_ASSET_DASHBOARD);
  const [movementDocuments, setMovementDocuments] = useState<AssetStockDocumentRecord[]>([]);
  const [loadedData, setLoadedData] = useState<Record<AssetDataKey, boolean>>(INITIAL_ASSET_DATA_LOADED);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warehouseForm, setWarehouseForm] = useState<WarehouseFormState>(INITIAL_WAREHOUSE_FORM);
  const [itemForm, setItemForm] = useState<ItemFormState>(INITIAL_ITEM_FORM);
  const [partnerForm, setPartnerForm] = useState<PartnerFormState>(INITIAL_PARTNER_FORM);
  const [subItemForm, setSubItemForm] = useState<SubItemFormState>(INITIAL_SUB_ITEM_FORM);
  const [documentForm, setDocumentForm] = useState<DocumentFormState>(INITIAL_DOCUMENT_FORM);
  const [inventoryThresholdValues, setInventoryThresholdValues] = useState<Record<number, string>>({});
  const [editingWarehouseId, setEditingWarehouseId] = useState<number | null>(null);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingPartnerId, setEditingPartnerId] = useState<number | null>(null);
  const [editingSubItemId, setEditingSubItemId] = useState<number | null>(null);
  const [editingDocumentId, setEditingDocumentId] = useState<number | null>(null);
  const [masterEditorMode, setMasterEditorMode] = useState<MasterEditorMode>("overview");
  const [documentEditorMode, setDocumentEditorMode] = useState<DocumentEditorMode>("overview");
  const [activePanelKey, setActivePanelKey] = useState<AssetPanelKey>(requestedPanelKey);
  const [collapsedSections, setCollapsedSections] = useState<Record<AssetPanelKey, boolean>>({
    ...INITIAL_COLLAPSED_SECTIONS,
    [requestedPanelKey]: false,
  });
  const [masterQuery, setMasterQuery] = useState("");
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [inventoryWarehouseFilter, setInventoryWarehouseFilter] = useState<string>("all");
  const [documentQuery, setDocumentQuery] = useState("");
  const [documentStatusFilter, setDocumentStatusFilter] = useState<string>("all");
  const [documentTypeFilter, setDocumentTypeFilter] = useState<string>("all");
  const [movementQuery, setMovementQuery] = useState("");
  const activeDataKey = ASSET_PANEL_DATA_KEY[activePanelKey];
  const activePanelLoaded = loadedData[activeDataKey];

  useEffect(() => {
    openPanel(requestedPanelKey);
    void loadDashboard(requestedPanelKey);
  }, [requestedPanelKey]);

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

  const canEdit =
    permissionNames.has("asset_edit") || permissionNames.has("account_edit");
  const deferredMasterQuery = useDeferredValue(masterQuery.trim().toLowerCase());
  const deferredInventoryQuery = useDeferredValue(inventoryQuery.trim().toLowerCase());
  const deferredDocumentQuery = useDeferredValue(documentQuery.trim().toLowerCase());
  const deferredMovementQuery = useDeferredValue(movementQuery.trim().toLowerCase());

  const flatSubItems = useMemo(
    () =>
      (dashboard?.items || []).reduce<AssetSubItemRecord[]>(
        (accumulator, item) => accumulator.concat(item.sub_items || []),
        [],
      ),
    [dashboard],
  );

  const inventoryRows = useMemo(() => dashboard?.inventory || [], [dashboard]);
  const lowStockRows = useMemo(
    () => inventoryRows.filter((row) => row.min_quantity > 0 && row.available_quantity <= row.min_quantity),
    [inventoryRows],
  );
  const itemSummaryRows = useMemo<ItemSummaryRow[]>(() => {
    const summaryMap = new Map<
      number,
      ItemSummaryRow & {
        warehouseIds: Set<number>;
        subItemIds: Set<number>;
      }
    >();

    for (const row of inventoryRows) {
      const itemId = row.item_id ?? row.sub_item_id;
      const existing = summaryMap.get(itemId);
      if (existing) {
        existing.totalAvailable += row.available_quantity;
        existing.totalReserved += row.reserved_quantity;
        existing.lowStockCount += row.min_quantity > 0 && row.available_quantity <= row.min_quantity ? 1 : 0;
        existing.warehouseIds.add(row.warehouse_id);
        existing.subItemIds.add(row.sub_item_id);
        continue;
      }

      summaryMap.set(itemId, {
        itemId,
        itemName: row.item_name || row.sub_item_name || "未命名 Item",
        itemCode: row.item_code || "-",
        totalAvailable: row.available_quantity,
        totalReserved: row.reserved_quantity,
        warehouseCount: 0,
        subItemCount: 0,
        lowStockCount: row.min_quantity > 0 && row.available_quantity <= row.min_quantity ? 1 : 0,
        warehouseIds: new Set([row.warehouse_id]),
        subItemIds: new Set([row.sub_item_id]),
      });
    }

    return Array.from(summaryMap.values())
      .map((row) => ({
        itemId: row.itemId,
        itemName: row.itemName,
        itemCode: row.itemCode,
        totalAvailable: row.totalAvailable,
        totalReserved: row.totalReserved,
        warehouseCount: row.warehouseIds.size,
        subItemCount: row.subItemIds.size,
        lowStockCount: row.lowStockCount,
      }))
      .sort((left, right) => {
        if (right.totalAvailable !== left.totalAvailable) {
          return right.totalAvailable - left.totalAvailable;
        }
        return left.itemName.localeCompare(right.itemName, "zh-Hans-CN");
      });
  }, [inventoryRows]);
  const movementRows = useMemo<MovementSummaryRow[]>(
    () =>
      movementDocuments
        .flatMap((document) =>
          (document.movements || []).map((movement) => ({
            id: movement.id,
            documentId: document.id,
            documentNo: document.document_no,
            documentType: document.document_type,
            movementType: movement.movement_type,
            documentStatus: document.status,
            warehouseName: movement.warehouse_name || "-",
            itemName: movement.item_name || "-",
            subItemName: movement.sub_item_name || "-",
            quantityDelta: movement.quantity_delta,
            quantityAfter: movement.quantity_after,
            takenByName: movement.taken_by_name || document.taken_by_name,
            destinationText: movement.destination_text || document.destination_text,
            invoiceNo: movement.invoice_no || document.invoice_no,
            createdAt: movement.created_at,
          })),
        )
        .sort((left, right) => {
          const leftTime = new Date(left.createdAt || "").getTime();
          const rightTime = new Date(right.createdAt || "").getTime();
          if (Number.isNaN(leftTime) || Number.isNaN(rightTime) || rightTime === leftTime) {
            return right.id - left.id;
          }
          return rightTime - leftTime;
        }),
    [movementDocuments],
  );
  const filteredWarehouses = useMemo(
    () =>
      (dashboard?.warehouses || []).filter((warehouse) =>
        matchesAssetSearch(deferredMasterQuery, warehouse.name, warehouse.code, warehouse.location, warehouse.remark),
      ),
    [dashboard, deferredMasterQuery],
  );
  const filteredItems = useMemo(
    () =>
      (dashboard?.items || []).filter(
        (item) =>
          !deferredMasterQuery ||
          matchesAssetSearch(deferredMasterQuery, item.name, item.code, item.category, item.unit, item.remark) ||
          (item.sub_items || []).some((subItem) =>
            matchesAssetSearch(
              deferredMasterQuery,
              subItem.name,
              subItem.sku,
              subItem.size,
              subItem.color,
              subItem.barcode,
              subItem.remark,
            ),
          ),
      ),
    [dashboard, deferredMasterQuery],
  );
  const filteredPartners = useMemo(
    () =>
      (dashboard?.partners || []).filter((partner) =>
        matchesAssetSearch(
          deferredMasterQuery,
          partner.name,
          partner.code,
          getPartnerTypeLabel(partner.partner_type),
          partner.contact_person,
          partner.phone,
          partner.address,
          partner.remark,
        ),
      ),
    [dashboard, deferredMasterQuery],
  );
  const filteredInventoryRows = useMemo(
    () =>
      inventoryRows.filter((row) => {
        if (inventoryWarehouseFilter !== "all" && String(row.warehouse_id) !== inventoryWarehouseFilter) {
          return false;
        }
        return matchesAssetSearch(
          deferredInventoryQuery,
          row.warehouse_name,
          row.warehouse_code,
          row.item_name,
          row.item_code,
          row.sub_item_name,
          row.size,
          row.color,
        );
      }),
    [deferredInventoryQuery, inventoryRows, inventoryWarehouseFilter],
  );
  const filteredLowStockRows = useMemo(
    () =>
      filteredInventoryRows.filter((row) => row.min_quantity > 0 && row.available_quantity <= row.min_quantity),
    [filteredInventoryRows],
  );
  const filteredDocuments = useMemo(
    () =>
      (dashboard?.documents || []).filter((document) => {
        if (documentStatusFilter !== "all" && document.status !== documentStatusFilter) {
          return false;
        }
        if (documentTypeFilter !== "all" && document.document_type !== documentTypeFilter) {
          return false;
        }
        if (
          matchesAssetSearch(
            deferredDocumentQuery,
            document.document_no,
            getDocumentTypeLabel(document.document_type),
            document.status,
            document.source_warehouse_name,
            document.target_warehouse_name,
            document.taken_by_name,
            document.destination_text,
            document.counterparty_name,
            document.invoice_no,
            document.note,
          )
        ) {
          return true;
        }
        return (document.lines || []).some((line) =>
          matchesAssetSearch(
            deferredDocumentQuery,
            line.item_name,
            line.sub_item_name,
            line.size,
            line.remark,
          ),
        );
      }),
    [dashboard, deferredDocumentQuery, documentStatusFilter, documentTypeFilter],
  );
  const filteredItemSummaryRows = useMemo(
    () =>
      itemSummaryRows.filter((row) =>
        matchesAssetSearch(deferredInventoryQuery, row.itemName, row.itemCode),
      ),
    [deferredInventoryQuery, itemSummaryRows],
  );
  const filteredMovementRows = useMemo(
    () =>
      movementRows.filter((movement) =>
        matchesAssetSearch(
          deferredMovementQuery,
          movement.documentNo,
          getMovementTypeLabel(movement.documentType, movement.quantityDelta, movement.movementType),
          movement.documentStatus,
          movement.warehouseName,
          movement.itemName,
          movement.subItemName,
          movement.takenByName,
          movement.destinationText,
          movement.invoiceNo,
        ),
      ),
    [deferredMovementQuery, movementRows],
  );
  useEffect(() => {
    setInventoryThresholdValues((current) => {
      const nextValues = { ...current };
      for (const row of inventoryRows) {
        if (!(row.id in nextValues)) {
          nextValues[row.id] = String(row.min_quantity ?? 0);
        }
      }
      return nextValues;
    });
  }, [inventoryRows]);

  async function loadDashboard(panelKey: AssetPanelKey = activePanelKey) {
    const dataKey = ASSET_PANEL_DATA_KEY[panelKey];
    setLoading(true);
    setError(null);
    try {
      if (dataKey === "master") {
        const data = await fetchAssetMasterData();
        setDashboard((current) => ({
          ...current,
          warehouses: data.warehouses,
          partners: data.partners,
          items: data.items,
        }));
        hydrateMasterDefaults(data.items);
      } else if (dataKey === "documents") {
        const data = await fetchAssetDocumentsData();
        setDashboard((current) => ({
          ...current,
          warehouses: data.warehouses,
          items: data.items,
          documents: data.documents,
        }));
        hydrateDocumentDefaults(data.warehouses, data.items);
      } else if (dataKey === "inventory") {
        const data = await fetchAssetInventoryData();
        setDashboard((current) => ({
          ...current,
          warehouses: data.warehouses,
          inventory: data.inventory,
        }));
      } else {
        const data = await fetchAssetMovementsData();
        setMovementDocuments(data.documents);
      }
      setLoadedData((current) => ({
        ...current,
        [dataKey]: true,
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "资产模块载入失败");
    } finally {
      setLoading(false);
    }
  }

  function hydrateMasterDefaults(items: AssetItemRecord[]) {
    setSubItemForm((current) => ({
      ...current,
      itemId: current.itemId || String(items[0]?.id || ""),
    }));
  }

  function hydrateDocumentDefaults(warehouses: AssetWarehouseRecord[], items: AssetItemRecord[]) {
    const firstWarehouseId = String(warehouses[0]?.id || "");
    const firstSubItemId = String(items[0]?.sub_items?.[0]?.id || "");
    setDocumentForm((current) => ({
      ...current,
      sourceWarehouseId: current.sourceWarehouseId || firstWarehouseId,
      targetWarehouseId: current.targetWarehouseId || firstWarehouseId,
      lines: current.lines.length
        ? current.lines.map((line, index) =>
            index === 0 && !line.subItemId ? { ...line, subItemId: firstSubItemId } : line,
          )
        : [createDocumentLineState(firstSubItemId)],
    }));
  }

  function markAssetDataStale(keys: AssetDataKey[]) {
    setLoadedData((current) =>
      keys.reduce(
        (next, key) => ({
          ...next,
          [key]: false,
        }),
        current,
      ),
    );
  }

  async function handleWarehouseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) {
      setError("你没有创建仓库的权限");
      return;
    }
    setSubmitting(true);
    try {
      if (editingWarehouseId) {
        await updateAssetWarehouse(editingWarehouseId, warehouseForm);
      } else {
        await createAssetWarehouse(warehouseForm);
      }
      setWarehouseForm(INITIAL_WAREHOUSE_FORM);
      setEditingWarehouseId(null);
      setMasterEditorMode("overview");
      setMessage(editingWarehouseId ? "仓库已更新" : "仓库已创建");
      markAssetDataStale(["documents", "inventory", "movements"]);
      await loadDashboard("master");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `${editingWarehouseId ? "更新" : "创建"}仓库失败`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleItemSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) {
      setError("你没有创建 item 的权限");
      return;
    }
    setSubmitting(true);
    try {
      if (editingItemId) {
        await updateAssetItem(editingItemId, itemForm);
      } else {
        await createAssetItem(itemForm);
      }
      setItemForm(INITIAL_ITEM_FORM);
      setEditingItemId(null);
      setMasterEditorMode("overview");
      setMessage(editingItemId ? "资产 item 已更新" : "资产 item 已创建");
      markAssetDataStale(["documents", "inventory", "movements"]);
      await loadDashboard("master");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `${editingItemId ? "更新" : "创建"} item 失败`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePartnerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) {
      setError("你没有创建往来对象的权限");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: partnerForm.name,
        code: partnerForm.code,
        partner_type: partnerForm.partnerType,
        contact_person: partnerForm.contactPerson,
        phone: partnerForm.phone,
        address: partnerForm.address,
      };
      if (editingPartnerId) {
        await updateAssetPartner(editingPartnerId, payload);
      } else {
        await createAssetPartner(payload);
      }
      setPartnerForm(INITIAL_PARTNER_FORM);
      setEditingPartnerId(null);
      setMasterEditorMode("overview");
      setMessage(editingPartnerId ? "往来对象已更新" : "往来对象已创建");
      markAssetDataStale(["documents"]);
      await loadDashboard("master");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `${editingPartnerId ? "更新" : "创建"}往来对象失败`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubItemSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) {
      setError("你没有创建子 item 的权限");
      return;
    }
    if (!subItemForm.itemId) {
      setError("请先选择 item");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        item_id: Number(subItemForm.itemId),
        name: subItemForm.name,
        sku: subItemForm.sku,
        size: subItemForm.size,
        color: subItemForm.color,
      };
      if (editingSubItemId) {
        await updateAssetSubItem(editingSubItemId, payload);
      } else {
        await createAssetSubItem(Number(subItemForm.itemId), payload);
      }
      setSubItemForm((current) => ({
        ...INITIAL_SUB_ITEM_FORM,
        itemId: current.itemId,
      }));
      setEditingSubItemId(null);
      setMasterEditorMode("overview");
      setMessage(editingSubItemId ? "子 item 已更新" : "子 item 已创建");
      markAssetDataStale(["documents", "inventory", "movements"]);
      await loadDashboard("master");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `${editingSubItemId ? "更新" : "创建"}子 item 失败`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDocumentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) {
      setError("你没有创建库存单据的权限");
      return;
    }
    const normalizedLines = documentForm.lines.filter((line) => line.subItemId && line.quantity.trim());
    if (!normalizedLines.length) {
      setError("请至少填写一条有效单据明细");
      return;
    }
    setSubmitting(true);
    try {
      const shouldLinkClaim = shouldShowDocumentClaimSelector(documentForm.documentType);
      const payload = {
        document_type: documentForm.documentType,
        source_warehouse_id: documentForm.sourceWarehouseId ? Number(documentForm.sourceWarehouseId) : null,
        target_warehouse_id: documentForm.targetWarehouseId ? Number(documentForm.targetWarehouseId) : null,
        counterparty_id: null,
        taken_by_user_id: documentForm.takenByUserId ? Number(documentForm.takenByUserId) : null,
        taken_by_name: documentForm.takenByName,
        destination_type: resolveDocumentDestinationType(documentForm.documentType),
        destination_text: documentForm.destinationText,
        counterparty_name: documentForm.counterpartyName,
        invoice_no: shouldLinkClaim
          ? documentForm.invoiceNo || documentForm.referenceClaimId || undefined
          : undefined,
        reference_type:
          shouldLinkClaim && documentForm.referenceClaimId ? "reimbursement_request" : undefined,
        reference_id:
          shouldLinkClaim && documentForm.referenceClaimId ? Number(documentForm.referenceClaimId) : undefined,
        note: documentForm.note,
        lines: normalizedLines.map((line) => ({
          sub_item_id: Number(line.subItemId),
          quantity: Number(line.quantity),
          unit_price: line.unitPrice ? Number(line.unitPrice) : undefined,
          unit_cost: line.unitCost ? Number(line.unitCost) : undefined,
          remark: line.remark || undefined,
        })),
      };
      if (editingDocumentId) {
        await updateAssetStockDocument(editingDocumentId, payload);
      } else {
        await createAssetStockDocument(payload);
      }
      setMessage(editingDocumentId ? "库存单据已更新" : "库存单据已创建");
      markAssetDataStale(["inventory", "movements"]);
      await loadDashboard("documents");
      resetDocumentForm();
      setDocumentEditorMode("overview");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `${editingDocumentId ? "更新" : "创建"}库存单据失败`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmDocument(documentId: number) {
    if (!canEdit) {
      setError("你没有确认库存单据的权限");
      return;
    }
    setSubmitting(true);
    try {
      await confirmAssetStockDocument(documentId);
      if (editingDocumentId === documentId) {
        closeDocumentEditor();
      }
      setMessage(`单据 #${documentId} 已确认`);
      markAssetDataStale(["inventory", "movements"]);
      await loadDashboard("documents");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "确认库存单据失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUploadInvoice(documentId: number, file: File | null) {
    if (!file) {
      return;
    }
    if (!canEdit) {
      setError("你没有上传 invoice 的权限");
      return;
    }
    setSubmitting(true);
    try {
      await uploadAssetDocumentInvoice(documentId, file);
      setMessage("invoice 文件已上传");
      await loadDashboard("documents");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "invoice 上传失败");
    } finally {
      setSubmitting(false);
    }
  }

  function handlePreviewInvoice(filePath?: string | null, fileName?: string | null) {
    if (!filePath) {
      return;
    }
    openPreviewModal({
      file_path: filePath,
      file_name: fileName || filePath.split("/").pop() || "invoice",
      mime_type: "",
    });
  }

  async function handleSaveInventoryThreshold(inventoryId: number) {
    if (!canEdit) {
      setError("你没有设置最低库存的权限");
      return;
    }
    const rawValue = String(inventoryThresholdValues[inventoryId] ?? "").trim();
    if (!rawValue) {
      setError("最低库存不能为空");
      return;
    }
    setSubmitting(true);
    try {
      await updateAssetInventoryThreshold(inventoryId, Number(rawValue));
      setMessage("最低库存已更新");
      await loadDashboard("inventory");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "更新最低库存失败");
    } finally {
      setSubmitting(false);
    }
  }

  function handleDocumentLineChange(index: number, key: keyof Omit<DocumentLineState, "key">, value: string) {
    setDocumentForm((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, [key]: value } : line)),
    }));
  }

  function handleDocumentTypeChange(documentType: DocumentFormState["documentType"]) {
    setDocumentForm((current) => {
      const nextForm: DocumentFormState = {
        ...current,
        documentType,
      };
      if (!shouldShowDocumentClaimSelector(documentType)) {
        nextForm.referenceClaimId = "";
        nextForm.invoiceNo = "";
      }
      return nextForm;
    });
  }

  async function handlePickDocumentClaim() {
    const claim = await showClaimPicker({
      title: "选择采购入库关联报销单",
    });
    if (!claim) {
      return;
    }
    setDocumentForm((current) => ({
      ...current,
      referenceClaimId: String(claim.id),
      invoiceNo: String(claim.id),
    }));
  }

  async function handlePickDocumentCounterparty() {
    const selectedPartner = await select_counterparty_modal({
      title: "选择往来对象",
    });
    if (!selectedPartner) {
      return;
    }
    setDocumentForm((current) => ({
      ...current,
      counterpartyId: String(selectedPartner.id),
      counterpartyName: selectedPartner.display_name || selectedPartner.username || "",
    }));
  }

  async function handlePickDocumentTakenBy() {
    const selectedUser = await select_single_user_modal({
      title: "选择经手对象",
    });
    if (!selectedUser) {
      return;
    }
    setDocumentForm((current) => ({
      ...current,
      takenByUserId: String(selectedUser.id),
      takenByName: selectedUser.display_name || selectedUser.username || "",
    }));
  }

  function handleAddDocumentLine() {
    setDocumentForm((current) => ({
      ...current,
      lines: [
        ...current.lines,
        createDocumentLineState(current.lines[0]?.subItemId || String(flatSubItems[0]?.id || "")),
      ],
    }));
  }

  function handleRemoveDocumentLine(index: number) {
    setDocumentForm((current) => ({
      ...current,
      lines:
        current.lines.length <= 1
          ? [createDocumentLineState("")]
          : current.lines.filter((_, lineIndex) => lineIndex !== index),
    }));
  }

  function beginWarehouseEdit(warehouse: WarehouseFormState & { id?: number | null }) {
    openPanel("master");
    setWarehouseForm({
      name: warehouse.name,
      code: warehouse.code,
      location: warehouse.location,
    });
    setEditingWarehouseId(warehouse.id || null);
    setMasterEditorMode("warehouse");
  }

  function beginItemEdit(item: AssetItemRecord) {
    openPanel("master");
    setItemForm({
      name: item.name,
      code: item.code,
      category: item.category || "",
      unit: item.unit || "件",
    });
    setEditingItemId(item.id);
    setMasterEditorMode("item");
  }

  function beginPartnerEdit(partner: AssetPartnerRecord) {
    openPanel("master");
    setPartnerForm({
      name: partner.name,
      code: partner.code,
      partnerType: (partner.partner_type as PartnerFormState["partnerType"]) || "both",
      contactPerson: partner.contact_person || "",
      phone: partner.phone || "",
      address: partner.address || "",
    });
    setEditingPartnerId(partner.id);
    setMasterEditorMode("partner");
  }

  function beginSubItemEdit(subItem: AssetSubItemRecord) {
    openPanel("master");
    setSubItemForm({
      itemId: String(subItem.item_id),
      name: subItem.name,
      sku: subItem.sku || "",
      size: subItem.size || "",
      color: subItem.color || "",
    });
    setEditingSubItemId(subItem.id);
    setMasterEditorMode("sub_item");
  }

  function beginWarehouseCreate() {
    openPanel("master");
    resetWarehouseForm();
    setMasterEditorMode("warehouse");
  }

  function beginItemCreate() {
    openPanel("master");
    resetItemForm();
    setMasterEditorMode("item");
  }

  function beginPartnerCreate() {
    openPanel("master");
    resetPartnerForm();
    setMasterEditorMode("partner");
  }

  function beginSubItemCreate() {
    openPanel("master");
    resetSubItemForm();
    setMasterEditorMode("sub_item");
  }

  function beginDocumentCreate() {
    openPanel("documents");
    resetDocumentForm();
    setDocumentEditorMode("form");
  }

  function beginDocumentEdit(document: AssetDashboardPayload["documents"][number]) {
    openPanel("documents");
    setDocumentEditorMode("form");
    setDocumentForm({
      documentType: document.document_type as DocumentFormState["documentType"],
      sourceWarehouseId: String(document.source_warehouse_id || ""),
      targetWarehouseId: String(document.target_warehouse_id || ""),
      counterpartyId: String(document.counterparty_id || ""),
      takenByUserId: String(document.taken_by_user_id || ""),
      takenByName: document.taken_by_name || "",
      destinationText: document.destination_text || "",
      counterpartyName: document.counterparty_name || "",
      referenceClaimId:
        document.reference_type === "reimbursement_request" && document.reference_id != null
          ? String(document.reference_id)
          : "",
      invoiceNo: document.invoice_no || "",
      note: document.note || "",
      lines: (document.lines || []).map((line) => ({
        key: `document-line-${line.id}`,
        subItemId: String(line.sub_item_id),
        quantity: String(line.quantity),
        unitPrice: line.unit_price != null ? String(line.unit_price) : "",
        unitCost: line.unit_cost != null ? String(line.unit_cost) : "",
        remark: line.remark || "",
      })),
    });
    setEditingDocumentId(document.id);
  }

  function togglePanel(panelKey: AssetPanelKey) {
    setActivePanelKey(panelKey);
    setCollapsedSections((current) => ({
      ...INITIAL_COLLAPSED_SECTIONS,
      [panelKey]: !current[panelKey],
    }));
  }

  function openPanel(panelKey: AssetPanelKey) {
    setActivePanelKey(panelKey);
    setCollapsedSections({
      ...INITIAL_COLLAPSED_SECTIONS,
      [panelKey]: false,
    });
  }

  function resetWarehouseForm() {
    setWarehouseForm(INITIAL_WAREHOUSE_FORM);
    setEditingWarehouseId(null);
  }

  function resetItemForm() {
    setItemForm(INITIAL_ITEM_FORM);
    setEditingItemId(null);
  }

  function resetPartnerForm() {
    setPartnerForm(INITIAL_PARTNER_FORM);
    setEditingPartnerId(null);
  }

  function resetSubItemForm() {
    setSubItemForm({
      ...INITIAL_SUB_ITEM_FORM,
      itemId: dashboard?.items?.[0]?.id ? String(dashboard.items[0].id) : "",
    });
    setEditingSubItemId(null);
  }

  function closeMasterEditor() {
    if (masterEditorMode === "warehouse") {
      resetWarehouseForm();
    } else if (masterEditorMode === "item") {
      resetItemForm();
    } else if (masterEditorMode === "partner") {
      resetPartnerForm();
    } else if (masterEditorMode === "sub_item") {
      resetSubItemForm();
    }
    setMasterEditorMode("overview");
  }

  function closeDocumentEditor() {
    resetDocumentForm();
    setDocumentEditorMode("overview");
  }

  function resetDocumentForm() {
    setDocumentForm({
      ...INITIAL_DOCUMENT_FORM,
      sourceWarehouseId: dashboard?.warehouses?.[0]?.id ? String(dashboard.warehouses[0].id) : "",
      targetWarehouseId: dashboard?.warehouses?.[0]?.id ? String(dashboard.warehouses[0].id) : "",
      lines: [createDocumentLineState(String(flatSubItems[0]?.id || ""))],
    });
    setEditingDocumentId(null);
  }

  async function handleCancelDocument(documentId: number, confirmed: boolean) {
    const accepted = await showConfirmDialog({
      title: confirmed ? "作废并回滚库存" : "作废单据",
      message: confirmed ? "这会自动回滚该单据已经影响过的库存，确定继续吗？" : "确定要作废这张 draft 单据吗？",
      confirmText: "确认作废",
      tone: "danger",
    });
    if (!accepted) {
      return;
    }
    setSubmitting(true);
    try {
      await cancelAssetStockDocument(documentId);
      if (editingDocumentId === documentId) {
        closeDocumentEditor();
      }
      setMessage("库存单据已作废");
      markAssetDataStale(["inventory", "movements"]);
      await loadDashboard("documents");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "作废库存单据失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeletePartner(partner: AssetPartnerRecord) {
    const accepted = await showConfirmDialog({
      title: `删除往来对象 ${partner.name}`,
      message: "只有未被库存单据引用的往来对象才能删除，确定继续吗？",
      confirmText: "确认删除",
      tone: "danger",
    });
    if (!accepted) {
      return;
    }
    setSubmitting(true);
    try {
      await deleteAssetPartner(partner.id);
      if (editingPartnerId === partner.id) {
        resetPartnerForm();
      }
      setMessage(`往来对象 ${partner.name} 已删除`);
      markAssetDataStale(["documents"]);
      await loadDashboard("master");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除往来对象失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteDocument(documentId: number) {
    const accepted = await showConfirmDialog({
      title: "删除 draft 单据",
      message: "删除后不能恢复，确定继续吗？",
      confirmText: "确认删除",
      tone: "danger",
    });
    if (!accepted) {
      return;
    }
    setSubmitting(true);
    try {
      await deleteAssetStockDocument(documentId);
      if (editingDocumentId === documentId) {
        closeDocumentEditor();
      }
      setMessage("库存单据已删除");
      await loadDashboard("documents");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除库存单据失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteWarehouse(warehouse: AssetWarehouseRecord) {
    const accepted = await showConfirmDialog({
      title: `删除仓库 ${warehouse.name}`,
      message: "只有未被库存、单据、流水引用的仓库才能删除，确定继续吗？",
      confirmText: "确认删除",
      tone: "danger",
    });
    if (!accepted) {
      return;
    }
    setSubmitting(true);
    try {
      await deleteAssetWarehouse(warehouse.id);
      if (editingWarehouseId === warehouse.id) {
        resetWarehouseForm();
      }
      setMessage(`仓库 ${warehouse.name} 已删除`);
      markAssetDataStale(["documents", "inventory", "movements"]);
      await loadDashboard("master");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除仓库失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteItem(item: AssetItemRecord) {
    const accepted = await showConfirmDialog({
      title: `删除 Item ${item.name}`,
      message: "只有没有子 Item 的主档才能删除，确定继续吗？",
      confirmText: "确认删除",
      tone: "danger",
    });
    if (!accepted) {
      return;
    }
    setSubmitting(true);
    try {
      await deleteAssetItem(item.id);
      if (editingItemId === item.id) {
        resetItemForm();
      }
      setMessage(`Item ${item.name} 已删除`);
      markAssetDataStale(["documents", "inventory", "movements"]);
      await loadDashboard("master");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除 Item 失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteSubItem(subItem: AssetSubItemRecord) {
    const accepted = await showConfirmDialog({
      title: `删除子 Item ${subItem.name}`,
      message: "只有未被库存、单据、流水引用的子 Item 才能删除，确定继续吗？",
      confirmText: "确认删除",
      tone: "danger",
    });
    if (!accepted) {
      return;
    }
    setSubmitting(true);
    try {
      await deleteAssetSubItem(subItem.id);
      if (editingSubItemId === subItem.id) {
        resetSubItemForm();
      }
      setMessage(`子 Item ${subItem.name} 已删除`);
      markAssetDataStale(["documents", "inventory", "movements"]);
      await loadDashboard("master");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除子 Item 失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExportInventory() {
    await exportCsvFile(
      `asset-inventory-${buildTodayStamp()}.csv`,
      ["仓库", "仓库编码", "Item", "Item 编码", "子 Item", "Size", "Color", "可用库存", "保留库存", "最低库存", "更新时间"],
      filteredInventoryRows.map((row) => [
        row.warehouse_name,
        row.warehouse_code,
        row.item_name,
        row.item_code,
        row.sub_item_name,
        row.size,
        row.color,
        row.available_quantity,
        row.reserved_quantity,
        row.min_quantity,
        formatDateTime(row.updated_at),
      ]),
      isMobile,
    );
  }

  async function handleExportDocuments() {
    await exportCsvFile(
      `asset-documents-${buildTodayStamp()}.csv`,
      ["单号", "类型", "状态", "来源仓库", "目标仓库", "经手对象", "去向", "往来对象", "Invoice", "备注", "创建时间"],
      filteredDocuments.map((document) => [
        document.document_no,
        getDocumentTypeLabel(document.document_type),
        document.status,
        document.source_warehouse_name,
        document.target_warehouse_name,
        document.taken_by_name,
        document.destination_text,
        document.counterparty_name,
        document.invoice_no,
        document.note,
        formatDateTime(document.created_at),
      ]),
      isMobile,
    );
  }

  async function handleExportMovements() {
    await exportCsvFile(
      `asset-movements-${buildTodayStamp()}.csv`,
      ["单号", "流水类型", "单据状态", "仓库", "Item", "子 Item", "数量变化", "结余", "经手", "去向", "Invoice", "流水时间"],
      filteredMovementRows.map((movement) => [
        movement.documentNo,
        getMovementTypeLabel(movement.documentType, movement.quantityDelta, movement.movementType),
        movement.documentStatus,
        movement.warehouseName,
        movement.itemName,
        movement.subItemName,
        movement.quantityDelta,
        movement.quantityAfter,
        movement.takenByName,
        movement.destinationText,
        movement.invoiceNo,
        formatDateTime(movement.createdAt),
      ]),
      isMobile,
    );
  }

  if (loading && !activePanelLoaded) {
    return <div className="asset-workspace asset-workspace--loading" style={placeholderStyle}>资产模块载入中…</div>;
  }

  if (error && !activePanelLoaded) {
    return <div className="asset-workspace asset-workspace--error" style={errorStyle}>{error || "资产模块暂时不可用"}</div>;
  }

  return (
    <div className="asset-workspace" style={workspaceStyle}>
      {message ? <div className="asset-workspace__alert asset-workspace__alert--success" style={successStyle}>{message}</div> : null}
      {error ? <div className="asset-workspace__alert asset-workspace__alert--error" style={errorStyle}>{error}</div> : null}

      <div className="asset-workspace__stack asset-workspace__stack--master" style={stackSectionStyle}>
        <section className="asset-workspace__panel asset-workspace__panel--master" style={panelDisplayStyle(activePanelKey, "master")}>
          <div className="asset-workspace__panel-header" style={panelTitleRowStyle}>
            <div className="asset-workspace__panel-copy" style={panelHeaderCopyStyle}>
              <div className="asset-workspace__panel-title" style={panelTitleStyle}>基础档案</div>
              <div className="asset-workspace__panel-hint" style={panelHintStyle}>先建仓库、item，再补衣服 size 子项。</div>
            </div>
            <div className="asset-workspace__panel-header-actions" style={panelHeaderActionsStyle}>
              <button
                className={PANEL_TOGGLE_BUTTON_CLASS_NAME}
                type="button"
                style={panelToggleButtonStyle}
                onClick={() => togglePanel("master")}
              >
                {collapsedSections.master ? "展开" : "收起"}
              </button>
            </div>
          </div>
          {!collapsedSections.master ? (
            <>
            {masterEditorMode === "overview" ? (
              <>
              <div className="asset-workspace__master-actions" style={masterActionGridStyle(isMobile)}>
                <MasterActionCard
                  title="新增仓库"
                  hint="先建仓库名称、编号和地点。"
                  onClick={beginWarehouseCreate}
                  disabled={!canEdit}
                />
                <MasterActionCard
                  title="新增 Item"
                  hint="建立主档名称、分类和单位。"
                  onClick={beginItemCreate}
                  disabled={!canEdit}
                />
                <MasterActionCard
                  title="新增子 Item"
                  hint="录入 size、SKU 和颜色规格。"
                  onClick={beginSubItemCreate}
                  disabled={!canEdit}
                />
              </div>

              <div className="asset-workspace__list-block asset-workspace__list-block--master-search" style={listBlockStyle}>
                <div className="asset-workspace__toolbar asset-workspace__toolbar--stacked" style={sectionToolbarStyle}>
                  <div className="asset-workspace__form-title" style={formTitleStyle}>当前基础档案</div>
                  <input
                    className={`${INPUT_CLASS_NAME} asset-workspace__search-input asset-workspace__search-input--master`}
                    style={toolbarSearchInputStyle}
                    placeholder="搜索仓库 / Item / 子 Item / size"
                    value={masterQuery}
                    onChange={(event) => setMasterQuery(event.target.value)}
                  />
                </div>
              </div>

              <div className="asset-workspace__list-block asset-workspace__list-block--warehouses" style={listBlockStyle}>
                <div className="asset-workspace__form-title" style={formTitleStyle}>当前仓库</div>
                <div className="asset-workspace__compact-list asset-workspace__compact-list--warehouses" style={compactListStyle}>
                  {filteredWarehouses.map((warehouse) => (
                    <div key={warehouse.id} className="asset-workspace__compact-item asset-workspace__compact-item--warehouse" style={compactListItemStyle}>
                      <div className="asset-workspace__row-header" style={lineEditorHeaderStyle}>
                        <div className="asset-workspace__item-title" style={compactListTitleStyle}>{warehouse.name}</div>
                        <div className="asset-workspace__action-group" style={actionGroupStyle}>
                          <button
                            className={GHOST_BUTTON_CLASS_NAME}
                            type="button"
                            style={ghostButtonStyle}
                            onClick={() =>
                              beginWarehouseEdit({
                                id: warehouse.id,
                                name: warehouse.name,
                                code: warehouse.code,
                                location: warehouse.location || "",
                              })
                            }
                            disabled={!canEdit}
                          >
                            编辑
                          </button>
                          <button
                            className={GHOST_DANGER_BUTTON_CLASS_NAME}
                            type="button"
                            style={ghostDangerButtonStyle}
                            onClick={() => void handleDeleteWarehouse(warehouse)}
                            disabled={!canEdit || submitting}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      <div className="asset-workspace__item-meta" style={compactListMetaStyle}>{warehouse.code}{warehouse.location ? ` · ${warehouse.location}` : ""}</div>
                    </div>
                  ))}
                  {!filteredWarehouses.length ? <div className="asset-workspace__empty-state asset-workspace__empty-state--warehouses" style={placeholderSubtleStyle}>没有匹配的仓库。</div> : null}
                </div>
              </div>

              <div className="asset-workspace__list-block asset-workspace__list-block--items" style={listBlockStyle}>
                <div className="asset-workspace__form-title" style={formTitleStyle}>当前 Item / 子 Item</div>
                <div className="asset-workspace__compact-list asset-workspace__compact-list--items" style={compactListStyle}>
                  {filteredItems.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      canEdit={canEdit}
                      onEditItem={beginItemEdit}
                      onEditSubItem={beginSubItemEdit}
                      onDeleteItem={handleDeleteItem}
                      onDeleteSubItem={handleDeleteSubItem}
                      submitting={submitting}
                    />
                  ))}
                  {!filteredItems.length ? <div className="asset-workspace__empty-state asset-workspace__empty-state--items" style={placeholderSubtleStyle}>没有匹配的 Item / 子 Item。</div> : null}
                </div>
              </div>
              </>
            ) : (
              <div className="asset-workspace__master-editor" style={masterEditorShellStyle}>
              <div className="asset-workspace__master-editor-header" style={masterEditorHeaderStyle(isMobile)}>
                <button className={SECONDARY_BUTTON_CLASS_NAME} type="button" style={secondaryButtonStyle} onClick={closeMasterEditor}>
                  返回基础档案
                </button>
                <div>
                  <div className="asset-workspace__form-title" style={formTitleStyle}>
                    {masterEditorMode === "warehouse"
                      ? editingWarehouseId
                        ? `编辑仓库 #${editingWarehouseId}`
                        : "新增仓库"
                      : masterEditorMode === "item"
                        ? editingItemId
                          ? `编辑 Item #${editingItemId}`
                          : "新增 Item"
                        : editingSubItemId
                            ? `编辑子 Item #${editingSubItemId}`
                            : "新增子 Item / Size"}
                  </div>
                  <div className="asset-workspace__panel-hint" style={panelHintStyle}>
                    {masterEditorMode === "warehouse"
                      ? "保存成功后会自动返回基础档案列表。"
                      : masterEditorMode === "item"
                        ? "先录主档，再去维护子 Item / size。"
                        : "这里录入具体规格、size、SKU 和颜色。"}
                  </div>
                </div>
              </div>

              {masterEditorMode === "warehouse" ? (
                <form className="asset-workspace__form asset-workspace__form--warehouse" onSubmit={handleWarehouseSubmit} style={formBlockStyle}>
                  <div className="asset-workspace__field-grid asset-workspace__field-grid--warehouse" style={fieldGridStyle(isMobile)}>
                    <input
                      className={`${INPUT_CLASS_NAME} asset-workspace__input asset-workspace__input--warehouse-name`}
                      style={inputStyle}
                      placeholder="仓库名称"
                      value={warehouseForm.name}
                      onChange={(event) => setWarehouseForm((current) => ({ ...current, name: event.target.value }))}
                    />
                    <input
                      className={`${INPUT_CLASS_NAME} asset-workspace__input asset-workspace__input--warehouse-code`}
                      style={inputStyle}
                      placeholder="仓库编号，留空自动生成"
                      value={warehouseForm.code}
                      onChange={(event) => setWarehouseForm((current) => ({ ...current, code: event.target.value }))}
                    />
                    <input
                      className={`${INPUT_CLASS_NAME} asset-workspace__input asset-workspace__input--warehouse-location`}
                      style={inputStyle}
                      placeholder="仓库地点"
                      value={warehouseForm.location}
                      onChange={(event) => setWarehouseForm((current) => ({ ...current, location: event.target.value }))}
                    />
                  </div>
                  <div className="asset-workspace__form-actions" style={formActionRowStyle}>
                    <button className={PRIMARY_BUTTON_CLASS_NAME} type="submit" style={primaryButtonStyle} disabled={!canEdit || submitting}>
                      {editingWarehouseId ? "保存仓库" : "创建仓库"}
                    </button>
                  </div>
                </form>
              ) : null}

              {masterEditorMode === "item" ? (
                <form className="asset-workspace__form asset-workspace__form--item" onSubmit={handleItemSubmit} style={formBlockStyle}>
                  <div className="asset-workspace__field-grid asset-workspace__field-grid--item" style={fieldGridStyle(isMobile)}>
                    <input
                      className={`${INPUT_CLASS_NAME} asset-workspace__input asset-workspace__input--item-name`}
                      style={inputStyle}
                      placeholder="item 名称"
                      value={itemForm.name}
                      onChange={(event) => setItemForm((current) => ({ ...current, name: event.target.value }))}
                    />
                    <input
                      className={`${INPUT_CLASS_NAME} asset-workspace__input asset-workspace__input--item-code`}
                      style={inputStyle}
                      placeholder="item 编码，留空自动生成"
                      value={itemForm.code}
                      onChange={(event) => setItemForm((current) => ({ ...current, code: event.target.value }))}
                    />
                    <input
                      className={`${INPUT_CLASS_NAME} asset-workspace__input asset-workspace__input--item-category`}
                      style={inputStyle}
                      placeholder="分类"
                      value={itemForm.category}
                      onChange={(event) => setItemForm((current) => ({ ...current, category: event.target.value }))}
                    />
                    <input
                      className={`${INPUT_CLASS_NAME} asset-workspace__input asset-workspace__input--item-unit`}
                      style={inputStyle}
                      placeholder="单位"
                      value={itemForm.unit}
                      onChange={(event) => setItemForm((current) => ({ ...current, unit: event.target.value }))}
                    />
                  </div>
                  <div className="asset-workspace__form-actions" style={formActionRowStyle}>
                    <button className={PRIMARY_BUTTON_CLASS_NAME} type="submit" style={primaryButtonStyle} disabled={!canEdit || submitting}>
                      {editingItemId ? "保存 Item" : "创建 Item"}
                    </button>
                  </div>
                </form>
              ) : null}

              {masterEditorMode === "sub_item" ? (
                <form className="asset-workspace__form asset-workspace__form--sub-item" onSubmit={handleSubItemSubmit} style={formBlockStyle}>
                  <div className="asset-workspace__field-grid asset-workspace__field-grid--sub-item" style={fieldGridStyle(isMobile)}>
                    <select
                      className={`${SELECT_CLASS_NAME} asset-workspace__select asset-workspace__select--sub-item-parent`}
                      style={inputStyle}
                      value={subItemForm.itemId}
                      onChange={(event) => setSubItemForm((current) => ({ ...current, itemId: event.target.value }))}
                    >
                      <option value="">选择 item</option>
                      {(dashboard.items || []).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className={`${INPUT_CLASS_NAME} asset-workspace__input asset-workspace__input--sub-item-name`}
                      style={inputStyle}
                      placeholder="子 item 名称"
                      value={subItemForm.name}
                      onChange={(event) => setSubItemForm((current) => ({ ...current, name: event.target.value }))}
                    />
                    <input
                      className={`${INPUT_CLASS_NAME} asset-workspace__input asset-workspace__input--sub-item-sku`}
                      style={inputStyle}
                      placeholder="SKU"
                      value={subItemForm.sku}
                      onChange={(event) => setSubItemForm((current) => ({ ...current, sku: event.target.value }))}
                    />
                    <input
                      className={`${INPUT_CLASS_NAME} asset-workspace__input asset-workspace__input--sub-item-size`}
                      style={inputStyle}
                      placeholder="size"
                      value={subItemForm.size}
                      onChange={(event) => setSubItemForm((current) => ({ ...current, size: event.target.value }))}
                    />
                    <input
                      className={`${INPUT_CLASS_NAME} asset-workspace__input asset-workspace__input--sub-item-color`}
                      style={inputStyle}
                      placeholder="color"
                      value={subItemForm.color}
                      onChange={(event) => setSubItemForm((current) => ({ ...current, color: event.target.value }))}
                    />
                  </div>
                  <div className="asset-workspace__form-actions" style={formActionRowStyle}>
                    <button className={PRIMARY_BUTTON_CLASS_NAME} type="submit" style={primaryButtonStyle} disabled={!canEdit || submitting}>
                      {editingSubItemId ? "保存子 Item" : "创建子 Item"}
                    </button>
                  </div>
                </form>
              ) : null}
              </div>
            )}
            </>
          ) : (
            <div className="asset-workspace__panel-collapsed-note" style={placeholderSubtleStyle}>点击“展开”查看基础档案内容。</div>
          )}
        </section>

        <section className="asset-workspace__panel asset-workspace__panel--documents" style={panelDisplayStyle(activePanelKey, "documents")}>
          <div className="asset-workspace__panel-header" style={panelTitleRowStyle}>
            <div className="asset-workspace__panel-copy" style={panelHeaderCopyStyle}>
              <div className="asset-workspace__panel-title" style={panelTitleStyle}>库存单据</div>
              <div className="asset-workspace__panel-hint" style={panelHintStyle}>这里保留采购入库、手动入库、领用、调拨和盘点调整；销售与退回请改走销售收入。</div>
            </div>
            <div className="asset-workspace__panel-header-actions" style={panelHeaderActionsStyle}>
              <button
                className={PANEL_TOGGLE_BUTTON_CLASS_NAME}
                type="button"
                style={panelToggleButtonStyle}
                onClick={() => togglePanel("documents")}
              >
                {collapsedSections.documents ? "展开" : "收起"}
              </button>
            </div>
          </div>

          {!collapsedSections.documents ? (
            <>
          {documentEditorMode === "form" ? (
            <div className="asset-workspace__document-editor" style={masterEditorShellStyle}>
              <div className="asset-workspace__document-editor-header" style={masterEditorHeaderStyle(isMobile)}>
                <button className={SECONDARY_BUTTON_CLASS_NAME} type="button" style={secondaryButtonStyle} onClick={closeDocumentEditor}>
                  返回库存单据
                </button>
                <div>
                  <div className="asset-workspace__form-title" style={formTitleStyle}>
                    {editingDocumentId ? `编辑 Draft 单据 #${editingDocumentId}` : "创建库存单据"}
                  </div>
                  <div className="asset-workspace__panel-hint" style={panelHintStyle}>
                    保存成功后会自动回到最近单据列表，采购入库可直接选择报销申请单号。
                  </div>
                </div>
              </div>
              <form className="asset-workspace__form asset-workspace__form--document" onSubmit={handleDocumentSubmit} style={formBlockStyle}>
                <div className="asset-workspace__field-grid asset-workspace__field-grid--document" style={fieldGridStyle(isMobile)}>
                  <select
                    className={`${SELECT_CLASS_NAME} asset-workspace__select asset-workspace__select--document-type`}
                    style={inputStyle}
                    value={documentForm.documentType}
                    onChange={(event) => handleDocumentTypeChange(event.target.value as DocumentFormState["documentType"])}
                  >
                    <option value="purchase_in">采购入库</option>
                    <option value="manual_in">手动入库</option>
                    <option value="issue_out">内部领用</option>
                    <option value="transfer">仓库调拨</option>
                    <option value="adjust">盘点调整</option>
                    {editingDocumentId && documentForm.documentType === "sale_out" ? <option value="sale_out">卖出（旧单据）</option> : null}
                    {editingDocumentId && documentForm.documentType === "sale_return" ? <option value="sale_return">销售退回（旧单据）</option> : null}
                  </select>
                  <select
                    className={`${SELECT_CLASS_NAME} asset-workspace__select asset-workspace__select--source-warehouse`}
                    style={inputStyle}
                    value={documentForm.sourceWarehouseId}
                    onChange={(event) => setDocumentForm((current) => ({ ...current, sourceWarehouseId: event.target.value }))}
                  >
                    <option value="">来源仓库</option>
                    {dashboard.warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className={`${SELECT_CLASS_NAME} asset-workspace__select asset-workspace__select--target-warehouse`}
                    style={inputStyle}
                    value={documentForm.targetWarehouseId}
                    onChange={(event) => setDocumentForm((current) => ({ ...current, targetWarehouseId: event.target.value }))}
                  >
                    <option value="">目标仓库</option>
                    {dashboard.warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </select>
                  <div
                    className="asset-workspace__picker asset-workspace__picker--counterparty"
                    style={{ ...pickerBlockStyle, gridColumn: isMobile ? "auto" : "1 / -1" }}
                  >
                      <div className="asset-workspace__picker-copy" style={pickerCopyStyle}>
                        <div className="asset-workspace__picker-label" style={pickerLabelStyle}>往来对象</div>
                        <div className="asset-workspace__picker-value" style={pickerValueStyle}>
                        {documentForm.counterpartyName || "暂未选择往来对象"}
                        </div>
                      </div>
                    <div className="asset-workspace__picker-actions" style={formActionRowStyle}>
                      <button
                        className={SECONDARY_BUTTON_CLASS_NAME}
                        type="button"
                        style={secondaryButtonStyle}
                        onClick={() => void handlePickDocumentCounterparty()}
                        disabled={!canEdit || submitting}
                      >
                        选择往来对象
                      </button>
                      {documentForm.counterpartyId || documentForm.counterpartyName ? (
                        <button
                          className={GHOST_BUTTON_CLASS_NAME}
                          type="button"
                          style={ghostButtonStyle}
                          onClick={() =>
                            setDocumentForm((current) => ({
                              ...current,
                              counterpartyId: "",
                              counterpartyName: "",
                            }))
                          }
                          disabled={!canEdit || submitting}
                        >
                          清除
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="asset-workspace__picker asset-workspace__picker--taken-by" style={pickerBlockStyle}>
                    <div className="asset-workspace__picker-copy" style={pickerCopyStyle}>
                      <div className="asset-workspace__picker-label" style={pickerLabelStyle}>经手对象</div>
                      <div className="asset-workspace__picker-value" style={pickerValueStyle}>
                        {documentForm.takenByName || "暂未选择经手对象"}
                      </div>
                    </div>
                    <div className="asset-workspace__picker-actions" style={formActionRowStyle}>
                      <button
                        className={SECONDARY_BUTTON_CLASS_NAME}
                        type="button"
                        style={secondaryButtonStyle}
                        onClick={() => void handlePickDocumentTakenBy()}
                        disabled={!canEdit || submitting}
                      >
                        选择经手对象
                      </button>
                      {documentForm.takenByUserId || documentForm.takenByName ? (
                        <button
                          className={GHOST_BUTTON_CLASS_NAME}
                          type="button"
                          style={ghostButtonStyle}
                          onClick={() =>
                            setDocumentForm((current) => ({
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
                    className={`${INPUT_CLASS_NAME} asset-workspace__input asset-workspace__input--destination`}
                    style={inputStyle}
                    placeholder="去向 / 地址"
                    value={documentForm.destinationText}
                    onChange={(event) => setDocumentForm((current) => ({ ...current, destinationText: event.target.value }))}
                  />
                </div>

                {shouldShowDocumentClaimSelector(documentForm.documentType) ? (
                  <div className="asset-workspace__claim-linker" style={claimLinkerStyle}>
                    <div className="asset-workspace__claim-linker-copy" style={claimCopyStyle}>
                      <div className="asset-workspace__form-title" style={formTitleStyle}>关联报销申请</div>
                      <div className="asset-workspace__panel-hint" style={panelHintStyle}>
                        采购入库会把报销申请单号写入 invoice 编号。
                      </div>
                      <div className="asset-workspace__claim-linker-value" style={claimValueStyle}>
                        {documentForm.referenceClaimId ? `已关联报销单 #${documentForm.referenceClaimId}` : "暂未关联报销单"}
                      </div>
                    </div>
                    <div className="asset-workspace__claim-linker-actions" style={formActionRowStyle}>
                      <button
                        className={SECONDARY_BUTTON_CLASS_NAME}
                        type="button"
                        style={secondaryButtonStyle}
                        onClick={() => void handlePickDocumentClaim()}
                        disabled={!canEdit || submitting}
                      >
                        选择报销单号
                      </button>
                      {documentForm.referenceClaimId ? (
                        <button
                          className={GHOST_BUTTON_CLASS_NAME}
                          type="button"
                          style={ghostButtonStyle}
                          onClick={() =>
                            setDocumentForm((current) => ({
                              ...current,
                              referenceClaimId: "",
                              invoiceNo: "",
                            }))
                          }
                          disabled={!canEdit || submitting}
                        >
                          清除关联
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="asset-workspace__line-editor" style={lineEditorSectionStyle}>
                  <div className="asset-workspace__row-header" style={lineEditorHeaderStyle}>
                    <div className="asset-workspace__form-title" style={formTitleStyle}>单据明细</div>
                    <button
                      className={SECONDARY_BUTTON_CLASS_NAME}
                      type="button"
                      style={secondaryButtonStyle}
                      onClick={handleAddDocumentLine}
                      disabled={!canEdit || submitting}
                    >
                      新增一行
                    </button>
                  </div>
                  <div className="asset-workspace__line-list" style={lineEditorListStyle}>
                    {documentForm.lines.map((line, index) => (
                      <div key={line.key} className="asset-workspace__line-card" style={lineEditorCardStyle}>
                        <div className="asset-workspace__row-header" style={lineEditorHeaderStyle}>
                          <div className="asset-workspace__item-title" style={compactListTitleStyle}>明细 #{index + 1}</div>
                          <button
                            className={GHOST_BUTTON_CLASS_NAME}
                            type="button"
                            style={ghostButtonStyle}
                            onClick={() => handleRemoveDocumentLine(index)}
                            disabled={!canEdit || submitting}
                          >
                            删除
                          </button>
                        </div>
                        <div className="asset-workspace__line-grid" style={lineEditorGridStyle(isMobile)}>
                          <select
                            className={`${SELECT_CLASS_NAME} asset-workspace__select asset-workspace__select--line-sub-item`}
                            style={inputStyle}
                            value={line.subItemId}
                            onChange={(event) => handleDocumentLineChange(index, "subItemId", event.target.value)}
                          >
                            <option value="">选择子 item</option>
                            {flatSubItems.map((subItem) => (
                              <option key={subItem.id} value={subItem.id}>
                                {buildSubItemOptionLabel(subItem)}
                              </option>
                            ))}
                          </select>
                          <input
                            className={`${INPUT_CLASS_NAME} asset-workspace__input asset-workspace__input--line-quantity`}
                            style={inputStyle}
                            placeholder="数量"
                            value={line.quantity}
                            onChange={(event) => handleDocumentLineChange(index, "quantity", event.target.value)}
                          />
                          <input
                            className={`${INPUT_CLASS_NAME} asset-workspace__input asset-workspace__input--line-unit-price`}
                            style={inputStyle}
                            placeholder="单价"
                            value={line.unitPrice}
                            onChange={(event) => handleDocumentLineChange(index, "unitPrice", event.target.value)}
                          />
                          <input
                            className={`${INPUT_CLASS_NAME} asset-workspace__input asset-workspace__input--line-unit-cost`}
                            style={inputStyle}
                            placeholder="成本价"
                            value={line.unitCost}
                            onChange={(event) => handleDocumentLineChange(index, "unitCost", event.target.value)}
                          />
                          <input
                            className={`${INPUT_CLASS_NAME} asset-workspace__input asset-workspace__input--line-remark`}
                            style={{ ...inputStyle, gridColumn: isMobile ? "auto" : "1 / -1" }}
                            placeholder="明细备注"
                            value={line.remark}
                            onChange={(event) => handleDocumentLineChange(index, "remark", event.target.value)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <textarea
                  className={`${TEXTAREA_CLASS_NAME} asset-workspace__textarea asset-workspace__textarea--document-note`}
                  style={textareaStyle}
                  placeholder="备注"
                  value={documentForm.note}
                  onChange={(event) => setDocumentForm((current) => ({ ...current, note: event.target.value }))}
                />
                <div className="asset-workspace__form-actions" style={formActionRowStyle}>
                  <button className={PRIMARY_BUTTON_CLASS_NAME} type="submit" style={primaryButtonStyle} disabled={!canEdit || submitting}>
                    {editingDocumentId ? "保存单据" : "创建库存单据"}
                  </button>
                </div>
              </form>
            </div>
          ) : (
          <div className="asset-workspace__list-block asset-workspace__list-block--documents" style={listBlockStyle}>
            <div className="asset-workspace__toolbar asset-workspace__toolbar--documents" style={sectionToolbarStyle}>
              <div>
                <div className="asset-workspace__form-title" style={formTitleStyle}>最近单据</div>
                <div className="asset-workspace__panel-hint" style={panelHintStyle}>点击“创建库存单据”才会进入录单表单。</div>
              </div>
              <div className="asset-workspace__toolbar-row" style={toolbarRowStyle}>
                <button className={PRIMARY_BUTTON_CLASS_NAME} type="button" style={primaryButtonStyle} onClick={beginDocumentCreate} disabled={!canEdit}>
                  创建库存单据
                </button>
                <input
                  className={`${INPUT_CLASS_NAME} asset-workspace__search-input asset-workspace__search-input--documents`}
                  style={toolbarSearchInputStyle}
                  placeholder="搜索单号 / 仓库 / item / invoice / 去向"
                  value={documentQuery}
                  onChange={(event) => setDocumentQuery(event.target.value)}
                />
                <select
                  className={`${SELECT_CLASS_NAME} asset-workspace__select asset-workspace__select--document-status-filter`}
                  style={toolbarSelectStyle}
                  value={documentStatusFilter}
                  onChange={(event) => setDocumentStatusFilter(event.target.value)}
                >
                  <option value="all">全部状态</option>
                  <option value="draft">draft</option>
                  <option value="confirmed">confirmed</option>
                  <option value="cancelled">cancelled</option>
                </select>
                <select
                  className={`${SELECT_CLASS_NAME} asset-workspace__select asset-workspace__select--document-type-filter`}
                  style={toolbarSelectStyle}
                  value={documentTypeFilter}
                  onChange={(event) => setDocumentTypeFilter(event.target.value)}
                >
                  <option value="all">全部类型</option>
                  <option value="purchase_in">采购入库</option>
                  <option value="manual_in">手动入库</option>
                  <option value="issue_out">内部领用</option>
                  <option value="transfer">仓库调拨</option>
                  <option value="adjust">盘点调整</option>
                </select>
                <button className={SECONDARY_BUTTON_CLASS_NAME} type="button" style={secondaryButtonStyle} onClick={() => void handleExportDocuments()}>
                  导出单据
                </button>
              </div>
            </div>
            <div className="asset-workspace__document-list" style={documentListStyle}>
              {filteredDocuments.map((document) => (
                <article key={document.id} className="asset-workspace__document-card" style={documentCardStyle}>
                  <div className="asset-workspace__document-header" style={documentHeaderStyle}>
                    <div>
                      <div className="asset-workspace__document-no" style={documentNoStyle}>{document.document_no}</div>
                      <div className="asset-workspace__document-meta" style={documentMetaStyle}>
                        {getDocumentTypeLabel(document.document_type)} · {document.status}
                        {document.source_warehouse_name ? ` · 出自 ${document.source_warehouse_name}` : ""}
                        {document.target_warehouse_name ? ` · 到 ${document.target_warehouse_name}` : ""}
                      </div>
                    </div>
                    <div className="asset-workspace__document-actions" style={documentActionRowStyle}>
                      {document.status === "draft" ? (
                        <>
                          <button
                            className={SECONDARY_BUTTON_CLASS_NAME}
                            type="button"
                            style={secondaryButtonStyle}
                            onClick={() => beginDocumentEdit(document)}
                            disabled={!canEdit || submitting}
                          >
                            编辑
                          </button>
                          <button
                            className={SECONDARY_BUTTON_CLASS_NAME}
                            type="button"
                            style={secondaryButtonStyle}
                            onClick={() => void handleConfirmDocument(document.id)}
                            disabled={!canEdit || submitting}
                          >
                            确认入账
                          </button>
                          <button
                            className={GHOST_BUTTON_CLASS_NAME}
                            type="button"
                            style={ghostButtonStyle}
                            onClick={() => void handleCancelDocument(document.id, false)}
                            disabled={!canEdit || submitting}
                          >
                            作废
                          </button>
                          <button
                            className={GHOST_DANGER_BUTTON_CLASS_NAME}
                            type="button"
                            style={ghostDangerButtonStyle}
                            onClick={() => void handleDeleteDocument(document.id)}
                            disabled={!canEdit || submitting}
                          >
                            删除
                          </button>
                        </>
                      ) : document.status === "confirmed" ? (
                        <>
                          <span className="asset-workspace__chip asset-workspace__chip--confirmed" style={chipStyle("confirmed")}>已确认</span>
                          <button
                            className={GHOST_DANGER_BUTTON_CLASS_NAME}
                            type="button"
                            style={ghostDangerButtonStyle}
                            onClick={() => void handleCancelDocument(document.id, true)}
                            disabled={!canEdit || submitting}
                          >
                            作废回滚
                          </button>
                        </>
                      ) : (
                        <span className="asset-workspace__chip asset-workspace__chip--warning" style={chipStyle("warning")}>已作废</span>
                      )}
                    </div>
                  </div>
                  <div className="asset-workspace__document-meta" style={documentMetaStyle}>
                    {document.taken_by_name ? `经手对象：${document.taken_by_name}` : "未填写经手对象"}
                    {document.destination_text ? ` · 去向：${document.destination_text}` : ""}
                    {document.invoice_no ? ` · Invoice：${document.invoice_no}` : ""}
                  </div>
                  <div className="asset-workspace__document-actions asset-workspace__document-actions--invoice" style={documentActionRowStyle}>
                    <label className="asset-workspace__file-action" style={fileActionLabelStyle}>
                      {document.invoice_file_path ? "替换 Invoice" : "上传 Invoice"}
                      <input
                        className="asset-workspace__hidden-input asset-workspace__hidden-input--invoice"
                        type="file"
                        accept=".pdf,image/*,.heic,.heif"
                        style={hiddenInputStyle}
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          event.currentTarget.value = "";
                          void handleUploadInvoice(document.id, file);
                        }}
                        disabled={!canEdit || submitting}
                      />
                    </label>
                    {document.invoice_file_path ? (
                      <button
                        className={SECONDARY_BUTTON_CLASS_NAME}
                        type="button"
                        style={secondaryButtonStyle}
                        onClick={() => handlePreviewInvoice(document.invoice_file_path, document.invoice_file_name || document.invoice_no)}
                      >
                        预览 Invoice
                      </button>
                    ) : (
                      <span className="asset-workspace__inline-meta" style={inlineMetaStyle}>未上传附件</span>
                    )}
                  </div>
                  <div className="asset-workspace__line-wrap" style={lineWrapStyle}>
                    {(document.lines || []).map((line) => (
                      <div key={line.id} className="asset-workspace__line-chip" style={lineChipStyle}>
                        {line.item_name || "未命名 item"}
                        {line.size ? ` · ${line.size}` : ""}
                        {` · ${line.quantity} 件`}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
              {!dashboard.documents.length ? <div className="asset-workspace__empty-state asset-workspace__empty-state--documents" style={placeholderSubtleStyle}>还没有库存单据。</div> : null}
              {dashboard.documents.length && !filteredDocuments.length ? <div className="asset-workspace__empty-state asset-workspace__empty-state--documents-filtered" style={placeholderSubtleStyle}>没有匹配的库存单据。</div> : null}
            </div>
          </div>
          )}
            </>
          ) : (
            <div className="asset-workspace__panel-collapsed-note" style={placeholderSubtleStyle}>点击“展开”查看库存单据内容。</div>
          )}
        </section>
      </div>

      <div className="asset-workspace__stack asset-workspace__stack--inventory" style={stackSectionStyle}>
        <section className="asset-workspace__panel asset-workspace__panel--inventory" style={panelDisplayStyle(activePanelKey, "inventory")}>
          <div className="asset-workspace__panel-header" style={panelTitleRowStyle}>
            <div className="asset-workspace__panel-copy" style={panelHeaderCopyStyle}>
              <div className="asset-workspace__panel-title" style={panelTitleStyle}>库存总览</div>
              <div className="asset-workspace__panel-hint" style={panelHintStyle}>按仓库 + 子 item + size 查看当前可用库存。</div>
            </div>
            <div className="asset-workspace__panel-header-actions" style={panelHeaderActionsStyle}>
              {!collapsedSections.inventory ? (
                <>
                  <span className={`asset-workspace__chip ${filteredLowStockRows.length ? "asset-workspace__chip--warning" : "asset-workspace__chip--neutral"}`} style={chipStyle(filteredLowStockRows.length ? "warning" : "neutral")}>
                    {filteredLowStockRows.length ? `${filteredLowStockRows.length} 条低库存` : "库存正常"}
                  </span>
                  <button className={SECONDARY_BUTTON_CLASS_NAME} type="button" style={secondaryButtonStyle} onClick={() => void handleExportInventory()}>
                    导出库存
                  </button>
                </>
              ) : null}
              <button
                className={PANEL_TOGGLE_BUTTON_CLASS_NAME}
                type="button"
                style={panelToggleButtonStyle}
                onClick={() => togglePanel("inventory")}
              >
                {collapsedSections.inventory ? "展开" : "收起"}
              </button>
            </div>
          </div>
          {!collapsedSections.inventory ? (
            <>
          <div className="asset-workspace__toolbar-row" style={toolbarRowStyle}>
            <input
              className={`${INPUT_CLASS_NAME} asset-workspace__search-input asset-workspace__search-input--inventory`}
              style={toolbarSearchInputStyle}
              placeholder="搜索仓库 / item / 子 item / size / color"
              value={inventoryQuery}
              onChange={(event) => setInventoryQuery(event.target.value)}
            />
            <select
              className={`${SELECT_CLASS_NAME} asset-workspace__select asset-workspace__select--inventory-warehouse-filter`}
              style={toolbarSelectStyle}
              value={inventoryWarehouseFilter}
              onChange={(event) => setInventoryWarehouseFilter(event.target.value)}
            >
              <option value="all">全部仓库</option>
              {dashboard.warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
          </div>
          <div className="asset-workspace__table-wrap" style={tableWrapStyle}>
            <table className="asset-workspace__table asset-workspace__table--inventory" style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>仓库</th>
                  <th style={thStyle}>Item</th>
                  <th style={thStyle}>子 Item</th>
                  <th style={thStyle}>可用</th>
                  <th style={thStyle}>保留</th>
                  <th style={thStyle}>最低库存</th>
                  <th style={thStyle}>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventoryRows.map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{row.warehouse_name || "-"}</td>
                    <td style={tdStyle}>{row.item_name || "-"}</td>
                    <td style={tdStyle}>
                      {row.sub_item_name || "-"}
                      {row.size ? <span style={inlineMetaStyle}> · {row.size}</span> : null}
                    </td>
                    <td style={tdStyle}>{row.available_quantity}</td>
                    <td style={tdStyle}>{row.reserved_quantity}</td>
                    <td style={tdStyle}>
                      <div className="asset-workspace__threshold-editor" style={thresholdEditorStyle}>
                        <input
                          className={`${INPUT_CLASS_NAME} asset-workspace__threshold-input`}
                          style={thresholdInputStyle}
                          value={inventoryThresholdValues[row.id] ?? String(row.min_quantity ?? 0)}
                          onChange={(event) =>
                            setInventoryThresholdValues((current) => ({
                              ...current,
                              [row.id]: event.target.value,
                            }))
                          }
                          disabled={!canEdit}
                        />
                        <button
                          className={`${SECONDARY_BUTTON_CLASS_NAME} asset-workspace__threshold-save`}
                          type="button"
                          style={thresholdButtonStyle}
                          onClick={() => void handleSaveInventoryThreshold(row.id)}
                          disabled={!canEdit || submitting}
                        >
                          保存
                        </button>
                      </div>
                    </td>
                    <td style={tdStyle}>{formatDateTime(row.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!inventoryRows.length ? <div className="asset-workspace__empty-state asset-workspace__empty-state--inventory" style={placeholderSubtleStyle}>还没有库存记录，先创建单据并确认。</div> : null}
            {inventoryRows.length && !filteredInventoryRows.length ? <div className="asset-workspace__empty-state asset-workspace__empty-state--inventory-filtered" style={placeholderSubtleStyle}>没有匹配的库存记录。</div> : null}
          </div>
            </>
          ) : (
            <div className="asset-workspace__panel-collapsed-note" style={placeholderSubtleStyle}>点击“展开”查看库存总览内容。</div>
          )}
        </section>

        <section className="asset-workspace__panel asset-workspace__panel--low-stock" style={panelDisplayStyle(activePanelKey, "low_stock")}>
          <div className="asset-workspace__panel-header" style={panelTitleRowStyle}>
            <div className="asset-workspace__panel-copy" style={panelHeaderCopyStyle}>
              <div className="asset-workspace__panel-title" style={panelTitleStyle}>低库存提醒</div>
              <div className="asset-workspace__panel-hint" style={panelHintStyle}>当 available_quantity 小于等于 min_quantity 时会出现在这里。</div>
            </div>
            <div className="asset-workspace__panel-header-actions" style={panelHeaderActionsStyle}>
              <button
                className={PANEL_TOGGLE_BUTTON_CLASS_NAME}
                type="button"
                style={panelToggleButtonStyle}
                onClick={() => togglePanel("low_stock")}
              >
                {collapsedSections.low_stock ? "展开" : "收起"}
              </button>
            </div>
          </div>
          {!collapsedSections.low_stock ? (
          <div className="asset-workspace__compact-list asset-workspace__compact-list--low-stock" style={compactListStyle}>
            {filteredLowStockRows.map((row) => (
              <div key={row.id} className="asset-workspace__warning-item" style={warningItemStyle}>
                <div className="asset-workspace__item-title" style={compactListTitleStyle}>
                  {row.warehouse_name || "-"} · {row.item_name || "-"}
                  {row.size ? ` · ${row.size}` : ""}
                </div>
                <div className="asset-workspace__item-meta" style={compactListMetaStyle}>
                  可用 {row.available_quantity} / 最低 {row.min_quantity}
                </div>
              </div>
            ))}
            {!filteredLowStockRows.length ? <div className="asset-workspace__empty-state asset-workspace__empty-state--low-stock" style={placeholderSubtleStyle}>目前没有低库存提醒。</div> : null}
          </div>
          ) : (
            <div className="asset-workspace__panel-collapsed-note" style={placeholderSubtleStyle}>点击“展开”查看低库存提醒。</div>
          )}
        </section>
      </div>

      <div className="asset-workspace__stack asset-workspace__stack--summary" style={stackSectionStyle}>
        <section className="asset-workspace__panel asset-workspace__panel--item-summary" style={panelDisplayStyle(activePanelKey, "item_summary")}>
          <div className="asset-workspace__panel-header" style={panelTitleRowStyle}>
            <div className="asset-workspace__panel-copy" style={panelHeaderCopyStyle}>
              <div className="asset-workspace__panel-title" style={panelTitleStyle}>Item 汇总</div>
              <div className="asset-workspace__panel-hint" style={panelHintStyle}>按 item 汇总全部仓库的可用库存，方便快速看总量。</div>
            </div>
            <div className="asset-workspace__panel-header-actions" style={panelHeaderActionsStyle}>
              {!collapsedSections.item_summary ? <span className="asset-workspace__chip asset-workspace__chip--neutral" style={chipStyle("neutral")}>{filteredItemSummaryRows.length} 个 Item</span> : null}
              <button
                className={PANEL_TOGGLE_BUTTON_CLASS_NAME}
                type="button"
                style={panelToggleButtonStyle}
                onClick={() => togglePanel("item_summary")}
              >
                {collapsedSections.item_summary ? "展开" : "收起"}
              </button>
            </div>
          </div>
          {!collapsedSections.item_summary ? (
          <div className="asset-workspace__compact-list asset-workspace__compact-list--item-summary" style={compactListStyle}>
            {filteredItemSummaryRows.map((row) => (
              <div key={row.itemId} className="asset-workspace__compact-item asset-workspace__compact-item--summary" style={compactListItemStyle}>
                <div className="asset-workspace__item-card-header" style={itemCardHeaderStyle}>
                  <div>
                    <div className="asset-workspace__item-title" style={compactListTitleStyle}>
                      {row.itemName} <span className="asset-workspace__inline-meta" style={inlineMetaStyle}>· {row.itemCode}</span>
                    </div>
                    <div className="asset-workspace__item-meta" style={compactListMetaStyle}>
                      覆盖 {row.warehouseCount} 个仓库 · {row.subItemCount} 个规格
                      {row.lowStockCount ? ` · ${row.lowStockCount} 个低库存规格` : ""}
                    </div>
                  </div>
                  <div className="asset-workspace__summary-value" style={summaryValueStyle}>{row.totalAvailable} 件</div>
                </div>
                <div className="asset-workspace__item-meta" style={compactListMetaStyle}>预留库存 {row.totalReserved} 件</div>
              </div>
            ))}
            {!filteredItemSummaryRows.length ? <div className="asset-workspace__empty-state asset-workspace__empty-state--item-summary" style={placeholderSubtleStyle}>还没有可汇总的库存数据。</div> : null}
          </div>
          ) : (
            <div className="asset-workspace__panel-collapsed-note" style={placeholderSubtleStyle}>点击“展开”查看 Item 汇总内容。</div>
          )}
        </section>

        <section className="asset-workspace__panel asset-workspace__panel--movements" style={panelDisplayStyle(activePanelKey, "movements")}>
          <div className="asset-workspace__panel-header" style={panelTitleRowStyle}>
            <div className="asset-workspace__panel-copy" style={panelHeaderCopyStyle}>
              <div className="asset-workspace__panel-title" style={panelTitleStyle}>库存流水</div>
              <div className="asset-workspace__panel-hint" style={panelHintStyle}>这里只显示最近单据产生的库存变化，可追谁拿、去哪、回滚情况。</div>
            </div>
            <div className="asset-workspace__panel-header-actions" style={panelHeaderActionsStyle}>
              {!collapsedSections.movements ? (
                <>
                  <button className={SECONDARY_BUTTON_CLASS_NAME} type="button" style={secondaryButtonStyle} onClick={() => void handleExportMovements()}>
                    导出流水
                  </button>
                  <span className="asset-workspace__chip asset-workspace__chip--neutral" style={chipStyle("neutral")}>{filteredMovementRows.length} 条流水</span>
                </>
              ) : null}
              <button
                className={PANEL_TOGGLE_BUTTON_CLASS_NAME}
                type="button"
                style={panelToggleButtonStyle}
                onClick={() => togglePanel("movements")}
              >
                {collapsedSections.movements ? "展开" : "收起"}
              </button>
            </div>
          </div>
          {!collapsedSections.movements ? (
            <>
          <div className="asset-workspace__toolbar-row" style={toolbarRowStyle}>
            <input
              className={`${INPUT_CLASS_NAME} asset-workspace__search-input asset-workspace__search-input--movements`}
              style={toolbarSearchInputStyle}
              placeholder="搜索单号 / 仓库 / item / 经手 / invoice"
              value={movementQuery}
              onChange={(event) => setMovementQuery(event.target.value)}
            />
          </div>
          <div className="asset-workspace__movement-list" style={movementListStyle}>
            {filteredMovementRows.map((movement) => (
              <div key={movement.id} className="asset-workspace__movement-card" style={movementCardStyle}>
                <div className="asset-workspace__item-card-header" style={itemCardHeaderStyle}>
                  <div>
                    <div className="asset-workspace__item-title" style={compactListTitleStyle}>
                      {movement.documentNo}{" "}
                      <span className="asset-workspace__inline-meta" style={inlineMetaStyle}>
                        · {getMovementTypeLabel(movement.documentType, movement.quantityDelta, movement.movementType)}
                      </span>
                    </div>
                    <div className="asset-workspace__item-meta" style={compactListMetaStyle}>
                      {movement.warehouseName} · {movement.itemName} · {movement.subItemName}
                    </div>
                  </div>
                  <div className="asset-workspace__movement-delta" style={movementDeltaStyle(movement.quantityDelta)}>
                    {movement.quantityDelta > 0 ? "+" : ""}
                    {movement.quantityDelta}
                  </div>
                </div>
                <div className="asset-workspace__item-meta" style={compactListMetaStyle}>
                  单据状态 {movement.documentStatus} · 结余 {movement.quantityAfter}
                  {movement.takenByName ? ` · 经手 ${movement.takenByName}` : ""}
                  {movement.destinationText ? ` · 去向 ${movement.destinationText}` : ""}
                  {movement.invoiceNo ? ` · Invoice ${movement.invoiceNo}` : ""}
                </div>
                <div className="asset-workspace__movement-footer" style={movementFooterStyle}>
                  <span className="asset-workspace__inline-meta" style={inlineMetaStyle}>流水时间 {formatDateTime(movement.createdAt)}</span>
                </div>
              </div>
            ))}
            {!movementRows.length ? <div className="asset-workspace__empty-state asset-workspace__empty-state--movements" style={placeholderSubtleStyle}>还没有库存流水，确认单据后会自动出现。</div> : null}
            {movementRows.length && !filteredMovementRows.length ? <div className="asset-workspace__empty-state asset-workspace__empty-state--movements-filtered" style={placeholderSubtleStyle}>没有匹配的库存流水。</div> : null}
          </div>
            </>
          ) : (
            <div className="asset-workspace__panel-collapsed-note" style={placeholderSubtleStyle}>点击“展开”查看库存流水内容。</div>
          )}
        </section>
      </div>
    </div>
  );
}

function MasterActionCard({
  title,
  hint,
  onClick,
  disabled,
}: {
  title: string;
  hint: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      className={`asset-workspace__master-action ${disabled ? "asset-workspace__master-action--disabled" : "asset-workspace__master-action--enabled"}`}
      type="button"
      style={masterActionCardStyle(disabled)}
      onClick={onClick}
      disabled={disabled}
    >
      <div className="asset-workspace__master-action-title" style={masterActionTitleStyle}>{title}</div>
      <div className="asset-workspace__master-action-hint" style={masterActionHintStyle}>{hint}</div>
    </button>
  );
}

function ItemCard({
  item,
  canEdit,
  onEditItem,
  onEditSubItem,
  onDeleteItem,
  onDeleteSubItem,
  submitting,
}: {
  item: AssetItemRecord;
  canEdit: boolean;
  onEditItem: (item: AssetItemRecord) => void;
  onEditSubItem: (subItem: AssetSubItemRecord) => void;
  onDeleteItem: (item: AssetItemRecord) => void;
  onDeleteSubItem: (subItem: AssetSubItemRecord) => void;
  submitting: boolean;
}) {
  return (
    <div className="asset-workspace__compact-item asset-workspace__compact-item--item-card" style={compactListItemStyle}>
      <div className="asset-workspace__item-card-header" style={itemCardHeaderStyle}>
        <div>
          <div className="asset-workspace__item-title" style={compactListTitleStyle}>
            {item.name} <span className="asset-workspace__inline-meta" style={inlineMetaStyle}>· {item.code}</span>
          </div>
          <div className="asset-workspace__item-meta" style={compactListMetaStyle}>
            {item.category || "未分类"}
            {item.unit ? ` · 单位 ${item.unit}` : ""}
          </div>
        </div>
        <div className="asset-workspace__action-group" style={actionGroupStyle}>
          <button className={GHOST_BUTTON_CLASS_NAME} type="button" style={ghostButtonStyle} onClick={() => onEditItem(item)} disabled={!canEdit}>
            编辑 Item
          </button>
          <button
            className={GHOST_DANGER_BUTTON_CLASS_NAME}
            type="button"
            style={ghostDangerButtonStyle}
            onClick={() => onDeleteItem(item)}
            disabled={!canEdit || submitting || Boolean(item.sub_items?.length)}
          >
            删除 Item
          </button>
        </div>
      </div>
      <div className="asset-workspace__sub-item-list" style={subItemListStyle}>
        {(item.sub_items || []).map((subItem) => (
          <div key={subItem.id} className="asset-workspace__sub-item-card" style={subItemCardStyle}>
            <span className="asset-workspace__line-chip" style={lineChipStyle}>{buildSubItemOptionLabel(subItem)}</span>
            <div className="asset-workspace__action-group" style={actionGroupStyle}>
              <button
                className={GHOST_BUTTON_CLASS_NAME}
                type="button"
                style={ghostButtonStyle}
                onClick={() => onEditSubItem(subItem)}
                disabled={!canEdit}
              >
                编辑规格
              </button>
              <button
                className={GHOST_DANGER_BUTTON_CLASS_NAME}
                type="button"
                style={ghostDangerButtonStyle}
                onClick={() => onDeleteSubItem(subItem)}
                disabled={!canEdit || submitting}
              >
                删除规格
              </button>
            </div>
          </div>
        ))}
      </div>
      {item.sub_items?.length ? <div className="asset-workspace__item-meta" style={compactListMetaStyle}>有子 Item 时不能直接删除主 Item。</div> : null}
      {!item.sub_items?.length ? <div className="asset-workspace__empty-state asset-workspace__empty-state--sub-items" style={placeholderSubtleStyle}>这个 Item 还没有子 Item / Size。</div> : null}
    </div>
  );
}

function matchesAssetSearch(query: string, ...values: Array<string | number | null | undefined>) {
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

function getDocumentTypeLabel(documentType: string) {
  const labels: Record<string, string> = {
    purchase_in: "采购入库",
    manual_in: "手动入库",
    issue_out: "内部领用",
    transfer: "仓库调拨",
    sale_out: "卖出",
    sale_return: "销售退回",
    adjust: "盘点调整",
  };
  return labels[documentType] || documentType;
}

function getPartnerTypeLabel(partnerType: string) {
  const labels: Record<string, string> = {
    supplier: "供应商",
    customer: "客户",
    both: "供应商 + 客户",
  };
  return labels[partnerType] || partnerType;
}

function getAllowedPartnerTypesForDocument(documentType: DocumentFormState["documentType"]) {
  if (documentType === "purchase_in") {
    return ["supplier", "both"];
  }
  if (documentType === "sale_out" || documentType === "sale_return") {
    return ["customer", "both"];
  }
  return ["supplier", "customer", "both"];
}

function shouldShowDocumentClaimSelector(documentType: DocumentFormState["documentType"]) {
  return documentType === "purchase_in";
}

function resolveDocumentDestinationType(documentType: DocumentFormState["documentType"]) {
  if (documentType === "purchase_in") {
    return "supplier";
  }
  if (documentType === "sale_out") {
    return "customer";
  }
  if (documentType === "sale_return") {
    return "customer_return";
  }
  if (documentType === "transfer") {
    return "warehouse";
  }
  if (documentType === "issue_out") {
    return "person";
  }
  return "other";
}

function getMovementTypeLabel(documentType: string, quantityDelta: number, movementType?: string) {
  if (movementType === "cancel") {
    return "作废回滚";
  }
  if (movementType === "transfer_in") {
    return "调拨入库";
  }
  if (movementType === "transfer_out") {
    return "调拨出库";
  }
  if (documentType === "transfer") {
    return quantityDelta >= 0 ? "调拨入库" : "调拨出库";
  }
  if (documentType === "adjust") {
    return quantityDelta >= 0 ? "盘盈调整" : "盘亏调整";
  }
  return getDocumentTypeLabel(documentType);
}

async function exportCsvFile(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>, isMobile: boolean) {
  const csvContent = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ].join("\n");
  await downloadBlobOrShare(new Blob([`\uFEFF${csvContent}`], { type: "text/csv;charset=utf-8" }), filename, {
    isMobile,
    title: filename,
    text: filename,
    mimeType: "text/csv",
  });
}

function escapeCsvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildTodayStamp() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
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

const colors = designTokens.colors;
const radius = designTokens.radius;

const workspaceStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
  height: "100%",
  overflowY: "auto",
  paddingRight: "2px",
};

function chipStyle(kind: "edit" | "read" | "neutral" | "confirmed" | "warning"): CSSProperties {
  const palette =
    kind === "edit"
      ? { background: colors.accentSoft, color: colors.accentStrong, border: colors.accentBorder }
      : kind === "read"
        ? { background: colors.infoSoft, color: colors.info, border: colors.infoTintStrong }
        : kind === "confirmed"
          ? { background: colors.successSoft, color: colors.success, border: colors.successStrong }
          : kind === "warning"
            ? { background: colors.warningSoft, color: colors.warning, border: colors.warningBorder }
            : { background: colors.panelAlt, color: colors.inkMuted, border: colors.lineSoft };
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 7px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 700,
    border: `1px solid ${palette.border}`,
    background: palette.background,
    color: palette.color,
  };
}

const stackSectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
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

function panelDisplayStyle(activePanelKey: AssetPanelKey, panelKey: AssetPanelKey): CSSProperties {
  return {
    ...panelStyle,
    display: activePanelKey === panelKey ? "grid" : "none",
  };
}

const panelTitleRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
};

const panelHeaderCopyStyle: CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
};

const panelHeaderActionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: "10px",
};

const panelTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 700,
  color: colors.ink,
};

const panelHintStyle: CSSProperties = {
  marginTop: "4px",
  fontSize: "13px",
  color: colors.inkMuted,
};

function masterActionGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: "8px",
  };
}

function masterActionCardStyle(disabled: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "6px",
    textAlign: "left",
    padding: "10px",
    borderRadius: radius.sm,
    border: `1px solid ${disabled ? colors.lineSoft : colors.accentBorder}`,
    background: disabled ? colors.panelAlt : `linear-gradient(145deg, ${colors.panel}, ${colors.accentTint})`,
    color: colors.ink,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.68 : 1,
  };
}

const masterActionTitleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: colors.accentStrong,
};

const masterActionHintStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.55,
  color: colors.inkMuted,
};

const formBlockStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  padding: "10px",
  borderRadius: radius.sm,
  background: colors.panelAlt,
  border: `1px solid ${colors.lineSoft}`,
};

const masterEditorShellStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
};

function masterEditorHeaderStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "auto minmax(0, 1fr)",
    gap: "8px",
    alignItems: "center",
    padding: "10px",
    borderRadius: radius.sm,
    background: colors.panelAlt,
    border: `1px solid ${colors.lineSoft}`,
  };
}

const formTitleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: colors.accentStrong,
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
  minHeight: "72px",
  resize: "vertical",
};

const formActionRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
  alignItems: "center",
};

const claimLinkerStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  padding: "10px",
  borderRadius: radius.sm,
  border: `1px dashed ${colors.accentBorder}`,
  background: colors.accentTint,
};

const claimCopyStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const claimValueStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: colors.accentStrong,
};

const pickerBlockStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
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

const panelToggleButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  whiteSpace: "nowrap",
  flex: "0 0 auto",
};

const ghostButtonStyle: CSSProperties = {
  border: `1px solid ${colors.lineSoft}`,
  borderRadius: radius.sm,
  background: colors.panelAlt,
  color: colors.inkMuted,
  padding: "6px 8px",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: "12px",
};

const ghostDangerButtonStyle: CSSProperties = {
  border: `1px solid ${colors.dangerBorder}`,
  borderRadius: radius.sm,
  background: colors.dangerSoft,
  color: colors.danger,
  padding: "6px 8px",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: "12px",
};

const listBlockStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const sectionToolbarStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const toolbarRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
  alignItems: "center",
};

const toolbarSearchInputStyle: CSSProperties = {
  ...inputStyle,
  width: "auto",
  minWidth: "220px",
  flex: "1 1 240px",
};

const toolbarSelectStyle: CSSProperties = {
  ...inputStyle,
  width: "auto",
  minWidth: "160px",
  flex: "0 0 160px",
};

const actionGroupStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  alignItems: "center",
};

const compactListStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const compactListItemStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: radius.sm,
  background: colors.panel,
  border: `1px solid ${colors.lineSoft}`,
};

const compactListTitleStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: colors.ink,
};

const compactListMetaStyle: CSSProperties = {
  marginTop: "4px",
  fontSize: "12px",
  color: colors.inkMuted,
  lineHeight: 1.5,
};

const itemCardHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "10px",
};

const subItemListStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  marginTop: "8px",
};

const subItemCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
  flexWrap: "wrap",
};

const documentListStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const documentCardStyle: CSSProperties = {
  padding: "10px",
  borderRadius: radius.sm,
  background: colors.panel,
  border: `1px solid ${colors.lineSoft}`,
};

const documentHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "flex-start",
};

const documentNoStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: colors.ink,
};

const documentMetaStyle: CSSProperties = {
  marginTop: "4px",
  fontSize: "12px",
  color: colors.inkMuted,
  lineHeight: 1.6,
};

const documentActionRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "6px",
  marginTop: "8px",
};

const fileActionLabelStyle: CSSProperties = {
  ...secondaryButtonStyle,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const hiddenInputStyle: CSSProperties = {
  display: "none",
};

const lineWrapStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  marginTop: "10px",
};

const lineEditorSectionStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const lineEditorListStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const lineEditorCardStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  padding: "8px 10px",
  borderRadius: radius.sm,
  background: colors.panel,
  border: `1px dashed ${colors.accentBorder}`,
};

const lineEditorHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
};

function lineEditorGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "1.4fr 0.8fr 0.8fr 0.8fr",
    gap: "8px",
  };
}

const lineChipStyle: CSSProperties = {
  padding: "4px 7px",
  borderRadius: "999px",
  background: colors.accentTint,
  color: colors.accentStrong,
  fontSize: "12px",
  fontWeight: 600,
};

const movementListStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const movementCardStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: radius.sm,
  background: colors.panel,
  border: `1px solid ${colors.lineSoft}`,
  display: "grid",
  gap: "6px",
};

function movementDeltaStyle(quantityDelta: number): CSSProperties {
  const positive = quantityDelta >= 0;
  return {
    padding: "4px 7px",
    borderRadius: "999px",
    background: positive ? colors.successSoft : colors.dangerSoft,
    color: positive ? colors.success : colors.danger,
    fontWeight: 700,
    fontSize: "12px",
  };
}

const movementFooterStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
};

const summaryValueStyle: CSSProperties = {
  fontSize: "20px",
  fontWeight: 700,
  color: colors.accentStrong,
  whiteSpace: "nowrap",
};

const tableWrapStyle: CSSProperties = {
  overflowX: "auto",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: "760px",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "7px 8px",
  borderBottom: `1px solid ${colors.line}`,
  color: colors.inkMuted,
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const tdStyle: CSSProperties = {
  padding: "8px",
  borderBottom: `1px solid ${colors.lineSoft}`,
  fontSize: "14px",
  color: colors.ink,
};

const inlineMetaStyle: CSSProperties = {
  color: colors.inkMuted,
  fontSize: "12px",
};

const thresholdEditorStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
};

const thresholdInputStyle: CSSProperties = {
  ...inputStyle,
  minWidth: "72px",
  width: "72px",
  padding: "6px 8px",
};

const thresholdButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  padding: "6px 8px",
  whiteSpace: "nowrap",
};

const warningItemStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: radius.sm,
  background: colors.warningSoft,
  border: `1px solid ${colors.warningBorder}`,
};

const placeholderStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  height: "100%",
  color: colors.inkMuted,
  fontSize: "15px",
};

const placeholderSubtleStyle: CSSProperties = {
  color: colors.inkMuted,
  fontSize: "13px",
  lineHeight: 1.6,
};

const errorStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: radius.sm,
  background: colors.dangerSoft,
  border: `1px solid ${colors.dangerBorder}`,
  color: colors.danger,
  lineHeight: 1.6,
};

const successStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: radius.sm,
  background: colors.successSoft,
  border: `1px solid ${colors.accentBorder}`,
  color: colors.success,
  lineHeight: 1.6,
};
