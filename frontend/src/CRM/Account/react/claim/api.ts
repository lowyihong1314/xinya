import type { ClaimListResponse } from "./types";

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(data.error || data.message || "请求失败");
  }
  return data;
}

export async function fetchClaims() {
  const response = await fetch("/api/account/get_all_claim", {
    credentials: "include",
  });
  return parseJson<ClaimListResponse>(response);
}

export async function submitClaim(formData: FormData) {
  const response = await fetch("/api/account/submit_new_claim", {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  return parseJson<{ request_id?: number }>(response);
}

export async function decideClaim(
  requestId: number,
  payload: { action: "approve" | "reject"; comment: string; sign_json_data?: unknown },
) {
  const response = await fetch(`/api/account/claim_decision/${requestId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<Record<string, unknown>>(response);
}
