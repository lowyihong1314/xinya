import type {
  EventCheckInMutationResponse,
  EventDetailResponse,
  EventFlowListResponse,
  EventFlowMutationResponse,
  EventListMutationResponse,
  EventMediaUploadResponse,
  EventSortResponse,
  SharedEventRecord,
} from "./types";

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || data.message || "请求失败");
  }
  return data;
}

export async function fetchAllEventsSorted() {
  const response = await fetch("/api/event_data/get_all_event_sort", {
    credentials: "include",
  });
  return parseJson<EventSortResponse>(response);
}

export async function fetchEventDetail(eventId: number | string) {
  const response = await fetch(`/api/api/get_event/${eventId}`, {
    credentials: "include",
  });
  return parseJson<EventDetailResponse>(response);
}

export async function saveEvent(
  payload: Partial<SharedEventRecord> & { event_id: number; end_datetime?: string | null },
) {
  const response = await fetch("/api/event_data/new_event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<EventListMutationResponse>(response);
}

export async function setEventPoster(eventId: number, fileId: number) {
  const response = await fetch(`/api/event_data/set_poster/${eventId}/${fileId}`, {
    method: "POST",
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function fetchEventFlows(eventId: number | string) {
  const response = await fetch(`/api/event_data/event_flow/list/${eventId}`, {
    credentials: "include",
  });
  return parseJson<EventFlowListResponse>(response);
}

export async function createEventFlow(payload: Record<string, unknown>) {
  const response = await fetch("/api/event_data/event_flow/new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<EventFlowMutationResponse>(response);
}

export async function updateEventFlow(flowId: number, payload: Record<string, unknown>) {
  const response = await fetch(`/api/event_data/event_flow/update/${flowId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<EventFlowMutationResponse>(response);
}

export async function deleteEventFlow(flowId: number) {
  const response = await fetch(`/api/event_data/event_flow/delete/${flowId}`, {
    method: "POST",
    credentials: "include",
  });
  return parseJson<EventFlowMutationResponse>(response);
}

export async function reorderEventFlows(eventId: number, flowIds: number[]) {
  const response = await fetch("/api/event_data/event_flow/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ event_id: eventId, flow_ids: flowIds }),
  });
  return parseJson<EventFlowMutationResponse>(response);
}

export async function uploadEventMedia(eventId: number, file: File) {
  const formData = new FormData();
  formData.append("event_id", String(eventId));
  formData.append("file", file);

  const response = await fetch("/media/upload_media", {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  const payload = await parseJson<EventMediaUploadResponse>(response);
  const uploadRecord = payload.data || payload;
  const videoTypes = new Set(["mp4", "mov", "avi", "mkv", "webm"]);
  if (uploadRecord.file_id && uploadRecord.file_type && videoTypes.has(uploadRecord.file_type)) {
    window.setTimeout(() => {
      void fetch(`/media/get_event_image/${uploadRecord.file_id}/cache`, {
        credentials: "include",
      });
    }, 200);
  }

  return payload;
}

export async function uploadEventBrochure(eventId: number, file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`/api/event_data/upload_brochure/${eventId}`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  return parseJson<EventListMutationResponse>(response);
}

export async function saveEventCheckIn(payload: {
  event_id: number;
  user_id: number;
  check_in_date: string;
  check_in_time?: string;
  valid_user_id?: number | null;
}) {
  const response = await fetch("/api/event_data/check_in/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<EventCheckInMutationResponse>(response);
}

export async function deleteEventCheckIn(checkInId: number) {
  const response = await fetch(`/api/event_data/check_in/delete/${checkInId}`, {
    method: "POST",
    credentials: "include",
  });
  return parseJson<EventCheckInMutationResponse>(response);
}
