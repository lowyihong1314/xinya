import type {
  PaymentActionResponse,
  PaymentListResponse,
  YlpOrderCreateResponse,
  YlpOrderDetailResponse,
  YlpOrderItemMutationResponse,
  YlpOrderListResponse,
  YlpOrderSummary,
  YlpOrdersByPhoneResponse,
  YlpOrderLogResponse,
  YlpPagination,
  YlpPaiweiPreviewResponse,
  YlpPaymentChannelListResponse,
  YlpPaymentChannelMutationResponse,
  YlpPaymentRecord,
  YlpRelationOptionListResponse,
  FahuiRawDoc,
  FahuiRawDocListResponse,
  YlpVersionEventResponse,
  YlpVersionResponse,
} from "./types";
import { apiFetch } from "../../js/apiFetch";

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error || data.message || "请求失败");
  }

  return data;
}

function getDownloadFilename(response: Response, fallback: string) {
  const contentDisposition = response.headers.get("content-disposition") || "";
  const match =
    contentDisposition.match(/filename\*=UTF-8''([^;]+)/i) ||
    contentDisposition.match(/filename="?([^";]+)"?/i);

  if (!match?.[1]) {
    return fallback;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export async function fetchPayments() {
  const response = await apiFetch("/api/payment/review", {
    credentials: "include",
  });

  return parseJson<PaymentListResponse>(response);
}

export async function approvePayment(paymentId: number) {
  const response = await apiFetch(`/api/payment/review/${paymentId}/approve`, {
    method: "POST",
    credentials: "include",
  });

  return parseJson<PaymentActionResponse>(response);
}

export async function revokePayment(paymentId: number) {
  const response = await apiFetch(`/api/payment/review/${paymentId}/revoke`, {
    method: "POST",
    credentials: "include",
  });

  return parseJson<PaymentActionResponse>(response);
}

/** 撤回一条付款：记录标成「已拒绝」，凭证保留，**订单状态保持不变**。 */
export async function withdrawPayment(paymentId: number) {
  const response = await apiFetch(`/api/payment/payments/${paymentId}/withdraw`, {
    method: "POST",
    credentials: "include",
  });

  return parseJson<PaymentActionResponse>(response);
}

export async function removePayment(paymentId: number) {
  const response = await apiFetch(`/api/payment/review/${paymentId}`, {
    method: "DELETE",
    credentials: "include",
  });

  return parseJson<PaymentActionResponse>(response);
}

export async function fetchYlpVersions() {
  const response = await apiFetch("/api/fahui_router/versions", {
    credentials: "include",
  });

  return parseJson<YlpVersionResponse>(response);
}

/** 读某个版本绑定了哪个活动（没绑定返回 data: null）。 */
export async function fetchFahuiRawDocs() {
  const response = await apiFetch("/api/fahui_router/raw_docs", {
    credentials: "include",
  });

  return parseJson<FahuiRawDocListResponse>(response);
}

export async function updateFahuiRawDocLink(
  docId: number,
  orderId: number,
  action: "add" | "confirm" | "remove",
) {
  const response = await apiFetch(`/api/fahui_router/raw_docs/${docId}/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ order_id: orderId, action }),
  });

  return parseJson<{ status?: string; message?: string; data?: FahuiRawDoc }>(response);
}

export async function setFahuiRawDocFlag(docId: number, flagId: number, resolved: boolean) {
  const response = await apiFetch(`/api/fahui_router/raw_docs/${docId}/flag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ flag_id: flagId, resolved }),
  });

  return parseJson<{ status?: string; message?: string; data?: FahuiRawDoc }>(response);
}

export type FahuiOldOrderSuggestion = {
  id: number;
  version?: string;
  customer_name?: string;
  phone?: string;
  total?: number;
  item_count?: number;
  created_at?: string | null;
  score?: number;
  reasons?: string[];
};

/** 上传原始单据图（可多选），后端按内容去重后写进 fahui_raw_doc。 */
export async function uploadFahuiRawDocs(files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  const response = await apiFetch("/api/fahui_router/raw_docs/upload", {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  return parseJson<{
    status?: string;
    message?: string;
    data?: { saved: string[]; skipped: { filename: string; reason: string }[]; total: number };
  }>(response);
}

/** BytePlus 读图 + 拿单据资料去往年版本里找最像的订单（最多 3 张）。 */
export async function suggestOldOrdersForRawDoc(docId: number) {
  const response = await apiFetch(`/api/fahui_router/raw_docs/${docId}/suggest_old`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ use_ocr: true }),
  });

  return parseJson<{
    status?: string;
    message?: string;
    data?: {
      doc: { id: number; filename: string; customer?: string | null; phone?: string | null; declared_total?: number | null };
      ocr: {
        ok: boolean;
        error?: string | null;
        model?: string | null;
        customer?: string;
        phones: string[];
        printed_phones?: string[];
        names?: string[];
        totals: number[];
        red_pen_number?: string;
        item_count?: number | null;
        text?: string;
      };
      current_version: string;
      candidates: FahuiOldOrderSuggestion[];
    };
  }>(response);
}

