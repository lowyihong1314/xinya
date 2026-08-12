import type {
  EventAttachmentRecord,
  EventCreatePayload,
  EventListResponse,
  EventMutationPayload,
  EventRecord,
} from "./types";
import { apiFetch } from "../../../js/apiFetch";
import { setEventPoster as setSharedEventPoster, uploadEventMedia } from "../../../event/shared/api";
import type { EventMediaUploadResponse } from "../../../event/shared/types";

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & {
    status?: string;
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || data.message || "请求失败");
  }
  return data;
}

export async function fetchAllEvents() {
  const response = await apiFetch("/api/event_data/get_all_event_sort", {
    credentials: "include",
  });
  return parseJson<EventListResponse>(response);
}

export async function saveEvent(payload: EventMutationPayload & { event_id: number }) {
  const response = await apiFetch("/api/event_data/new_event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; data?: EventRecord; message?: string }>(response);
}

export async function createEvent(payload: EventCreatePayload) {
  const response = await apiFetch("/api/event_data/new_event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; data?: EventRecord; message?: string }>(response);
}

export async function saveEventUnit(params: {
  eventId?: number;
  unitId?: number;
  role: string;
  unitName: string;
  logo?: File | null;
}) {
  const formData = new FormData();
  if (params.eventId) formData.append("event_id", String(params.eventId));
  if (params.unitId) formData.append("unit_id", String(params.unitId));
  formData.append("role", params.role);
  formData.append("unit_name", params.unitName);
  if (params.logo) formData.append("logo", params.logo);

  const response = await apiFetch("/api/event_data/units/save", {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  return parseJson<{ status?: string; message?: string; data?: unknown }>(response);
}

export async function deleteEventUnit(unitId: number) {
  const response = await apiFetch(`/api/event_data/units/delete/${unitId}`, {
    method: "POST",
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function deleteEvent(eventId: number) {
  const response = await apiFetch(`/api/event_data/delete_event/${eventId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function uploadEventBrochure(eventId: number, file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiFetch(`/api/event_data/upload_brochure/${eventId}`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  return parseJson<{ status?: string; data?: EventRecord; message?: string }>(response);
}

export async function setEventPosterFile(eventId: number, fileId: number) {
  return setSharedEventPoster(eventId, fileId);
}

export async function setEventBrochure(eventId: number, fileId: number | null) {
  const response = await apiFetch(`/api/event_data/set_brochure/${eventId}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });

  return parseJson<{ status?: string; data?: EventRecord; message?: string }>(response);
}

export async function uploadEventFile(eventId: number, file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiFetch(`/api/event_data/event_file/upload/${eventId}`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  return parseJson<{ status?: string; data?: EventAttachmentRecord; message?: string }>(response);
}

function extractUploadedFileId(payload: EventMediaUploadResponse) {
  if (typeof payload.data?.file_id === "number") {
    return payload.data.file_id;
  }
  return typeof payload.file_id === "number" ? payload.file_id : null;
}

export async function uploadEventPoster(eventId: number, file: File) {
  const payload = await uploadEventMedia(eventId, file);
  const fileId = extractUploadedFileId(payload);
  if (!fileId) {
    throw new Error(payload.message || "上传成功，但没有拿到海报文件");
  }
  await setSharedEventPoster(eventId, fileId);
  return { fileId, message: payload.message };
}

export async function deleteEventFile(fileId: number) {
  const response = await apiFetch(`/api/event_data/event_file/delete/${fileId}`, {
    method: "POST",
    credentials: "include",
  });

  return parseJson<{ status?: string; id?: number; message?: string }>(response);
}
