import type {
  ClaimRecord,
  ClaimListResponse,
  PaymentVoucherPublicPayload,
  PaymentVoucherSharePayload,
  ReadBillUploadResponse,
} from "./types";
import { apiFetch } from "../../../../js/apiFetch";
import type { serializeLineItems } from "./lineItems";

export type ReadBillModel = "auto" | "byteplus" | "local";

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
  return parseJson<{ request_id?: number; data?: ClaimRecord }>(response);
}

export async function readClaimBill(
  file: File,
  model: ReadBillModel = "auto",
  options: { debug?: boolean } = {},
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", model);
  if (options.debug) {
    formData.append("debug", "true");
  }
  const response = await apiFetch("/api/account/claim/read_bill", {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  return parseJson<ReadBillUploadResponse>(response);
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

export async function deleteClaim(requestId: number) {
  const response = await apiFetch(`/api/account/delete_claim/${requestId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function downloadClaimReport(claimIds: number[]) {
  const response = await apiFetch("/api/account/claim/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ claim_ids: claimIds }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(data.error || data.message || "导出 Report 失败");
  }
  return response.blob();
}

export async function downloadPaymentVoucher(requestId: number) {
  const response = await apiFetch(`/api/account/print_payment_voucher/download_payment_voucher/${requestId}`, {
    credentials: "include",
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(data.error || data.message || "下载 Payment Voucher 失败");
  }
  return response.blob();
}

export async function deleteClaimAttachment(attachmentId: number) {
  const response = await apiFetch(`/api/account/claim/attachments/${attachmentId}`, {
    method: "DELETE",
    credentials: "include",
  });
  const payload = await parseJson<{ data?: ClaimRecord }>(response);
  if (!payload.data) {
    throw new Error("申请数据缺失");
  }
  return payload.data;
}

export async function updateClaimEvent(requestId: number, eventId: number | null) {
  const response = await apiFetch(`/api/account/claim/${requestId}/event`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ event_id: eventId }),
  });
  const payload = await parseJson<{ data?: ClaimRecord }>(response);
  if (!payload.data) {
    throw new Error("申请数据缺失");
  }
  return payload.data;
}

// 批准人撤回自己的审批签名（撤回后申请解除「已批准锁定」，可再编辑/删除）。
export async function withdrawClaimDecision(requestId: number) {
  const response = await apiFetch(`/api/account/claim/${requestId}/withdraw_decision`, {
    method: "POST",
    credentials: "include",
  });
  const payload = await parseJson<{ data?: ClaimRecord; message?: string }>(response);
  if (!payload.data) {
    throw new Error("申请数据缺失");
  }
  return payload.data;
}

export async function updateClaim(
  requestId: number,
  payload: Partial<
    Pick<
      ClaimRecord,
      | "applicant_name"
      | "amount"
      | "request_date"
      | "department_name"
      | "purpose"
      | "vendor_name"
      | "vendor_address"
      | "vendor_contact_number"
      | "purchase_datetime"
      | "event_id"
    >
  > & {
    // 传了就整组替换明细，后端会把整单金额重算成合计
    line_items?: ReturnType<typeof serializeLineItems>;
  },
) {
  const response = await apiFetch(`/api/account/claim/${requestId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ data?: ClaimRecord }>(response);
  if (!data.data) {
    throw new Error("申请数据缺失");
  }
  return data.data;
}

export async function uploadClaimAttachments(requestId: number, files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  const response = await apiFetch(`/api/account/claim/${requestId}/attachments`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  const payload = await parseJson<{ data?: ClaimRecord }>(response);
  if (!payload.data) {
    throw new Error("申请数据缺失");
  }
  return payload.data;
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
