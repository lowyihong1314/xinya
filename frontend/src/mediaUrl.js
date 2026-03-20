export function mediaUrl(path) {
  return `/media_file/${path}`;
}

export async function fetchMediaPath(id, type = "cache") {
  const res = await fetch(`/media/get_event_image/${id}/${type}`);
  const info = await res.json();

  if (info.status === "success" && info.ready) {
    return mediaUrl(info.path);
  }
  return null;
}
