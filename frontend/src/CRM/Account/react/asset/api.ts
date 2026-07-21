import { apiFetch } from "../../../../js/apiFetch";

import type {
  AssetDashboardPayload,
  AssetDocumentsPayload,
  AssetInventoryRecord,
  AssetInventoryPayload,
  AssetItemRecord,
  AssetMasterDataPayload,
  AssetMovementsPayload,
  AssetPartnerRecord,
  AssetStockDocumentRecord,
  AssetSubItemRecord,
  AssetWarehouseRecord,
} from "./types";

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(data.error || data.message || "请求失败");
  }
  return data;
}

export async function fetchAssetDashboard() {
  const response = await apiFetch("/api/asset/dashboard", {
    credentials: "include",
  });
  const payload = await parseJson<{ data?: AssetDashboardPayload }>(response);
  if (!payload.data) {
    throw new Error("资产看板数据缺失");
  }
  return payload.data;
}

export async function fetchAssetMasterData() {
  const response = await apiFetch("/api/asset/master-data", {
    credentials: "include",
  });
  const payload = await parseJson<{ data?: AssetMasterDataPayload }>(response);
  if (!payload.data) {
    throw new Error("资产基础资料缺失");
  }
  return payload.data;
}

export async function fetchAssetInventoryData() {
  const response = await apiFetch("/api/asset/inventory", {
    credentials: "include",
  });
  const payload = await parseJson<{ data?: AssetInventoryPayload }>(response);
  if (!payload.data) {
    throw new Error("资产库存数据缺失");
  }
  return payload.data;
}

export async function fetchAssetDocumentsData() {
  const response = await apiFetch("/api/asset/stock-documents", {
    credentials: "include",
  });
  const payload = await parseJson<{ data?: AssetDocumentsPayload }>(response);
  if (!payload.data) {
    throw new Error("资产库存单据缺失");
  }
  return payload.data;
}

export async function fetchAssetMovementsData() {
  const response = await apiFetch("/api/asset/movements", {
    credentials: "include",
  });
  const payload = await parseJson<{ data?: AssetMovementsPayload }>(response);
  if (!payload.data) {
    throw new Error("资产库存流水缺失");
  }
  return payload.data;
}

