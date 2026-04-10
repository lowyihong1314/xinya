import { apiFetch } from "../../js/apiFetch";

async function parseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || "请求失败");
  }
  return data;
}

export async function postLampPayment(formData) {
  const response = await apiFetch("/api/lampRegistration_API/payments", {
    method: "POST",
    body: formData,
  });
  return parseJson(response);
}

export async function registerLamp(payload) {
  const response = await apiFetch("/api/lampRegistration_API/registrations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson(response);
}

export async function fetchLampByIds(ids) {
  const response = await apiFetch("/api/lampRegistration_API/registrations/query", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  return parseJson(response);
}

export async function deleteLampRegistration(id) {
  const response = await apiFetch(`/api/lampRegistration_API/registrations/${id}`, {
    method: "DELETE",
  });
  return parseJson(response);
}

export async function fetchAllRegistrations() {
  const response = await apiFetch("/api/lampRegistration_API/registrations", {
    credentials: "include",
  });
  return parseJson(response);
}
