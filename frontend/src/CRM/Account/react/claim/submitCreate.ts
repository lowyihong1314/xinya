// 报销「新建申请」的共享提交逻辑：初始状态 / 校验 / 组 FormData / 提交。
// 供 finance 的 ClaimWorkspace 与预算 tab 的 ClaimCreateModal 复用，避免重复。
import { submitClaim } from "./api";
import type { CreateState } from "./ClaimCreateForm";
import { emptyLineItems, lineItemsTotal, serializeLineItems, validateLineItems } from "./lineItems";
import type { AccountUser } from "./types";

export function todayIsoDate(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function buildInitialCreateState(user: AccountUser | null): CreateState {
  return {
    applicant_name: String(user?.display_name || user?.name_NRIC || user?.username || ""),
    request_date: todayIsoDate(),
    department_name: user?.departments?.[0]?.name || "",
    acctDept: "",
    purpose: "",
    lineItems: emptyLineItems(),
    vendor_name: "",
    vendor_address: "",
    vendor_contact_number: "",
    purchase_datetime: "",
    selectedEvent: null,
    files: [],
    signJsonData: null,
  };
}

export function validateCreateState(s: CreateState): string | null {
  if (!s.signJsonData?.strokes?.length) return "请先签名";
  if (!s.applicant_name.trim()) return "请填写姓名";
  if (!s.request_date) return "请选择日期";
  if (!s.department_name.trim()) return "请选择部门";
  return validateLineItems(s.lineItems);
}

export function buildClaimFormData(
  s: CreateState,
  user: AccountUser | null,
  extra?: { eventBudgetId?: number | null },
): FormData {
  const fd = new FormData();
  fd.append(
    "sign_json_data",
    JSON.stringify({
      version: 1,
      signed_at: new Date().toISOString(),
      signed_by_user_id: user?.id || null,
      signed_by_username: user?.username || null,
      signed_by_name: user?.display_name || user?.name_NRIC || null,
      strokes: s.signJsonData?.strokes,
    }),
  );
  fd.append("applicant_name", s.applicant_name.trim());
  fd.append("request_date", s.request_date);
  // 金额以明细合计为准，后端也会自己再算一次
  fd.append("amount", lineItemsTotal(s.lineItems).toFixed(2));
  fd.append("department_name", s.department_name.trim());
  fd.append("line_items", JSON.stringify(serializeLineItems(s.lineItems)));
  const purpose = s.purpose.trim();
  fd.append("purpose", s.acctDept ? `【做账分配：${s.acctDept}】${purpose ? `\n${purpose}` : ""}` : purpose);
  if (s.vendor_name.trim()) fd.append("vendor_name", s.vendor_name.trim());
  if (s.vendor_address.trim()) fd.append("vendor_address", s.vendor_address.trim());
  if (s.vendor_contact_number.trim()) fd.append("vendor_contact_number", s.vendor_contact_number.trim());
  if (s.purchase_datetime) fd.append("purchase_datetime", s.purchase_datetime);
  if (s.selectedEvent?.id) fd.append("event_id", String(s.selectedEvent.id));
  if (extra?.eventBudgetId) fd.append("event_budget_id", String(extra.eventBudgetId));
  s.files.forEach((file) => fd.append("files", file));
  return fd;
}

export async function submitCreateClaim(
  s: CreateState,
  user: AccountUser | null,
  extra?: { eventBudgetId?: number | null },
) {
  return submitClaim(buildClaimFormData(s, user, extra));
}
