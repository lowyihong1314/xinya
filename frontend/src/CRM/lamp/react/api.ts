import { apiFetch } from "../../../js/apiFetch";
import type { LampListResponse, LampRegistrationRecord } from "./types";

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
    status?: string;
  };
  if (!response.ok || data.status === "error") {
    throw new Error(data.error || data.message || "请求失败");
  }
  return data;
}

export async function fetchLampRegistrations() {
  const response = await apiFetch("/api/lampRegistration_API/registrations", {
    credentials: "include",
  });
  return parseJson<LampListResponse>(response);
}

export async function updateLampRegistration(
  id: number,
  patch: Partial<Pick<LampRegistrationRecord, "devotee_name" | "phone" | "address" | "status">>,
) {
  const response = await apiFetch("/api/lampRegistration_API/edit", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...patch }),
  });
  return parseJson<{ status?: string; message?: string; data?: { id: number } }>(response);
}

export async function deleteLampRegistration(id: number) {
  const response = await apiFetch("/api/lampRegistration_API/delete", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}
