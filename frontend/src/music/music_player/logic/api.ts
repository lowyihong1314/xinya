import type {
  AlbumRecord,
  LastPlayedMusicResponse,
  MinuteLogsResponse,
  MusicRecord,
  PlaybackCommandAction,
  PlaybackCommandMessage,
  PlaybackDeviceState,
  PlaylistRecord,
} from "./types";
import type { MusicUploadDraft } from "./workspaceTypes";
import { apiFetch } from "../../../js/apiFetch";

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

export async function fetchMinuteLogs(params?: {
  page?: number;
  perPage?: number;
  musicId?: number | null;
  userId?: number | null;
}) {
  const search = new URLSearchParams();
  if (params?.page) search.set("page", String(params.page));
  if (params?.perPage) search.set("per_page", String(params.perPage));
  if (params?.musicId != null) search.set("music_id", String(params.musicId));
  if (params?.userId != null) search.set("user_id", String(params.userId));

  const response = await apiFetch(
    `/api/music/minute_logs${search.size ? `?${search.toString()}` : ""}`,
    { credentials: "include" },
  );
  return parseJson<MinuteLogsResponse>(response);
}

export async function fetchLastPlayedMusic() {
  const response = await apiFetch("/api/music/last_played", {
    credentials: "include",
  });
  return parseJson<LastPlayedMusicResponse>(response);
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

export async function uploadMusic(albumId: number, upload: MusicUploadDraft) {
  const form = new FormData();
  form.append("album_id", String(albumId));
  form.append("title", upload.title);
  form.append("files", upload.file);
  if (upload.accompaniment) form.append("accompaniment", upload.accompaniment);
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

// ---- 一人一设备播放 ----
export async function fetchPlaybackChannel(deviceId?: string | null) {
  const response = await apiFetch("/api/music/playback/channel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ device_id: deviceId ?? null }),
  });
  return parseJson<{ channel_key: string; room: string; state?: PlaybackDeviceState }>(response);
}

export async function transferPlayback(targetDeviceId: string, requestedBy?: string | null) {
  const response = await apiFetch("/api/music/playback/transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ device_id: targetDeviceId, requested_by: requestedBy ?? null }),
  });
  return parseJson<PlaybackDeviceState>(response);
}

export async function sendPlaybackCommand(payload: {
  target_device_id: string | null;
  action: PlaybackCommandAction;
  payload?: Record<string, unknown>;
  requested_by?: string | null;
}) {
  const response = await apiFetch("/api/music/playback/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<PlaybackCommandMessage>(response);
}

export async function sendPlaybackHeartbeat(payload: {
  device_id: string;
  device_name: string;
  kind?: "web" | "android";
  music_id: number | null;
  position_ms: number;
  duration_ms?: number;
  is_playing: boolean;
  claim?: boolean;
}) {
  const response = await apiFetch("/api/music/playback/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<PlaybackDeviceState>(response);
}

export async function releasePlayback(deviceId: string) {
  const response = await apiFetch("/api/music/playback/release", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ device_id: deviceId }),
  });
  return parseJson<PlaybackDeviceState>(response);
}

// ---- 我的歌单（歌单与用户多对多）----
export async function fetchPlaylists() {
  const response = await apiFetch("/api/music/playlists", { credentials: "include" });
  return parseJson<{ playlists?: PlaylistRecord[]; public_playlists?: PlaylistRecord[] }>(response);
}

export async function createPlaylist(payload: { name: string; description?: string; music_ids?: number[]; is_public?: boolean }) {
  const response = await apiFetch("/api/music/playlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<{ success?: boolean; playlist?: PlaylistRecord }>(response);
}

export async function savePlaylist(
  playlistId: number,
  payload: { name?: string; description?: string; music_ids?: number[]; is_public?: boolean },
) {
  const response = await apiFetch(`/api/music/playlist/${playlistId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<{ success?: boolean; playlist?: PlaylistRecord }>(response);
}

export async function deletePlaylist(playlistId: number) {
  const response = await apiFetch(`/api/music/playlist/${playlistId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ success?: boolean }>(response);
}

export async function addPlaylistMember(playlistId: number, handle: string) {
  const response = await apiFetch(`/api/music/playlist/${playlistId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username: handle }),
  });
  return parseJson<{ success?: boolean; playlist?: PlaylistRecord; already_member?: boolean }>(response);
}

export async function removePlaylistMember(playlistId: number, userId: number) {
  const response = await apiFetch(`/api/music/playlist/${playlistId}/members/${userId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ success?: boolean; playlist?: PlaylistRecord; left?: boolean }>(response);
}

export async function uploadAccompaniment(musicId: number, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await apiFetch(`/api/music/accompaniment/${musicId}`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  return parseJson<{ success?: boolean; music?: MusicRecord }>(response);
}

export async function deleteAccompaniment(musicId: number) {
  const response = await apiFetch(`/api/music/accompaniment/${musicId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ success?: boolean; music?: MusicRecord }>(response);
}

export async function addOneMinute(musicId: number) {
  const response = await apiFetch(`/api/music/add_one_minute/${musicId}`, {
    method: "POST",
    credentials: "include",
  });
  return parseJson<{
    success?: boolean;
    user_id?: number;
    play_minutes?: number;
    played_at?: string;
  }>(response);
}
