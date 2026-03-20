import type { ProfileFormValues, ProfileUser } from "./types";

async function parseResponse<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || "请求失败");
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
