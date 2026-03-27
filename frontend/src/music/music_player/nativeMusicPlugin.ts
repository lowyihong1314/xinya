type NativeMusicListenerHandle = {
  remove: () => Promise<void> | void;
};

export type NativePlaylistTrack = {
  id: number;
  url: string;
  title: string;
  album: string;
  coverUrl: string;
};

export interface NativeMusicPlugin {
  ready(): Promise<void>;

  /**
   * Load a full ordered playlist and start playback from startIndex.
   * ExoPlayer manages all auto-advance in the background — no JS needed per track.
   */
  setPlaylist(options: {
    tracks: NativePlaylistTrack[];
    startIndex: number;
    repeatMode: "off" | "all" | "one";
  }): Promise<void>;

  /** Single-track play — backward compat, internally calls setPlaylist with one item. */
  play(options: { url: string; title: string; album: string; coverUrl: string }): Promise<void>;

  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  seekTo(options: { positionMs: number }): Promise<void>;

  /** Skip to a specific index in the current native playlist. */
  skipToIndex(options: { index: number }): Promise<void>;

  /** Update repeat mode on the running player without reloading the playlist. */
  setRepeat(options: { mode: "off" | "all" | "one" }): Promise<void>;

  getProgress(): Promise<{
    positionMs: number;
    durationMs: number;
    isPlaying: boolean;
    /** ID of the track currently playing in native player (-1 if unknown). */
    currentTrackId: number;
  }>;

  // ── Events ──────────────────────────────────────────────────────────────

  /** Fired when ExoPlayer auto-advances or user presses prev/next in notification. */
  addListener(
    event: "trackChanged",
    listener: (data: { id: number; index: number }) => void,
  ): Promise<NativeMusicListenerHandle>;

  /** Fired when the entire playlist finishes (repeat=off, last track ended). */
  addListener(event: "trackEnded", listener: () => void): Promise<NativeMusicListenerHandle>;

  /** Fired by playStateChanged from native (pause/play). */
  addListener(
    event: "playStateChanged",
    listener: (data: { isPlaying: boolean }) => void,
  ): Promise<NativeMusicListenerHandle>;

  /** Legacy — kept for any existing listeners; prefer trackChanged. */
  addListener(event: "next", listener: () => void): Promise<NativeMusicListenerHandle>;
  addListener(event: "prev", listener: () => void): Promise<NativeMusicListenerHandle>;
}

// ── Resolution helpers ────────────────────────────────────────────────────────

type CapacitorLike = {
  registerPlugin?: <T>(name: string) => T;
  Plugins?: Record<string, unknown>;
};

function createUnavailablePlugin(): NativeMusicPlugin {
  const noop = async () => undefined;
  const reject = async () => { throw new Error("NativeMusic plugin is unavailable in this runtime"); };
  return {
    ready: noop,
    setPlaylist: reject,
    play: reject,
    pause: reject,
    resume: reject,
    stop: reject,
    seekTo: reject,
    skipToIndex: reject,
    setRepeat: reject,
    getProgress: reject,
    addListener: async () => ({ remove: noop }),
  };
}

function isNativeMusicPlugin(value: unknown): value is NativeMusicPlugin {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as NativeMusicPlugin).ready === "function" &&
    typeof (value as NativeMusicPlugin).play === "function" &&
    typeof (value as NativeMusicPlugin).pause === "function" &&
    typeof (value as NativeMusicPlugin).addListener === "function",
  );
}

function resolveCapacitor() {
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorLike }).Capacitor ?? null;
}

export const NativeMusic: NativeMusicPlugin = (() => {
  const capacitor = resolveCapacitor();
  const fromGlobal = capacitor?.Plugins?.NativeMusic;
  if (isNativeMusicPlugin(fromGlobal)) return fromGlobal;
  const register = capacitor?.registerPlugin;
  if (typeof register === "function") return register<NativeMusicPlugin>("NativeMusic");
  return createUnavailablePlugin();
})();
