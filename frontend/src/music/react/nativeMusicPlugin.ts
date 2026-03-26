import { registerPlugin } from "@capacitor/core";

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

export const NativeMusic = registerPlugin<NativeMusicPlugin>("NativeMusic");
