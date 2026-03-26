import { apiFetch } from "../../../js/apiFetch";

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
  return parseJson<{ room: ChangyouRoom; entry: any }>(response);
}

export async function pushChangyouRoomSong(roomId: string, payload: { song_entry_id: number; version_kind: 'base' | 'user'; editor_user_id?: number | null }) {
  const response = await apiFetch(`/api/changyou_room/room/${roomId}/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  return parseJson<{ success: boolean; room: ChangyouRoom; entry: any }>(response);
}
