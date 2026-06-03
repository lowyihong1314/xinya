import { API_BASE, IS_APK } from "../../js/apiBase";
import { NativeAuthPluginBridge, type NativeAuthSession } from "./authPlugin";
import { isMobileNativeRuntime } from "./capacitor";

const REFRESH_WINDOW_MS = 60 * 1000;

let refreshPromise: Promise<NativeAuthSession | null> | null = null;

export function shouldUseMobileNativeAuth() {
  return IS_APK && isMobileNativeRuntime();
}

function expiryTime(expiresAt?: string) {
  const value = String(expiresAt || "").trim();
  if (!value) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric < 100_000_000_000 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isNativeAuthExpiredOrNearlyExpired(expiresAt?: string) {
  const expiry = expiryTime(expiresAt);
  if (!expiry) return false;
  return expiry - Date.now() <= REFRESH_WINDOW_MS;
}

export async function refreshStoredNativeAuthSession() {
  if (!shouldUseMobileNativeAuth()) return null;
  if (!API_BASE) return null;

  if (!refreshPromise) {
    refreshPromise = NativeAuthPluginBridge.refreshSession({ baseUrl: API_BASE })
      .catch(async (error) => {
        console.warn("NativeAuth.refreshSession failed:", error);
        await NativeAuthPluginBridge.clearSession();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

export async function getNativeAuthorizationHeader() {
  if (!shouldUseMobileNativeAuth()) return null;

  let session = await NativeAuthPluginBridge.getSession();
  if (session.accessToken && isNativeAuthExpiredOrNearlyExpired(session.expiresAt)) {
    session = (await refreshStoredNativeAuthSession()) || {};
  }

  const accessToken = String(session.accessToken || "").trim();
  return accessToken ? `Bearer ${accessToken}` : null;
}
