import { apiFetch } from "../../js/apiFetch";
import { API_BASE } from "../../js/apiBase";
import { NativeAuthPluginBridge, type NativeAuthSession, type NativeAuthUser } from "./authPlugin";
import { getNativeAuthorizationHeader, isNativeAuthExpiredOrNearlyExpired, refreshStoredNativeAuthSession, shouldUseMobileNativeAuth } from "./authHeader";
import { resolveCapacitor } from "./capacitor";

const MOBILE_DEVICE_ID_KEY = "xinya_mobile_device_id";

type MobileSessionPayload = {
  access_token?: string;
  accessToken?: string;
  refresh_token?: string;
  refreshToken?: string;
  expires_at?: string;
  expiresAt?: string;
  user?: NativeAuthUser;
};

function mobilePlatform() {
  return resolveCapacitor()?.getPlatform?.();
}

function mobileDeviceId() {
  try {
    const existing = globalThis.localStorage?.getItem(MOBILE_DEVICE_ID_KEY);
    if (existing) return existing;

    const generated = globalThis.crypto?.randomUUID?.() || `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    globalThis.localStorage?.setItem(MOBILE_DEVICE_ID_KEY, generated);
    return generated;
  } catch {
    return undefined;
  }
}

function mobileClientMetadata() {
  return {
    device_id: mobileDeviceId(),
    platform: mobilePlatform(),
  };
}

function mobileApiUrl(path: string) {
  return `${API_BASE}${path}`;
}

function normalizeSessionPayload(payload: MobileSessionPayload): Required<Pick<NativeAuthSession, "accessToken" | "refreshToken" | "expiresAt">> & {
  user?: NativeAuthUser;
} {
  const accessToken = String(payload.access_token || payload.accessToken || "").trim();
  const refreshToken = String(payload.refresh_token || payload.refreshToken || "").trim();
  const expiresAt = String(payload.expires_at || payload.expiresAt || "").trim();
  if (!accessToken || !refreshToken || !expiresAt) {
    throw new Error("mobile session response missing token data");
  }
  return {
    accessToken,
    refreshToken,
    expiresAt,
    user: payload.user,
  };
}

async function storeMobileSession(payload: MobileSessionPayload) {
  const session = normalizeSessionPayload(payload);
  await NativeAuthPluginBridge.setSession(session);
  return session;
}

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function loginWithMobileSession(username: string, password: string) {
  if (!shouldUseMobileNativeAuth()) return null;

  const response = await fetch(mobileApiUrl("/api/mobile/session/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      username,
      password,
      ...mobileClientMetadata(),
    }),
  });
  const data = (await readJson(response)) as MobileSessionPayload & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || "登录失败");
  }
  return storeMobileSession(data);
}

export async function exchangeMobileSession() {
  if (!shouldUseMobileNativeAuth()) return null;

  const response = await apiFetch("/api/mobile/session/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(mobileClientMetadata()),
  });
  const data = (await readJson(response)) as MobileSessionPayload & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || "移动端登录同步失败");
  }
  return storeMobileSession(data);
}

export async function ensureMobileSessionForAuthenticatedUser() {
  if (!shouldUseMobileNativeAuth()) return null;

  const session = await NativeAuthPluginBridge.getSession();
  if (session.accessToken && !isNativeAuthExpiredOrNearlyExpired(session.expiresAt)) {
    return session;
  }
  if (session.accessToken) {
    const refreshed = await refreshStoredNativeAuthSession();
    if (refreshed?.accessToken) {
      return refreshed;
    }
  }

  return exchangeMobileSession();
}

export async function revokeMobileSession() {
  if (!shouldUseMobileNativeAuth()) return;

  let authHeader = await getNativeAuthorizationHeader();
  if (!authHeader) {
    const refreshed = await refreshStoredNativeAuthSession();
    const accessToken = String(refreshed?.accessToken || "").trim();
    authHeader = accessToken ? `Bearer ${accessToken}` : null;
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  if (authHeader) {
    headers.set("Authorization", authHeader);
  }

  try {
    await fetch(mobileApiUrl("/api/mobile/session/logout"), {
      method: "DELETE",
      headers,
      credentials: "include",
      body: "{}",
    });
  } catch (error) {
    console.warn("mobile session revoke failed:", error);
  }
}
