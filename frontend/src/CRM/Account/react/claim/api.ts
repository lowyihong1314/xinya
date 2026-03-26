import type {
  ClaimListResponse,
  PaymentVoucherPublicPayload,
  PaymentVoucherSharePayload,
} from "./types";
import { apiFetch } from "../../../../js/apiFetch";

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(data.error || data.message || "请求失败");
  }
  return data;
}

export async function fetchClaims() {
  const response = await apiFetch("/api/account/get_all_claim", {
    credentials: "include",
  });
  return parseJson<ClaimListResponse>(response);
}

export async function submitClaim(formData: FormData) {
  const response = await apiFetch("/api/account/submit_new_claim", {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  return parseJson<{ request_id?: number }>(response);
}

export async function decideClaim(
  requestId: number,
  payload: { action: "approve" | "reject"; comment: string; sign_json_data?: unknown },
) {
  const response = await apiFetch(`/api/account/claim_decision/${requestId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<Record<string, unknown>>(response);
}

export async function fetchPaymentVoucherShare(requestId: number) {
  const response = await apiFetch(`/api/account/print_payment_voucher/share_payment_voucher/${requestId}`, {
    credentials: "include",
  });
  const payload = await parseJson<{ data?: PaymentVoucherSharePayload }>(response);
  if (!payload.data) {
    throw new Error("Payment Voucher 数据缺失");
  }
  return payload.data;
}

export async function fetchPublicPaymentVoucher(token: string) {
  const response = await apiFetch(`/api/account/print_payment_voucher/public/${token}`, {
    credentials: "include",
  });
  const payload = await parseJson<{ data?: PaymentVoucherPublicPayload }>(response);
  if (!payload.data) {
    throw new Error("Payment Voucher 数据缺失");
  }
  return payload.data;
}

export async function submitPublicPaymentVoucherSign(
  token: string,
  payload: { full_name: string; sign_json_data: unknown },
) {
  const response = await apiFetch(`/api/account/print_payment_voucher/public/${token}/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<{ data?: { download_url?: string } }>(response);
}
