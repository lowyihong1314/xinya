import type {
  ExtraFieldConfig,
  FormCreatePayload,
  FormDetailResponse,
  FormFee,
  FormListResponse,
  FormRecord,
} from "./types";

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
  const response = await fetch("/api/form/get_all_form", {
    credentials: "include",
  });
  return parseJson<FormListResponse>(response);
}

export async function fetchFormDetail(formId: number) {
  const response = await fetch(`/api/form/get_form/${formId}`, {
    credentials: "include",
  });
  return parseJson<FormDetailResponse | FormRecord>(response);
}

export async function createForm(payload: FormCreatePayload) {
  const response = await fetch("/api/form/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function editForm(formId: number, payload: Partial<FormRecord>) {
  const response = await fetch(`/api/form/edit_form/${formId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function removeForm(formId: number) {
  const response = await fetch("/api/form/remove_form", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ form_id: formId }),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function listFees(formId: number) {
  const response = await fetch(`/api/form/fee/list/${formId}`, {
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
  const response = await fetch(`/api/form/fee/add/${formId}`, {
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
  const response = await fetch(`/api/form/fee/edit/${feeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function deleteFee(feeId: number) {
  const response = await fetch(`/api/form/fee/delete/${feeId}`, {
    method: "DELETE",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function uploadFeeImage(file: File) {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch("/api/form/fee/upload_image", {
    method: "POST",
    body: formData,
  });
  return parseJson<{ status?: string; image_path?: string; message?: string }>(response);
}

export async function listExtraFields(formId: number) {
  const response = await fetch(`/api/form/extra_field/list/${formId}`, {
    credentials: "include",
  });
  return parseJson<ExtraFieldConfig[] | { fields?: ExtraFieldConfig[] }>(response);
}

export async function addExtraField(
  formId: number,
  payload: { label: string; field_type: string; options?: string[] | null; order?: number | null },
) {
  const response = await fetch(`/api/form/extra_field/add/${formId}`, {
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
  const response = await fetch(`/api/form/extra_field/edit/${fieldId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function deleteExtraField(fieldId: number) {
  const response = await fetch(`/api/form/extra_field/delete/${fieldId}`, {
    method: "DELETE",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function addEventToForm(formId: number, eventId: number) {
  const response = await fetch(`/api/form/add_event/${formId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_id: eventId }),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function removeEventFromForm(formId: number, eventId: number) {
  const response = await fetch(`/api/form/remove_event/${formId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_id: eventId }),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function removeMemberFromForm(formId: number, memberId: number) {
  const response = await fetch("/api/form/remove_regis_form_member", {
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
  const response = await fetch("/api/form/edit_member", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}
