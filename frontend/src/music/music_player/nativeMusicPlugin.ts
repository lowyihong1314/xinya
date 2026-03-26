type NativeMusicListenerHandle = {
  remove: () => Promise<void> | void;
};

export interface NativeMusicPlugin {
  ready(): Promise<void>;
  play(options: { url: string; title: string; album: string; coverUrl: string }): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seekTo(options: { positionMs: number }): Promise<void>;
  getProgress(): Promise<{ positionMs: number; durationMs: number; isPlaying: boolean }>;
  stop(): Promise<void>;
  addListener(
    event: "playStateChanged",
    listener: (data: { isPlaying: boolean }) => void,
  ): Promise<NativeMusicListenerHandle>;
  addListener(event: "trackEnded", listener: () => void): Promise<NativeMusicListenerHandle>;
  addListener(event: "next", listener: () => void): Promise<NativeMusicListenerHandle>;
  addListener(event: "prev", listener: () => void): Promise<NativeMusicListenerHandle>;
}

type CapacitorLike = {
  registerPlugin?: <T>(name: string) => T;
  Plugins?: Record<string, unknown>;
};

function createUnavailableError() {
  return new Error("NativeMusic plugin is unavailable in this runtime");
}

function createUnavailablePlugin(): NativeMusicPlugin {
  const rejectUnavailable = async () => {
    throw createUnavailableError();
  };

  return {
    ready: async () => undefined,
    play: rejectUnavailable,
    pause: rejectUnavailable,
    resume: rejectUnavailable,
    seekTo: rejectUnavailable,
    getProgress: rejectUnavailable,
    stop: rejectUnavailable,
    addListener: async () => ({
      remove: async () => undefined,
    }),
  };
}

function isNativeMusicPlugin(value: unknown): value is NativeMusicPlugin {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as NativeMusicPlugin).ready === "function" &&
    typeof (value as NativeMusicPlugin).play === "function" &&
    typeof (value as NativeMusicPlugin).pause === "function" &&
    typeof (value as NativeMusicPlugin).resume === "function" &&
    typeof (value as NativeMusicPlugin).seekTo === "function" &&
    typeof (value as NativeMusicPlugin).getProgress === "function" &&
    typeof (value as NativeMusicPlugin).stop === "function" &&
    typeof (value as NativeMusicPlugin).addListener === "function"
  );
}

function resolveCapacitor() {
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorLike }).Capacitor ?? null;
}

function resolvePluginFromGlobal(capacitor: CapacitorLike | null) {
  const plugin = capacitor?.Plugins?.NativeMusic;
  return isNativeMusicPlugin(plugin) ? plugin : null;
}

function resolveRegisterPlugin(capacitor: CapacitorLike | null): CapacitorLike["registerPlugin"] | null {
  if (typeof capacitor?.registerPlugin === "function") {
    return capacitor.registerPlugin;
  }
  return null;
}

export const NativeMusic: NativeMusicPlugin = (() => {
  const capacitor = resolveCapacitor();
  const plugin = resolvePluginFromGlobal(capacitor);
  if (plugin) {
    return plugin;
  }

  const registerPlugin = resolveRegisterPlugin(capacitor);
  if (!registerPlugin) {
    return createUnavailablePlugin();
  }
  return registerPlugin<NativeMusicPlugin>("NativeMusic");
})();
