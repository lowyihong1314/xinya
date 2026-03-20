import type { PaymentListResponse } from "./types";

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

export async function fetchPayments() {
  const response = await fetch("/api/lampRegistration_API/get_all_register_by_payment", {
    credentials: "include",
  });

  return parseJson<PaymentListResponse>(response);
}

export async function approvePayment(paymentId: number) {
  const response = await fetch("/api/lampRegistration_API/approve_payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: paymentId }),
  });

  return parseJson<{ message?: string; status?: string }>(response);
}

export async function removePayment(paymentId: number) {
  const response = await fetch("/api/lampRegistration_API/remove_payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: paymentId }),
  });

  return parseJson<{ message?: string; status?: string }>(response);
}
