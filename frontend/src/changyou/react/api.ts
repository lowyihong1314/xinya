import type { SongbookEntry } from "./types";

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(data.error || data.message || "请求失败");
  }
  return data;
}

export async function fetchSongbookEntries(query = "", variant = "") {
  const search = new URLSearchParams();
  if (query.trim()) search.set("q", query.trim());
  if (variant) search.set("variant", variant);
  const response = await fetch(`/api/songbook/list?${search.toString()}`, { credentials: "include" });
  return parseJson<{ entries: SongbookEntry[] }>(response);
}

export async function fetchSongbookEntry(entryId: number) {
  const response = await fetch(`/api/songbook/entry/${entryId}`, { credentials: "include" });
  return parseJson<{ entry: SongbookEntry }>(response);
}

export async function fetchSongbookEntriesForAdmin(query = "", variant = "") {
  const search = new URLSearchParams();
  if (query.trim()) search.set("q", query.trim());
  if (variant) search.set("variant", variant);
  search.set("include_unpublished", "1");
  const response = await fetch(`/api/songbook/list?${search.toString()}`, { credentials: "include" });
  return parseJson<{ entries: SongbookEntry[] }>(response);
}

export async function saveSongbookEntry(payload: Partial<SongbookEntry> & { title: string; content: string }) {
  const response = await fetch("/api/songbook/entry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<{ success: boolean; entry: SongbookEntry }>(response);
}

export async function deleteSongbookEntry(entryId: number) {
  const response = await fetch(`/api/songbook/entry/${entryId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ success: boolean }>(response);
}

export async function importSongbookDocx(path: string, replaceExisting = false) {
  const response = await fetch("/api/songbook/import_docx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ path, replace_existing: replaceExisting }),
  });
  return parseJson<{ success: boolean; saved: number; updated: number; total: number; source_doc: string }>(response);
}
