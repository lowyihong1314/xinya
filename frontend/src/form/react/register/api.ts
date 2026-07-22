import { apiFetch } from "../../../js/apiFetch";

async function parseJson(response: Response): Promise<{ status?: string; message?: string }> {
  let data: { status?: string; message?: string } = {};
  try {
    data = (await response.json()) as { status?: string; message?: string };
  } catch {
    data = {};
  }
  if (!response.ok || data.status === "error") {
    throw new Error(data?.message || "请求失败，请稍后再试");
  }
  return data;
}

export async function registerPerson(formId: number, payload: Record<string, unknown>) {
  const response = await apiFetch(`/api/form/register/${formId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson(response);
}

export async function completeParental(formId: number, nric: string, parentalPayload: Record<string, unknown>) {
  const response = await apiFetch(`/api/form/parental/complete/${formId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nric, parental_payload: parentalPayload }),
  });
  return parseJson(response);
}
