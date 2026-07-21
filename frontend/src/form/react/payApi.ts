import { apiFetch } from "../../js/apiFetch";
import { API_BASE } from "../../js/apiBase";
import type { FormFee } from "../../CRM/form/react/types";

// Reuse the existing multipart create helper (apiFetch-based, APK-safe).
export { createMemberPayment } from "../../CRM/form/react/api";

export type QuoteMember = {
  name_cn?: string | null;
  name?: string | null;
  name_nric?: string | null;
} | null;

export type PaymentQuote = {
  status: string;
  message?: string;
  nric: string;
  age: number;
  is_member: boolean;
  member: QuoteMember;
  fees: FormFee[];
};

export async function fetchPaymentQuote(formId: number, nric: string): Promise<PaymentQuote> {
  const response = await apiFetch(
    `/api/form/payment_quote/${formId}?nric=${encodeURIComponent(nric)}`,
  );
  let data: Partial<PaymentQuote> = {};
  try {
    data = (await response.json()) as Partial<PaymentQuote>;
  } catch {
    data = {};
  }
  if (!response.ok || data.status !== "success") {
    throw new Error(data?.message || "查询付款选项失败，请稍后再试");
  }
  return data as PaymentQuote;
}

// fee.image_path / poster URLs are public "/static/..." or "/api/..." paths.
// Prefix API_BASE so they resolve inside the APK build too.
export function resolveStaticUrl(pathValue?: string | null): string {
  if (!pathValue) return "";
  if (/^https?:\/\//i.test(pathValue)) return pathValue;
  if (pathValue.startsWith("/")) return `${API_BASE}${pathValue}`;
  return pathValue;
}
