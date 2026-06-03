import { resolveNativePlugin } from "./capacitor";

export type NativeAuthUser = Record<string, unknown>;

export type NativeAuthSession = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  user?: NativeAuthUser;
};

export interface NativeAuthPlugin {
  getSession(): Promise<NativeAuthSession>;
  setSession(options: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    user?: NativeAuthUser;
  }): Promise<void>;
  refreshSession(options: { baseUrl: string }): Promise<NativeAuthSession>;
  clearSession(): Promise<void>;
}

function createUnavailablePlugin(): NativeAuthPlugin {
  const noop = async () => undefined;
  return {
    getSession: async () => ({}),
    setSession: noop,
    refreshSession: async () => {
      throw new Error("NativeAuth plugin is unavailable in this runtime");
    },
    clearSession: noop,
  };
}

function isNativeAuthPlugin(value: unknown): value is NativeAuthPlugin {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as NativeAuthPlugin).getSession === "function" &&
      typeof (value as NativeAuthPlugin).setSession === "function" &&
      typeof (value as NativeAuthPlugin).refreshSession === "function" &&
      typeof (value as NativeAuthPlugin).clearSession === "function",
  );
}

export const NativeAuthPluginBridge = resolveNativePlugin<NativeAuthPlugin>(
  "NativeAuth",
  isNativeAuthPlugin,
  createUnavailablePlugin,
);
