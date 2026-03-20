export function navigateTo(page, { replace = false } = {}) {
  window.__xinyaNavigate?.(page, { replace });
}

export function change_parms(page, { replace = false } = {}) {
  navigateTo(page, { replace });
}

export async function fetchUserAuth() {
  if (window.__xinyaFetchUserAuth) {
    return window.__xinyaFetchUserAuth();
  }

  try {
    const res = await fetch("/api/user_control/get_user_data", {
      credentials: "include",
    });
    if (!res.ok) throw new Error("Unauthenticated");
    const data = await res.json();
    return data.username ? data : null;
  } catch {
    return null;
  }
}

export async function generate_navbar() {
  return Promise.resolve();
}
