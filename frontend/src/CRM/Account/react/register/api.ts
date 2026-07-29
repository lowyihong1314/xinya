import type { FormListResponse, FormPayment, FormRecord } from "../../../form/react/types";
import { apiFetch } from "../../../../js/apiFetch";
import type { FinancePayment } from "./types";

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
  const response = await apiFetch("/api/form/get_all_form", {
    credentials: "include",
  });
  const payload = await parseJson<FormListResponse>(response);
  return Array.isArray(payload.forms) ? payload.forms : [];
}

// 财政收款：跨 scope 的付款列表（报名表单 / 会员 / 青少年佛学班）。
export async function fetchFinancePayments(params?: { scope?: string; status?: string }) {
  const query = new URLSearchParams();
  if (params?.scope && params.scope !== "all") query.set("scope", params.scope);
  if (params?.status && params.status !== "all") query.set("status", params.status);
  const suffix = query.toString();
  const response = await apiFetch(`/api/account/payments${suffix ? `?${suffix}` : ""}`, {
    credentials: "include",
  });
  const payload = await parseJson<{ payments?: FinancePayment[] }>(response);
  return Array.isArray(payload.payments) ? payload.payments : [];
}

// 手动新建收款（目前只有捐赠收入），可选关联活动（event_id，与报销一致）。
export async function createManualFinancePayment(payload: {
  income_type: string;
  name: string;
  amount: number;
  phone?: string;
  payment_mode?: string;
  date?: string;
  event_id?: number | null;
  remark?: string;
}) {
  const response = await apiFetch("/api/account/payments/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; message?: string; payment?: FinancePayment }>(response);
}

export async function deleteManualFinancePayment(paymentId: number) {
  const response = await apiFetch(`/api/account/payments/manual/${paymentId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function updateFinancePaymentStatus(paymentId: number, status: string) {
  const response = await apiFetch(`/api/account/payments/${paymentId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ status }),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function updateRegisterPaymentStatus(paymentId: number, status: FormPayment["status"]) {
  const response = await apiFetch(`/api/form/payment/update_status/${paymentId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return parseJson<{ status?: string; message?: string; payment?: FormPayment }>(response);
}

export async function replaceRegisterPaymentProof(paymentId: number, file: File) {
  const formData = new FormData();
  formData.append("proof_image", file);
  const response = await apiFetch(`/api/form/payment/proof_image/${paymentId}/replace`, {
    method: "POST",
    body: formData,
  });
  return parseJson<{ status?: string; message?: string; payment?: FormPayment }>(response);
}

export async function deleteRegisterPayment(paymentId: number) {
  const response = await apiFetch(`/api/form/payment/${paymentId}`, {
    method: "DELETE",
  });
  return parseJson<{ status?: string; message?: string; payment_id?: number; regis_form_id?: number }>(response);
}

export async function downloadPaymentReport(paymentIds: number[]) {
  const response = await apiFetch("/api/account/payments/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ payment_ids: paymentIds }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(data.error || data.message || "导出 Report 失败");
  }
  return response.blob();
}

export type RegisterPaymentForm = FormRecord;
