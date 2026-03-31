import type { MusicRecord } from "../types";

export type RepeatMode = "off" | "all" | "one";
export type PanelView = "player" | "playlist";
export type FloatingPosition = { x: number; y: number } | null;

export type SyncOptions = {
  currentMusic: MusicRecord | null;
  currentMusicId: number | null;
  queue: MusicRecord[];
  audioSrc: string | null;
  audioDisabled?: boolean;
  isPlaying: boolean;
  hasPlaybackSession: boolean;
  hasQueue: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  isMobile: boolean;
  minimized: boolean;
  autoplayKey: number;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDismiss: () => void;
  onExpand: () => void;
  onMinimize: () => void;
  onPlayFromQueue: (musicId: number) => void;
  onRemoveFromQueue: (musicId: number) => void;
  onClearQueue: () => void;
  onEnded: () => void;
  onPlayStateChange: (playing: boolean) => void;
  /** APK mode: keep audio alive but hide all floating UI */
  hidden?: boolean;
};
