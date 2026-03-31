import type { AlbumRecord, MusicRecord } from "./types";
import { apiFetch } from "../../js/apiFetch";

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
    success?: boolean;
  };
  if (!response.ok) {
    throw new Error(data.error || data.message || "请求失败");
  }
  return data;
}

export async function fetchAlbums() {
  const response = await apiFetch("/api/music/albums", { credentials: "include" });
  return parseJson<AlbumRecord[]>(response);
}

export async function fetchAlbum(albumId: number) {
  const response = await apiFetch(`/api/music/albums/${albumId}`, { credentials: "include" });
  return parseJson<AlbumRecord>(response);
}

export async function fetchMusicList() {
  const perPage = 200;
  const firstResponse = await apiFetch(`/api/music/list?per_page=${perPage}&page=1`, { credentials: "include" });
  const firstPage = await parseJson<{ musics?: MusicRecord[]; total_pages?: number }>(firstResponse);

  const musics = [...(firstPage.musics || [])];
  const totalPages = Math.max(1, firstPage.total_pages || 1);

  if (totalPages > 1) {
    const responses = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        apiFetch(`/api/music/list?per_page=${perPage}&page=${index + 2}`, { credentials: "include" }),
      ),
    );
    const pages = await Promise.all(
      responses.map((response) => parseJson<{ musics?: MusicRecord[] }>(response)),
    );
    pages.forEach((page) => {
      musics.push(...(page.musics || []));
    });
  }

  return { musics };
}

export async function fetchMusicDetail(musicId: number) {
  const response = await apiFetch(`/api/music/detail/${musicId}`, { credentials: "include" });
  return parseJson<MusicRecord>(response);
}

export async function createAlbum(name: string) {
  const response = await apiFetch("/api/music/album", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  return parseJson<{ success?: boolean; id?: number; album?: AlbumRecord }>(response);
}

export async function editAlbum(albumId: number, payload: { name: string; description?: string }) {
  const response = await apiFetch(`/api/music/album/${albumId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<{ success?: boolean; album?: AlbumRecord }>(response);
}

export async function deleteAlbum(albumId: number) {
  const response = await apiFetch(`/api/music/album/${albumId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ success?: boolean }>(response);
}

export async function uploadAlbumCover(albumId: number, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await apiFetch(`/api/music/albums/${albumId}/upload_cover`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  return parseJson<{ success?: boolean; cover_url?: string }>(response);
}

export async function uploadMusic(albumId: number, files: File[]) {
  const form = new FormData();
  form.append("album_id", String(albumId));
  files.forEach((file) => form.append("files", file));
  const response = await apiFetch("/api/music/upload", {
    method: "POST",
    credentials: "include",
    body: form,
  });
  return parseJson<{ success?: boolean; musics?: MusicRecord[] }>(response);
}

export async function deleteMusic(musicId: number) {
  const response = await apiFetch(`/api/music/delete/${musicId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ success?: boolean }>(response);
}

export async function editMusic(musicId: number, payload: { title: string; album_id?: number | null }) {
  const response = await apiFetch(`/api/music/edit/${musicId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<{ success?: boolean; music?: MusicRecord }>(response);
}

export async function replaceMusicFile(musicId: number, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await apiFetch(`/api/music/replace/${musicId}`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  return parseJson<{ success?: boolean; music?: MusicRecord }>(response);
}

export async function addOneMinute(musicId: number) {
  const response = await apiFetch(`/api/music/add_one_minute/${musicId}`, {
    method: "POST",
    credentials: "include",
  });
  return parseJson<{ success?: boolean; play_minutes?: number }>(response);
}
