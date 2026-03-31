import type { SyncOptions } from "./types";

export class MediaSessionManager {
  syncMediaSession(options: SyncOptions, audio: HTMLAudioElement | null): void {
    if (!this.supportsMediaSession()) return;

    if (options.audioDisabled) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      return;
    }

    if (options.currentMusic) {
      navigator.mediaSession.metadata = this.supportsMediaMetadata()
        ? new MediaMetadata({
            title: options.currentMusic.title || "未知歌曲",
            album: options.currentMusic.album?.name || "",
            artist: "",
            artwork: options.currentMusic.cover_url
              ? [{ src: options.currentMusic.cover_url, sizes: "512x512", type: "image/jpeg" }]
              : [],
          })
        : null;
    } else {
      navigator.mediaSession.metadata = null;
    }

    navigator.mediaSession.playbackState = options.isPlaying ? "playing" : "paused";
    this.syncMediaSessionPositionState(audio);

    navigator.mediaSession.setActionHandler("play", () => {
      audio?.play().catch(() => undefined);
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      audio?.pause();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      options.onPrev();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      options.onNext();
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (!audio || details.seekTime == null) return;
      audio.currentTime = details.seekTime;
      this.syncMediaSessionPositionState(audio);
    });
  }

  syncMediaSessionPositionState(audio: HTMLAudioElement | null): void {
    if (!this.supportsMediaSession() || !audio || typeof navigator.mediaSession.setPositionState !== "function") {
      return;
    }
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    if (!duration || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(audio.currentTime || 0, duration),
      });
    } catch {
      // ignore unsupported position state updates
    }
  }

  private supportsMediaSession(): boolean {
    return typeof navigator !== "undefined" && "mediaSession" in navigator;
  }

  private supportsMediaMetadata(): boolean {
    return typeof window !== "undefined" && "MediaMetadata" in window;
  }
}
