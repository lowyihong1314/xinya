async function parseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || "请求失败");
  }
  return data;
}

export async function postLampPayment(formData) {
  const response = await fetch("/api/lampRegistration_API/make_payment", {
    method: "POST",
    body: formData,
  });
  return parseJson(response);
}

export async function registerLamp(payload) {
  const response = await fetch("/api/lampRegistration_API/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson(response);
}

export async function fetchLampByIds(ids) {
  const response = await fetch("/api/lampRegistration_API/get_by_ids", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  return parseJson(response);
}

export async function deleteLampRegistration(id) {
  const response = await fetch("/api/lampRegistration_API/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return parseJson(response);
}

export async function fetchAllRegistrations() {
  const response = await fetch("/api/lampRegistration_API/get_all_register", {
    credentials: "include",
  });
  return parseJson(response);
}
