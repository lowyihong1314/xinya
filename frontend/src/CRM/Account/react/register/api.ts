import type { FormListResponse, FormPayment, FormRecord } from "../../../form/react/types";

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
    status?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || data.message || "请求失败");
  }
  return data;
}

export async function fetchRegisterPaymentForms() {
  const response = await fetch("/api/form/get_all_form", {
    credentials: "include",
  });
  const payload = await parseJson<FormListResponse>(response);
  return Array.isArray(payload.forms) ? payload.forms : [];
}

export async function updateRegisterPaymentStatus(paymentId: number, status: FormPayment["status"]) {
  const response = await fetch(`/api/form/payment/update_status/${paymentId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return parseJson<{ status?: string; message?: string; payment?: FormPayment }>(response);
}

export type RegisterPaymentForm = FormRecord;