export async function fetchYlpVersionEvent(version: string) {
  const response = await apiFetch(`/api/fahui_router/versions/${encodeURIComponent(version)}/event`, {
    credentials: "include",
  });

  return parseJson<YlpVersionEventResponse>(response);
}

/** 绑定 / 解绑（eventId 传 null 就是解绑）。 */
export async function setYlpVersionEvent(version: string, eventId: number | null) {
  const response = await apiFetch(`/api/fahui_router/versions/${encodeURIComponent(version)}/event`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ event_id: eventId }),
  });

  return parseJson<YlpVersionEventResponse>(response);
}

export async function searchYlpOrders(params: {
  version: string;
  value?: string;
  page?: number;
  perPage?: number;
  sort?: string;
  dir?: "asc" | "desc";
}) {
  const search = new URLSearchParams();
  search.set("version", params.version);
  if (params.value) {
    search.set("value", params.value);
  }
  search.set("page", String(params.page || 1));
  search.set("per_page", String(params.perPage || 8));
  if (params.sort) {
    search.set("sort", params.sort);
    search.set("dir", params.dir || "asc");
  }

  const response = await apiFetch(`/api/fahui_router/orders/search?${search.toString()}`, {
    credentials: "include",
  });

  return parseJson<YlpOrderListResponse>(response);
}

export async function fetchYlpOrderDetail(orderId: number) {
  const response = await apiFetch(`/api/fahui_router/orders/${orderId}`, {
    credentials: "include",
  });

  return parseJson<YlpOrderDetailResponse>(response);
}

export async function fetchYlpOrdersByPhone(phone: string) {
  const search = new URLSearchParams();
  search.set("phone", phone);

  const response = await apiFetch(`/api/fahui_router/orders/by-phone?${search.toString()}`, {
    credentials: "include",
  });

  return parseJson<YlpOrdersByPhoneResponse>(response);
}

