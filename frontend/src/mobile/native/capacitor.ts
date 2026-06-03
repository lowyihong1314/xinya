export type CapacitorLike = {
  registerPlugin?: <T>(name: string) => T;
  Plugins?: Record<string, unknown>;
  convertFileSrc?: (filePath: string) => string;
  getPlatform?: () => string;
};

export function resolveCapacitor() {
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorLike }).Capacitor ?? null;
}

export function resolveNativePlugin<T>(
  pluginName: string,
  isPlugin: (value: unknown) => value is T,
  createUnavailablePlugin: () => T,
) {
  const capacitor = resolveCapacitor();
  const fromGlobal = capacitor?.Plugins?.[pluginName];
  if (isPlugin(fromGlobal)) return fromGlobal;
  const register = capacitor?.registerPlugin;
  if (typeof register === "function") return register<T>(pluginName);
  return createUnavailablePlugin();
}

export function isAndroidNativeRuntime() {
  return resolveCapacitor()?.getPlatform?.() === "android";
}

export function isMobileNativeRuntime() {
  const platform = resolveCapacitor()?.getPlatform?.();
  return platform === "android" || platform === "ios";
}
