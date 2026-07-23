import type {
  AttendanceSnapshot,
  ExtraFieldConfig,
  FormCreatePayload,
  FormDetailResponse,
  FormFee,
  FormGroup,
  GroupChatMessage,
  GroupPlan,
  FormListResponse,
  FormPayment,
  FormRecord,
} from "./types";
import { apiFetch } from "../../../js/apiFetch";

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

export async function fetchForms() {
  const response = await apiFetch("/api/form/get_all_form", {
    credentials: "include",
  });
  return parseJson<FormListResponse>(response);
}

export async function fetchFormDetail(formId: number) {
  const response = await apiFetch(`/api/form/get_form/${formId}`, {
    credentials: "include",
  });
  return parseJson<FormDetailResponse | FormRecord>(response);
}

export async function createForm(payload: FormCreatePayload) {
  const response = await apiFetch("/api/form/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function editForm(formId: number, payload: Partial<FormRecord>) {
  const response = await apiFetch(`/api/form/edit_form/${formId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function removeForm(formId: number) {
  const response = await apiFetch("/api/form/remove_form", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ form_id: formId }),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function listFees(formId: number) {
  const response = await apiFetch(`/api/form/fee/list/${formId}`, {
    credentials: "include",
  });
  return parseJson<FormFee[] | { fees?: FormFee[] }>(response);
}

export async function addFee(
  formId: number,
  payload: {
    category: string;
    amount: string;
    age_range_from?: string;
    age_range_to?: string;
    description?: string;
    image_path?: string | null;
  },
) {
  const response = await apiFetch(`/api/form/fee/add/${formId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function editFee(
  feeId: number,
  payload: {
    category: string;
    amount: string;
    age_range_from?: string;
    age_range_to?: string;
    description?: string;
    image_path?: string | null;
  },
) {
  const response = await apiFetch(`/api/form/fee/edit/${feeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function deleteFee(feeId: number) {
  const response = await apiFetch(`/api/form/fee/delete/${feeId}`, {
    method: "DELETE",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function uploadFeeImage(file: File) {
  const formData = new FormData();
  formData.append("image", file);

  const response = await apiFetch("/api/form/fee/upload_image", {
    method: "POST",
    body: formData,
  });
  return parseJson<{ status?: string; image_path?: string; message?: string }>(response);
}

export async function listExtraFields(formId: number) {
  const response = await apiFetch(`/api/form/extra_field/list/${formId}`, {
    credentials: "include",
  });
  return parseJson<ExtraFieldConfig[] | { fields?: ExtraFieldConfig[] }>(response);
}

export async function addExtraField(
  formId: number,
  payload: { label: string; field_type: string; options?: string[] | null; order?: number | null },
) {
  const response = await apiFetch(`/api/form/extra_field/add/${formId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function editExtraField(
  fieldId: number,
  payload: { label: string; field_type: string; options?: string[] | null; order?: number | null },
) {
  const response = await apiFetch(`/api/form/extra_field/edit/${fieldId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function deleteExtraField(fieldId: number) {
  const response = await apiFetch(`/api/form/extra_field/delete/${fieldId}`, {
    method: "DELETE",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function addEventToForm(formId: number, eventId: number) {
  const response = await apiFetch(`/api/form/add_event/${formId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_id: eventId }),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function removeEventFromForm(formId: number, eventId: number) {
  const response = await apiFetch(`/api/form/remove_event/${formId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_id: eventId }),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function listGroups(formId: number) {
  const response = await apiFetch(`/api/form/group/list/${formId}`, {
    credentials: "include",
  });
  return parseJson<{ groups?: FormGroup[] } | FormGroup[]>(response);
}

export async function createGroup(formId: number, name: string) {
  const response = await apiFetch(`/api/form/group/create/${formId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parseJson<{ status?: string; group?: FormGroup; message?: string }>(response);
}

export async function renameGroup(groupId: number, name: string) {
  const response = await apiFetch(`/api/form/group/rename/${groupId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parseJson<{ status?: string; group?: FormGroup; message?: string }>(response);
}

export async function deleteGroup(groupId: number) {
  const response = await apiFetch(`/api/form/group/delete/${groupId}`, {
    method: "DELETE",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function aiGroupChat(formId: number, messages: GroupChatMessage[]) {
  const response = await apiFetch(`/api/form/group/ai_chat/${formId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  // 异步：返回 job_id + room；真正的回复由 socket 事件 ai_group_reply 推回。
  return parseJson<{ status?: string; job_id?: string; room?: string; message?: string }>(response);
}

export async function applyGroupPlan(formId: number, plan: GroupPlan) {
  const response = await apiFetch(`/api/form/group/apply_plan/${formId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  return parseJson<{ status?: string; assigned?: number; renamed?: number; deleted?: number; message?: string }>(response);
}

export async function listAttendance(formId: number) {
  const response = await apiFetch(`/api/form/attendance/list/${formId}`, { credentials: "include" });
  return parseJson<{ attendances?: AttendanceSnapshot[] }>(response);
}

export async function getAttendance(attendanceId: number) {
  const response = await apiFetch(`/api/form/attendance/get/${attendanceId}`, { credentials: "include" });
  return parseJson<{ attendance?: AttendanceSnapshot }>(response);
}

export async function createAttendance(formId: number, remark: string, presentIds: number[]) {
  const response = await apiFetch(`/api/form/attendance/create/${formId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remark, present_ids: presentIds }),
  });
  return parseJson<{ status?: string; attendance?: AttendanceSnapshot; message?: string }>(response);
}

export async function deleteAttendance(attendanceId: number) {
  const response = await apiFetch(`/api/form/attendance/delete/${attendanceId}`, { method: "DELETE" });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function assignMemberGroup(formId: number, memberId: number, groupId: number | null) {
  const response = await apiFetch("/api/form/group/assign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ form_id: formId, member_id: memberId, group_id: groupId }),
  });
  return parseJson<{ status?: string; message?: string; member_id?: number; group_id?: number | null }>(response);
}

export async function removeMemberFromForm(formId: number, memberId: number) {
  const response = await apiFetch("/api/form/remove_regis_form_member", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ form_id: formId, member_id: memberId }),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function editMemberField(payload: {
  form_id: number;
  member_id: number;
  field: string | number;
  value: unknown;
}) {
  const response = await apiFetch("/api/form/edit_member", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function createMemberPayment(
  formId: number,
  payload: { nric: string; fee_id: number; payment_mode: string },
  proofImage?: File | null,
) {
  const formData = new FormData();
  formData.append("nric", payload.nric);
  formData.append("fee_id", String(payload.fee_id));
  formData.append("payment_mode", payload.payment_mode);
  if (proofImage) {
    formData.append("proof_image", proofImage);
  }
  const response = await apiFetch(`/api/form/payment/create/${formId}`, {
    method: "POST",
    body: formData,
  });
  return parseJson<{ status?: string; message?: string; payment?: FormPayment }>(response);
}

export async function updateMemberPaymentStatus(
  paymentId: number,
  status: "process" | "checked" | "fail",
  counter?: string,
) {
  const response = await apiFetch(`/api/form/payment/update_status/${paymentId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(counter ? { status, counter } : { status }),
  });
  return parseJson<{ status?: string; message?: string; payment?: FormPayment }>(response);
}

export type MemberNricChangePreviewResponse = {
  status?: string;
  message?: string;
  member_id: number;
  old_nric: string;
  new_nric: string;
  mode?: "noop" | "update" | "merge";
  impact?: {
    registration_count?: number;
    form_ids?: number[];
    version_count?: number;
    payment_count?: number;
    youth_registration_count?: number;
    parental_reference_count?: number;
    duplicate_registration_count?: number;
    duplicate_form_ids?: number[];
    merged_registration_count?: number;
    merged_form_ids?: number[];
  };
  merge_target?: {
    id: number;
    nric: string;
    display_name: string;
  } | null;
};

export async function previewMemberNricChange(payload: { member_id: number; new_nric: string }) {
  const response = await apiFetch("/api/form/preview_member_nric_change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<MemberNricChangePreviewResponse>(response);
}
