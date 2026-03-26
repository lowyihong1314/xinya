import type { ProfileFootprintPayload, ProfileFormValues, ProfileUser } from "./types";

async function parseResponse<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(data.error || data.message || "请求失败");
  }
  return data;
}

export async function updateProfile(userId: number, payload: ProfileFormValues) {
  const response = await fetch(`/api/user_control/update_user/${userId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseResponse<ProfileUser>(response);
}

export async function uploadProfileImage(file: File) {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch("/api/user_control/upload_profile_image", {
    method: "POST",
    body: formData,
  });

  return parseResponse<Record<string, unknown>>(response);
}

export async function fetchMyFootprints() {
  const response = await fetch("/api/user_control/my_footprints", {
    credentials: "include",
  });
  return parseResponse<ProfileFootprintPayload>(response);
}

export async function startMembershipRenewal() {
  const response = await fetch("/api/user_control/membership/renew", {
    method: "POST",
    credentials: "include",
  });
  return parseResponse<{ status?: string; message?: string; payment_url?: string }>(response);
}
