export type AssetMetricSummary = {
  warehouse_count: number;
  item_count: number;
  sub_item_count: number;
  inventory_unit_count: number;
  draft_document_count: number;
};

export type AssetWarehouseRecord = {
  id: number;
  name: string;
  code: string;
  location?: string | null;
  remark?: string | null;
  manager_user_id?: number | null;
  manager_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AssetPartnerRecord = {
  id: number;
  name: string;
  code: string;
  partner_type: string;
  contact_person?: string | null;
  phone?: string | null;
  address?: string | null;
  status?: string | null;
  remark?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AssetSubItemRecord = {
  id: number;
  item_id: number;
  item_name?: string | null;
  name: string;
  sku?: string | null;
  size?: string | null;
  color?: string | null;
  barcode?: string | null;
  status?: string | null;
  remark?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AssetItemRecord = {
  id: number;
  name: string;
  code: string;
  category?: string | null;
  unit?: string | null;
  status?: string | null;
  remark?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  sub_items: AssetSubItemRecord[];
};

export type AssetInventoryRecord = {
  id: number;
  warehouse_id: number;
  warehouse_name?: string | null;
  warehouse_code?: string | null;
  sub_item_id: number;
  sub_item_name?: string | null;
  size?: string | null;
  color?: string | null;
  item_id?: number | null;
  item_name?: string | null;
  item_code?: string | null;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  min_quantity: number;
  updated_at?: string | null;
};

export type AssetStockDocumentLineRecord = {
  id: number;
  document_id: number;
  sub_item_id: number;
  sub_item_name?: string | null;
  item_name?: string | null;
  size?: string | null;
  quantity: number;
  unit_cost?: number | null;
  unit_price?: number | null;
  line_amount?: number | null;
  remark?: string | null;
};

export type AssetStockMovementRecord = {
  id: number;
  document_id: number;
  document_line_id: number;
  warehouse_id: number;
  warehouse_name?: string | null;
  sub_item_id: number;
  sub_item_name?: string | null;
  item_name?: string | null;
  movement_type: string;
  quantity_delta: number;
  quantity_before: number;
  quantity_after: number;
  taken_by_user_id?: number | null;
  taken_by_name?: string | null;
  destination_text?: string | null;
  invoice_no?: string | null;
  created_by?: number | null;
  created_by_name?: string | null;
  created_at?: string | null;
};

export type AssetStockDocumentRecord = {
  id: number;
  document_no: string;
  document_type: string;
  status: string;
  source_warehouse_id?: number | null;
  source_warehouse_name?: string | null;
  target_warehouse_id?: number | null;
  target_warehouse_name?: string | null;
  requester_user_id?: number | null;
  requester_name?: string | null;
  handler_user_id?: number | null;
  handler_name?: string | null;
  taken_by_user_id?: number | null;
  taken_by_name?: string | null;
  destination_type?: string | null;
  destination_text?: string | null;
  counterparty_id?: number | null;
  counterparty_code?: string | null;
  counterparty_type?: string | null;
  counterparty_name?: string | null;
  event_id?: number | null;
  event_name?: string | null;
  invoice_no?: string | null;
  invoice_type?: string | null;
  invoice_file_path?: string | null;
  invoice_file_name?: string | null;
  reference_type?: string | null;
  reference_id?: number | null;
  finance_payment_status?: string | null;
  note?: string | null;
  created_by?: number | null;
  created_by_name?: string | null;
  approved_by?: number | null;
  approved_by_name?: string | null;
  confirmed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  lines: AssetStockDocumentLineRecord[];
  movements: AssetStockMovementRecord[];
};

export type AssetDashboardPayload = {
  metrics: AssetMetricSummary;
  warehouses: AssetWarehouseRecord[];
  partners: AssetPartnerRecord[];
  items: AssetItemRecord[];
  inventory: AssetInventoryRecord[];
  documents: AssetStockDocumentRecord[];
};

export type AssetMasterDataPayload = Pick<AssetDashboardPayload, "warehouses" | "partners" | "items">;
export type AssetInventoryPayload = Pick<AssetDashboardPayload, "warehouses" | "inventory">;
export type AssetDocumentsPayload = Pick<AssetDashboardPayload, "warehouses" | "items" | "documents">;
export type AssetMovementsPayload = Pick<AssetDashboardPayload, "documents">;
