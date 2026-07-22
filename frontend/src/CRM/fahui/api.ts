import type {
  PaymentActionResponse,
  PaymentListResponse,
  YlpOrderCreateResponse,
  YlpOrderDetailResponse,
  YlpOrderItemMutationResponse,
  YlpOrderListResponse,
  YlpOrderSummary,
  YlpOrdersByPhoneResponse,
  YlpPaymentChannelListResponse,
  YlpPaymentChannelMutationResponse,
  YlpPaymentRecord,
  YlpRelationOptionListResponse,
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

export async function searchYlpOrders(params: {
  version: string;
  value?: string;
  page?: number;
  perPage?: number;
}) {
  const search = new URLSearchParams();
  search.set("version", params.version);
  if (params.value) {
    search.set("value", params.value);
  }
  search.set("page", String(params.page || 1));
  search.set("per_page", String(params.perPage || 8));

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

export async function previewYlpPaiwei(orderId: number) {
  const response = await apiFetch(`/api/print_paiwei/orders/${orderId}/preview`, {
    credentials: "include",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(payload.error || payload.message || "预览牌位失败");
  }

  return response.blob();
}

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

export async function startYlpPaiweiJob(orderIds: number[], template: string) {
  const response = await apiFetch("/api/print_paiwei/jobs/by-template", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order_ids: orderIds, template }),
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
