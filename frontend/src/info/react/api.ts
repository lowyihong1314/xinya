import type { AboutEntry, HistoryEntry } from "./types";

async function parseJson(response: Response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || data.message || "Request failed");
  }
  return data;
}

export async function fetchHeroImage() {
  const response = await fetch("/media/get_event_image/14574/cache");
  return parseJson(response);
}

export async function fetchAboutEntries(): Promise<AboutEntry[]> {
  const response = await fetch("/api/info/get_about_us_text");
  return parseJson(response);
}

export async function fetchHistoryEntries(): Promise<HistoryEntry[]> {
  const response = await fetch("/api/info/get_our_history");
  return parseJson(response);
}

export async function saveAboutEntry(input: { id?: number; text: string }) {
  const formData = new FormData();
  if (input.id) formData.append("id", String(input.id));
  formData.append("text", input.text);
  const response = await fetch("/api/info/about_us_text", {
    method: "POST",
    body: formData,
  });
  return parseJson(response);
}

export async function deleteAboutEntry(id: number) {
  const response = await fetch("/api/info/about_us_text", {
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
  const response = await fetch("/api/info/add_our_history", {
    method: "POST",
    body: formData,
  });
  return parseJson(response);
}

export async function deleteHistoryEntry(id: number) {
  const response = await fetch("/api/info/add_our_history", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return parseJson(response);
}
