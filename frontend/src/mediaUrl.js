import { API_BASE } from "./js/apiBase";
import { apiFetch } from "./js/apiFetch";

export function mediaUrl(path) {
  return `${API_BASE}/media_file/${path}`;
}

export async function fetchMediaPath(id, type = "cache") {
  const res = await apiFetch(`/media/get_event_image/${id}/${type}`);
  const info = await res.json();

  if (info.status === "success" && info.ready) {
    return mediaUrl(info.path);
  }
  return null;
}
