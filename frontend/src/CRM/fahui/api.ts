import type {
  PaymentActionResponse,
  PaymentListResponse,
  YlpOrderCreateResponse,
  YlpOrderDetailResponse,
  YlpOrderItemMutationResponse,
  YlpOrderListResponse,
  YlpOrdersByPhoneResponse,
  YlpPaymentRecord,
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
