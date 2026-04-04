import { apiFetch } from "../../../../js/apiFetch";
import type { SongbookEntry } from "../types";

export type ChangyouRoomProjectionBlock = {
  id: string;
  lines: string[];
  text: string;
  label: string;
  highlightable: boolean;
  weight: number;
};

export type ChangyouRoomProjection = {
  page_index: number;
  page_count: number;
  page_label?: string | null;
  content: string;
  blocks: ChangyouRoomProjectionBlock[];
  marker_index?: number | null;
};

export type ChangyouRoomNotification = {
  kind: "text" | "qr";
  content: string;
  updated_at?: number | null;
};

export type ChangyouRoom = {
  room_id: string;
  topic: string;
  creator_id?: number | null;
  creator_name?: string | null;
  created_at?: number | null;
  expires_at?: number | null;
  song_entry_id?: number | null;
  version_kind?: "base" | "user";
  editor_user_id?: number | null;
  playback_url?: string;
  role?: "controller" | "player";
  projection?: ChangyouRoomProjection | null;
};

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(data.error || data.message || "请求失败");
  return data;
}

export async function fetchChangyouRooms() {
  const response = await apiFetch('/api/changyou_room/list', { credentials: 'include' });
  return parseJson<{ rooms: ChangyouRoom[] }>(response);
}

export async function createChangyouRoom(topic: string) {
  const response = await apiFetch('/api/changyou_room/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ topic }),
  });
  return parseJson<{ success: boolean; room: ChangyouRoom }>(response);
}

export async function fetchChangyouRoom(roomId: string) {
  const response = await apiFetch(`/api/changyou_room/room/${roomId}`, { credentials: 'include' });
  return parseJson<{ room: ChangyouRoom }>(response);
}

export async function fetchChangyouRoomCurrent(roomId: string) {
  const response = await apiFetch(`/api/changyou_room/room/${roomId}/current`, { credentials: 'include' });
  return parseJson<{
    room: ChangyouRoom;
    entry: SongbookEntry | null;
    projection?: ChangyouRoomProjection | null;
  }>(response);
}

export async function pushChangyouRoomSong(roomId: string, payload: { song_entry_id: number; version_kind: 'base' | 'user'; editor_user_id?: number | null }) {
  const response = await apiFetch(`/api/changyou_room/room/${roomId}/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  return parseJson<{ success: boolean; room: ChangyouRoom; entry: SongbookEntry | null }>(response);
}

export async function projectChangyouRoomPage(
  roomId: string,
  payload: {
    song_entry_id: number;
    version_kind: 'base' | 'user';
    editor_user_id?: number | null;
    page_index: number;
    page_count: number;
    page_label?: string | null;
    content: string;
    blocks: ChangyouRoomProjectionBlock[];
    marker_index?: number | null;
  },
) {
  const response = await apiFetch(`/api/changyou_room/room/${roomId}/project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  return parseJson<{
    success: boolean;
    room: ChangyouRoom;
    entry: SongbookEntry | null;
    projection?: ChangyouRoomProjection | null;
  }>(response);
}

export async function updateChangyouRoomMarker(roomId: string, payload: { marker_index?: number | null }) {
  const response = await apiFetch(`/api/changyou_room/room/${roomId}/marker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  return parseJson<{
    success: boolean;
    room: ChangyouRoom;
    entry: SongbookEntry | null;
    projection?: ChangyouRoomProjection | null;
  }>(response);
}

export async function notifyChangyouRoom(roomId: string, payload: { kind: "text" | "qr"; content: string }) {
  const response = await apiFetch(`/api/changyou_room/room/${roomId}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  return parseJson<{
    success: boolean;
    notification: ChangyouRoomNotification;
  }>(response);
}
