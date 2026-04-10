import type { AboutEntry, HistoryEntry, TreeHoleEntry } from "./types";
import { apiFetch } from "../../js/apiFetch";

async function parseJson<T = unknown>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error((data as { error?: string; message?: string }).error || (data as { error?: string; message?: string }).message || "Request failed");
  }
  return data as T;
}

export async function fetchHeroImage() {
  const response = await apiFetch("/media/get_event_image/14574/cache");
  return parseJson(response);
}

export async function fetchAboutEntries(): Promise<AboutEntry[]> {
  const response = await apiFetch("/api/info/get_about_us_text");
  return parseJson(response);
}

export async function fetchHistoryEntries(): Promise<HistoryEntry[]> {
  const response = await apiFetch("/api/info/get_our_history");
  return parseJson(response);
}

export async function saveAboutEntry(input: { id?: number; text: string }) {
  const formData = new FormData();
  if (input.id) formData.append("id", String(input.id));
  formData.append("text", input.text);
  const response = await apiFetch("/api/info/about_us_text", {
    method: "POST",
    body: formData,
  });
  return parseJson(response);
}

export async function deleteAboutEntry(id: number) {
  const response = await apiFetch("/api/info/about_us_text", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return parseJson(response);
}

export async function saveHistoryEntry(input: {
  id?: number;
  text: string;
  date: string;
  image?: File | null;
  remove_image?: boolean;
}) {
  const formData = new FormData();
  if (input.id) formData.append("id", String(input.id));
  formData.append("text", input.text);
  formData.append("date", input.date);
  if (input.image) {
    formData.append("image", input.image);
  }
  if (input.remove_image) {
    formData.append("remove_image", "true");
  }
  const response = await apiFetch("/api/info/add_our_history", {
    method: "POST",
    body: formData,
  });
  return parseJson(response);
}

export async function deleteHistoryEntry(id: number) {
  const response = await apiFetch("/api/info/add_our_history", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return parseJson(response);
}

export async function fetchTreeHoleEntries(): Promise<TreeHoleEntry[]> {
  const response = await apiFetch("/api/info/tree_hole/messages", {
    credentials: "include",
  });
  return parseJson(response);
}

export async function createTreeHoleEntry(input: { author_name?: string; message: string }) {
  const response = await apiFetch("/api/info/tree_hole/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  return parseJson<{ success?: boolean; message?: string }>(response);
}

export async function updateTreeHoleEntry(
  id: number,
  input: { author_name?: string; message: string; display: boolean; is_spam: boolean },
) {
  const response = await apiFetch(`/api/info/tree_hole/messages/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  return parseJson<{ success?: boolean; message?: string; data?: TreeHoleEntry }>(response);
}

export async function deleteTreeHoleEntry(id: number) {
  const response = await apiFetch(`/api/info/tree_hole/messages/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ success?: boolean; message?: string }>(response);
}
