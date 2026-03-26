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

function resolveRegisterPlugin() {
  const maybeCapacitor = (globalThis as typeof globalThis & { Capacitor?: CapacitorLike }).Capacitor;
  if (typeof maybeCapacitor?.registerPlugin === "function") {
    return maybeCapacitor.registerPlugin.bind(maybeCapacitor);
  }
  return null;
}

export const NativeMusic: NativeMusicPlugin = (() => {
  const registerPlugin = resolveRegisterPlugin();
  if (!registerPlugin) {
    return createUnavailablePlugin();
  }
  return registerPlugin<NativeMusicPlugin>("NativeMusic");
})();