export async function createYlpOrder(payload: {
  name: string;
  customer_name?: string;
  phone: string;
  email?: string;
  /** 登记页固定传今年的 `YYYY_YLP`；后端同样锁死今年，这里只是显式表明意图。 */
  version?: string;
  /** true = 就算同名同号也另开一张，不去重（避免第二张单覆盖第一张）。 */
  force_new?: boolean;
}) {
  const response = await apiFetch("/api/fahui_router/orders", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return parseJson<YlpOrderCreateResponse>(response);
}

export async function createYlpOrderItem(orderId: number, payload: Record<string, unknown>) {
  const response = await apiFetch(`/api/board_router/orders/${orderId}/items`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return parseJson<YlpOrderItemMutationResponse>(response);
}

export async function deleteYlpOrderItem(orderId: number, itemId: number) {
  const response = await apiFetch(`/api/board_router/orders/${orderId}/items/${itemId}`, {
    method: "DELETE",
    credentials: "include",
  });

  return parseJson<YlpOrderItemMutationResponse>(response);
}

export async function updateYlpOrderItem(orderId: number, itemId: number, payload: Record<string, unknown>) {
  const response = await apiFetch(`/api/board_router/orders/${orderId}/items/${itemId}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return parseJson<YlpOrderItemMutationResponse>(response);
}

export async function updateYlpOrderCustomer(
  orderId: number,
  payload: {
    customer_name?: string;
    email?: string;
    phone?: string;
  },
) {
  const response = await apiFetch(`/api/board_router/orders/${orderId}/customer`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return parseJson<{ success?: boolean; message?: string }>(response);
}

export async function createYlpOrderPayment(
  orderId: number,
  paymentMode: string,
  file?: File | null,
  amount?: string | number | null,
) {
  const formData = new FormData();
  formData.append("payment_mode", paymentMode);
  // 不传就按订单总额入账（后端默认值），传了就以这个金额为准
  if (amount !== undefined && amount !== null && String(amount).trim() !== "") {
    formData.append("amount", String(amount).trim());
  }
  if (file) {
    formData.append("file", file);
  }

  const response = await apiFetch(`/api/payment/orders/${orderId}/payments`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  return parseJson<{ success?: boolean; message?: string; payment_id?: number }>(response);
}

export async function downloadYlpReceiptImage(orderId: number) {
  const response = await apiFetch(`/api/payment/orders/${orderId}/receipt-image`, {
    credentials: "include",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message || "下载收据失败");
  }

  return response.blob();
}

export type YlpPrintRecordOrder = {
  order_id: number;
  customer_name?: string | null;
  owner_or_deceased?: string | null;
};

export type YlpPrintRecord = {
  id: number;
  created_at?: string | null;
  orders?: YlpPrintRecordOrder[] | null;
  boards?: { board_id: number; board_name?: string | null; location?: number | null }[] | null;
};

export async function listYlpPrintRecords(version: string, page = 1, perPage = 20) {
  const search = new URLSearchParams();
  search.set("version", version);
  search.set("page", String(page));
  search.set("per_page", String(perPage));

  const response = await apiFetch(`/api/board_router/print-pdfs/history?${search.toString()}`, {
    credentials: "include",
  });

  return parseJson<{
    success?: boolean;
    message?: string;
    items?: YlpPrintRecord[];
    pagination?: YlpPagination;
  }>(response);
}

export async function createYlpShareLink(orderId: number) {
  const response = await apiFetch(`/api/fahui_router/orders/${orderId}/share-link`, {
    method: "POST",
    credentials: "include",
  });

  return parseJson<{ status?: string; message?: string; token?: string; expires_in?: number }>(response);
}

export async function fetchYlpSharedOrder(token: string) {
  const search = new URLSearchParams();
  search.set("token", token);

  const response = await apiFetch(`/api/fahui_router/orders/shared?${search.toString()}`, {
    credentials: "include",
  });

  return parseJson<YlpOrderDetailResponse>(response);
}

export async function deleteYlpOrdersBatch(orderIds: number[]) {
  const response = await apiFetch("/api/board_router/orders/delete", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ order_ids: orderIds }),
  });

  return parseJson<{ status?: string; message?: string; marked?: number; deleted?: number }>(response);
}

export async function copyYlpOrdersToCurrent(orderIds: number[]) {
  const response = await apiFetch("/api/board_router/orders/copy-to-current", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ order_ids: orderIds }),
  });

  return parseJson<{
    success?: boolean;
    message?: string;
    version?: string;
    copied?: { old_id: number; new_id: number }[];
    skipped?: { id: number; reason: string }[];
  }>(response);
}

export async function updateYlpOrderStatus(orderId: number, status: string) {
  const response = await apiFetch(`/api/board_router/orders/${orderId}/status`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });

  return parseJson<{ success?: boolean; message?: string; status?: string }>(response);
}

export async function fetchYlpPayments(orderId: number) {
  const response = await apiFetch(`/api/payment/orders/${orderId}/payments`, {
    credentials: "include",
  });

  if (response.status === 404) {
    return [] as YlpPaymentRecord[];
  }

  const payload = await parseJson<{ data?: YlpPaymentRecord[] }>(response);
  return payload.data || [];
}

// 注：整份 PDF 的单订单预览接口（GET /api/print_paiwei/orders/<id>/preview）后端仍在，
// 但前端已全部改用 PaiweiPreviewGrid（逐张裁切图），这里不再保留封装。

export async function downloadYlpPaiwei(orderId: number) {
  const response = await apiFetch("/api/print_paiwei/preview/by-orders", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      order_ids: [orderId],
      need_barcode: false,
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
    };
    throw new Error(payload.error || payload.message || "下载牌位失败");
  }

  return {
    blob: await response.blob(),
    filename: getDownloadFilename(response, `order_${orderId}_paiwei.zip`),
  };
}

export async function listYlpPaymentChannels(version: string) {
  const response = await apiFetch(
    `/api/board_router/payment-channels?version=${encodeURIComponent(version)}`,
    { credentials: "include" },
  );
  return parseJson<YlpPaymentChannelListResponse>(response);
}

export async function createYlpPaymentChannel(formData: FormData) {
  const response = await apiFetch("/api/board_router/payment-channels", {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  return parseJson<YlpPaymentChannelMutationResponse>(response);
}

export async function updateYlpPaymentChannel(channelId: number, formData: FormData) {
  const response = await apiFetch(`/api/board_router/payment-channels/${channelId}`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  return parseJson<YlpPaymentChannelMutationResponse>(response);
}

export async function deleteYlpPaymentChannel(channelId: number) {
  const response = await apiFetch(`/api/board_router/payment-channels/${channelId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function fetchYlpOrderLogs(orderId: number) {
  const response = await apiFetch(`/api/board_router/orders/${orderId}/logs`, {
    credentials: "include",
  });
  return parseJson<YlpOrderLogResponse>(response);
}

export async function previewYlpPaiweiImages(orderIds: number[]) {
  const response = await apiFetch("/api/print_paiwei/orders/paiwei-preview", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order_ids: orderIds }),
  });
  return parseJson<YlpPaiweiPreviewResponse>(response);
}

export async function createYlpGroupPayment(formData: FormData) {
  const response = await apiFetch("/api/payment/orders/group-payment", {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  return parseJson<{
    success?: boolean;
    message?: string;
    payment_id?: number;
    total_price?: number;
    order_ids?: number[];
  }>(response);
}

export async function listYlpRelationOptions() {
  const response = await apiFetch("/api/board_router/relation-options", { credentials: "include" });
  return parseJson<YlpRelationOptionListResponse>(response);
}

export async function createYlpRelationOption(label: string) {
  const response = await apiFetch("/api/board_router/relation-options", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function importYlpRelationOptions() {
  const response = await apiFetch("/api/board_router/relation-options/import", {
    method: "POST",
    credentials: "include",
  });
  return parseJson<YlpRelationOptionListResponse>(response);
}

export async function deleteYlpRelationOption(optionId: number) {
  const response = await apiFetch(`/api/board_router/relation-options/${optionId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function listYlpOrdersForExport(version: string, value = "") {
  const search = new URLSearchParams();
  search.set("version", version);
  if (value) search.set("value", value);
  const response = await apiFetch(`/api/fahui_router/orders/export?${search.toString()}`, {
    credentials: "include",
  });
  return parseJson<{ status?: string; data?: { items: YlpOrderSummary[]; total: number } }>(response);
}

export async function printYlpPaiweiByTemplate(orderIds: number[], template: string) {
  const response = await apiFetch("/api/print_paiwei/preview/by-template", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order_ids: orderIds, template, need_barcode: false }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(payload.error || payload.message || "生成牌位失败");
  }
  return response.blob();
}

export async function startYlpPaiweiJob(orderIds: number[], template: string, needBarcode = false) {
  const response = await apiFetch("/api/print_paiwei/jobs/by-template", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order_ids: orderIds, template, need_barcode: needBarcode }),
  });
  return parseJson<{ status?: string; job_id?: string; room?: string; message?: string }>(response);
}

export async function downloadYlpPaiweiJob(jobId: string) {
  const response = await apiFetch(`/api/print_paiwei/jobs/${jobId}/download`, { credentials: "include" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message || "下载失败");
  }
  return response.blob();
}

export async function getYlpPaiweiJobStatus(jobId: string) {
  const response = await apiFetch(`/api/print_paiwei/jobs/${jobId}`, { credentials: "include" });
  return parseJson<{
    status?: string;
    message?: string;
    data?: { status?: string; progress?: string; total?: string; done?: string; message?: string };
  }>(response);
}

export type FahuiOpenWindow = {
  id: number;
  fahui_key: string;
  start_md: string;
  end_md: string;
  note?: string | null;
};

export type FahuiOpenWindowStatus = {
  fahui_key: string;
  today_md: string;
  is_open: boolean;
  windows: FahuiOpenWindow[];
};

export async function fetchFahuiOpenWindows(key: "ylp" | "lamp") {
  const response = await apiFetch(`/api/fahui_router/open_windows?key=${key}`, { credentials: "include" });
  return parseJson<{ status?: string; data: FahuiOpenWindowStatus }>(response);
}

export async function createFahuiOpenWindow(payload: { fahui_key: "ylp" | "lamp"; start_md: string; end_md: string; note?: string }) {
  const response = await apiFetch("/api/fahui_router/open_windows", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; data: FahuiOpenWindow }>(response);
}

export async function deleteFahuiOpenWindow(windowId: number) {
  const response = await apiFetch(`/api/fahui_router/open_windows/${windowId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ status?: string }>(response);
}

export type FahuiOpenWindowAllStatus = {
  today_md: string;
  items: FahuiOpenWindowStatus[];
};

export async function fetchAllFahuiOpenWindows() {
  const response = await apiFetch("/api/fahui_router/open_windows", { credentials: "include" });
  return parseJson<{ status?: string; data: FahuiOpenWindowAllStatus }>(response);
}
