import type { EventCreatePayload, EventListResponse, EventMutationPayload, EventRecord } from "./types";

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
  const response = await fetch("/api/event_data/get_all_event_sort", {
    credentials: "include",
  });
  return parseJson<EventListResponse>(response);
}

export async function saveEvent(payload: EventMutationPayload & { event_id: number }) {
  const response = await fetch("/api/event_data/new_event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; data?: EventRecord; message?: string }>(response);
}

export async function createEvent(payload: EventCreatePayload) {
  const response = await fetch("/api/event_data/new_event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; data?: EventRecord; message?: string }>(response);
}

export async function deleteEvent(eventId: number) {
  const response = await fetch(`/api/event_data/delete_event/${eventId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function uploadEventBrochure(eventId: number, file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`/api/event_data/upload_brochure/${eventId}`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  return parseJson<{ status?: string; data?: EventRecord; message?: string }>(response);
}