export async function createAssetWarehouse(payload: {
  name: string;
  code: string;
  location?: string;
  remark?: string;
}) {
  const response = await apiFetch("/api/asset/warehouses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ data?: AssetWarehouseRecord }>(response);
  if (!data.data) {
    throw new Error("仓库数据缺失");
  }
  return data.data;
}

export async function updateAssetWarehouse(
  warehouseId: number,
  payload: {
    name: string;
    code: string;
    location?: string;
    remark?: string;
  },
) {
  const response = await apiFetch(`/api/asset/warehouses/${warehouseId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ data?: AssetWarehouseRecord }>(response);
  if (!data.data) {
    throw new Error("仓库更新结果缺失");
  }
  return data.data;
}

export async function deleteAssetWarehouse(warehouseId: number) {
  const response = await apiFetch(`/api/asset/warehouses/${warehouseId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function createAssetItem(payload: {
  name: string;
  code: string;
  category?: string;
  unit?: string;
  remark?: string;
}) {
  const response = await apiFetch("/api/asset/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ data?: AssetItemRecord }>(response);
  if (!data.data) {
    throw new Error("item 数据缺失");
  }
  return data.data;
}

export async function createAssetPartner(payload: {
  name: string;
  code: string;
  partner_type: string;
  contact_person?: string;
  phone?: string;
  address?: string;
  remark?: string;
}) {
  const response = await apiFetch("/api/asset/partners", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ data?: AssetPartnerRecord }>(response);
  if (!data.data) {
    throw new Error("往来对象数据缺失");
  }
  return data.data;
}

export async function updateAssetPartner(
  partnerId: number,
  payload: {
    name: string;
    code: string;
    partner_type: string;
    contact_person?: string;
    phone?: string;
    address?: string;
    remark?: string;
  },
) {
  const response = await apiFetch(`/api/asset/partners/${partnerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ data?: AssetPartnerRecord }>(response);
  if (!data.data) {
    throw new Error("往来对象更新结果缺失");
  }
  return data.data;
}

export async function deleteAssetPartner(partnerId: number) {
  const response = await apiFetch(`/api/asset/partners/${partnerId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function updateAssetItem(
  itemId: number,
  payload: {
    name: string;
    code: string;
    category?: string;
    unit?: string;
    remark?: string;
  },
) {
  const response = await apiFetch(`/api/asset/items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ data?: AssetItemRecord }>(response);
  if (!data.data) {
    throw new Error("item 更新结果缺失");
  }
  return data.data;
}

export async function deleteAssetItem(itemId: number) {
  const response = await apiFetch(`/api/asset/items/${itemId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function createAssetSubItem(
  itemId: number,
  payload: {
    name: string;
    sku?: string;
    size?: string;
    color?: string;
    barcode?: string;
    remark?: string;
  },
) {
  const response = await apiFetch(`/api/asset/items/${itemId}/sub-items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ data?: AssetSubItemRecord }>(response);
  if (!data.data) {
    throw new Error("子 item 数据缺失");
  }
  return data.data;
}

export async function updateAssetSubItem(
  subItemId: number,
  payload: {
    item_id?: number;
    name: string;
    sku?: string;
    size?: string;
    color?: string;
    barcode?: string;
    remark?: string;
  },
) {
  const response = await apiFetch(`/api/asset/sub-items/${subItemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ data?: AssetSubItemRecord }>(response);
  if (!data.data) {
    throw new Error("子 item 更新结果缺失");
  }
  return data.data;
}

export async function deleteAssetSubItem(subItemId: number) {
  const response = await apiFetch(`/api/asset/sub-items/${subItemId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function createAssetStockDocument(payload: {
  document_type: string;
  source_warehouse_id?: number | null;
  target_warehouse_id?: number | null;
  taken_by_user_id?: number | null;
  taken_by_name?: string;
  destination_type?: string;
  destination_text?: string;
  counterparty_id?: number | null;
  counterparty_name?: string;
  invoice_no?: string;
  reference_type?: string;
  reference_id?: number | null;
  note?: string;
  lines: Array<{
    sub_item_id: number;
    quantity: number;
    unit_cost?: number;
    unit_price?: number;
    remark?: string;
  }>;
}) {
  const response = await apiFetch("/api/asset/stock-documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ data?: AssetStockDocumentRecord }>(response);
  if (!data.data) {
    throw new Error("库存单据数据缺失");
  }
  return data.data;
}

export async function updateAssetStockDocument(
  documentId: number,
  payload: {
    document_type: string;
    source_warehouse_id?: number | null;
    target_warehouse_id?: number | null;
    taken_by_user_id?: number | null;
    taken_by_name?: string;
    destination_type?: string;
    destination_text?: string;
    counterparty_id?: number | null;
    counterparty_name?: string;
    invoice_no?: string;
    reference_type?: string;
    reference_id?: number | null;
    note?: string;
    lines: Array<{
      sub_item_id: number;
      quantity: number;
      unit_cost?: number;
      unit_price?: number;
      remark?: string;
    }>;
  },
) {
  const response = await apiFetch(`/api/asset/stock-documents/${documentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ data?: AssetStockDocumentRecord }>(response);
  if (!data.data) {
    throw new Error("库存单据更新结果缺失");
  }
  return data.data;
}

export async function confirmAssetStockDocument(documentId: number) {
  const response = await apiFetch(`/api/asset/stock-documents/${documentId}/confirm`, {
    method: "POST",
    credentials: "include",
  });
  const data = await parseJson<{ data?: AssetStockDocumentRecord }>(response);
  if (!data.data) {
    throw new Error("库存单据确认结果缺失");
  }
  return data.data;
}

export async function postAssetStockDocumentToFinance(documentId: number) {
  const response = await apiFetch(`/api/asset/stock-documents/${documentId}/post-to-finance`, {
    method: "POST",
    credentials: "include",
  });
  const data = await parseJson<{ data?: AssetStockDocumentRecord }>(response);
  if (!data.data) {
    throw new Error("推送收款审核结果缺失");
  }
  return data.data;
}

export async function cancelAssetStockDocument(documentId: number) {
  const response = await apiFetch(`/api/asset/stock-documents/${documentId}/cancel`, {
    method: "POST",
    credentials: "include",
  });
  const data = await parseJson<{ data?: AssetStockDocumentRecord }>(response);
  if (!data.data) {
    throw new Error("库存单据作废结果缺失");
  }
  return data.data;
}

export async function deleteAssetStockDocument(documentId: number) {
  const response = await apiFetch(`/api/asset/stock-documents/${documentId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function updateAssetInventoryThreshold(inventoryId: number, minQuantity: number) {
  const response = await apiFetch(`/api/asset/inventory/${inventoryId}/threshold`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ min_quantity: minQuantity }),
  });
  const data = await parseJson<{ data?: AssetInventoryRecord }>(response);
  if (!data.data) {
    throw new Error("库存阈值更新结果缺失");
  }
  return data.data;
}

export async function uploadAssetDocumentInvoice(documentId: number, file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiFetch(`/api/asset/stock-documents/${documentId}/invoice`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  const data = await parseJson<{ data?: AssetStockDocumentRecord }>(response);
  if (!data.data) {
    throw new Error("invoice 上传结果缺失");
  }
  return data.data;
}
