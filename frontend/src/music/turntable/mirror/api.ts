import { API_BASE } from "../../../js/apiBase";
import { apiFetch } from "../../../js/apiFetch";
import type { MirrorHostSnapshot, MirrorSessionMeta } from "./types";

type ApiPayload = {
  status: "success" | "error";
  message?: string;
  reason?: string;
  token?: string;
  session?: MirrorHostSnapshot | MirrorSessionMeta;
};

const BASE = "/api/mirror";

async function parse(response: Response): Promise<ApiPayload> {
  const payload = (await response.json().catch(() => ({}))) as ApiPayload;
  if (!response.ok || payload.status === "error") {
    throw new Error(payload.message || "活动服务请求失败");
  }
  return payload;
}

export async function createMirrorSession(input?: {
  title?: string;
  min_reveal_count?: number;
}): Promise<{ token: string; session: MirrorHostSnapshot }> {
  const payload = await parse(
    await apiFetch(`${BASE}/session`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input || {}),
    }),
  );
  if (!payload.token || !payload.session) throw new Error("服务器没有返回活动房间");
  return { token: payload.token, session: payload.session as MirrorHostSnapshot };
}

export async function getMirrorSession(token: string): Promise<MirrorSessionMeta> {
  const payload = await parse(
    await apiFetch(`${BASE}/session/${encodeURIComponent(token)}`, { credentials: "include" }),
  );
  if (!payload.session) throw new Error("服务器没有返回活动资料");
  return payload.session as MirrorSessionMeta;
}

export async function saveMirrorConfig(
  token: string,
  config: { title?: string; min_reveal_count?: number },
): Promise<MirrorHostSnapshot> {
  const payload = await parse(
    await apiFetch(`${BASE}/session/${encodeURIComponent(token)}/config`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    }),
  );
  if (!payload.session) throw new Error("服务器没有返回活动资料");
  return payload.session as MirrorHostSnapshot;
}

/** Where a member's selfie is served from. `version` busts the cache on a re-shoot. */
export function mirrorPhotoUrl(token: string, memberId: string, version: number): string {
  return `${API_BASE}${BASE}/session/${encodeURIComponent(token)}/photo/${encodeURIComponent(memberId)}?v=${version}`;
}

export async function uploadMirrorPhoto(token: string, guestId: string, photo: string): Promise<number> {
  const response = await apiFetch(`${BASE}/session/${encodeURIComponent(token)}/photo`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guest_id: guestId, photo }),
  });
  const payload = (await response.json().catch(() => ({}))) as { status?: string; message?: string; photo_at_ms?: number };
  if (!response.ok || payload.status === "error") {
    throw new Error(payload.message || "照片上传失败");
  }
  return payload.photo_at_ms || 0;
}
