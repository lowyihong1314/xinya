import type { PanelView, SyncOptions } from "./types";
import { repeatLabel, repeatButtonLabel, repeatIconName, injectCssAnimation } from "./helpers";
import { buildPlayerDom, setIcon, setButtonIcon, type DomRefs } from "./DomBuilder";
import { DragManager } from "./DragManager";
import { MediaSessionManager } from "./MediaSessionManager";

class MusicPlayerController {
  private static readonly PROGRESS_STORAGE_KEY = "xinya.music.player.progress";

  private dom: DomRefs | null = null;
  private latestOptions: SyncOptions | null = null;
  private lastSource: string | null = null;
  private lastAutoplayKey = 0;
  private lastProgressSaveAt = 0;
  private panelView: PanelView = "player";

  private drag = new DragManager();
  private mediaSession = new MediaSessionManager();

  sync(options: SyncOptions) {
    this.latestOptions = options;
    this.ensureDom();
    this.updateSource(options);
    this.mediaSession.syncMediaSession(options, this.dom?.audio ?? null);
    this.render(options);
  }

  destroy() {
    this.drag.detachDragListeners();
    this.dom?.root.remove();
    this.dom = null;
    this.panelView = "player";
  }

  togglePlay() {
    const audio = this.dom?.audio;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }

  seekTo(time: number) {
    if (this.dom?.audio) {
      this.dom.audio.currentTime = time;
    }
  }

  getProgress(): number {
    return this.dom?.audio?.currentTime ?? 0;
  }

  getDuration(): number {
    return this.dom?.audio?.duration ?? 0;
  }

  private ensureDom() {
    if (this.dom) return;

    this.dom = buildPlayerDom(
      () => this.latestOptions,
      (event) => this.drag.startDrag(event),
      () => this.togglePanelView(),
      () => this.dismissPlayer(),
      () => this.persistProgress(),
      () => this.mediaSession.syncMediaSessionPositionState(this.dom?.audio ?? null),
    );

    this.drag.setRefs({
      root: this.dom.root,
      dragHandle: this.dom.dragHandle,
      mini: this.dom.mini,
      panel: this.dom.panel,
    });

    this.drag.restorePosition();
  }

  private render(options: SyncOptions) {
    const dom = this.dom;
    if (!dom) return;

    if (options.hidden) {
      dom.root.style.display = "none";
      return;
    }

    const showPlayer = Boolean(options.hasPlaybackSession && (options.currentMusic || options.queue.length));
    dom.root.style.display = showPlayer ? "block" : "none";
    if (!showPlayer) return;

    this.drag.applyRootPosition(options.isMobile, options.minimized, () => this.getNavHeight());

    dom.playerView.style.display = this.panelView === "player" ? "grid" : "none";
    dom.queueView.style.display = this.panelView === "playlist" ? "grid" : "none";

    dom.toggleViewButton.title = this.panelView === "player" ? "查看播放队列" : "查看播放器";
    dom.toggleViewButton.style.color = this.panelView === "playlist" ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)";
    setButtonIcon(dom.toggleViewButton, this.panelView === "player" ? "list-ul" : "compact-disc");

    dom.dragHandle.style.cursor = this.drag.isDragging() ? "grabbing" : "grab";
    dom.dragHandle.textContent = this.panelView === "player" ? "播放器" : "播放队列";

    const minimized = options.minimized;
    dom.mini.style.display = "grid";
    Object.assign(dom.panel.style, {
      opacity: minimized ? "0" : "1",
      visibility: minimized ? "hidden" : "visible",
      pointerEvents: minimized ? "none" : "auto",
      transform: minimized ? "translateY(-18px) scale(0.94)" : "translateY(0) scale(1)",
    });
    Object.assign(dom.mini.style, {
      opacity: minimized ? "1" : "0",
      visibility: minimized ? "visible" : "hidden",
      pointerEvents: minimized ? "auto" : "none",
      transform: minimized ? "translateY(0) scale(1)" : "translateY(-14px) scale(0.94)",
    });
    dom.mini.style.display = "grid";
    dom.mini.style.cursor = this.drag.isDragging() ? "grabbing" : "grab";

    if (options.currentMusic?.cover_url) {
      dom.cover.src = options.currentMusic.cover_url;
      dom.cover.alt = options.currentMusic.title;
      dom.cover.style.display = "block";
      dom.fallback.style.display = "none";
      dom.miniCover.src = options.currentMusic.cover_url;
      dom.miniCover.alt = options.currentMusic.title;
      dom.miniCover.style.display = "block";
      dom.miniFallback.style.display = "none";
    } else {
      dom.cover.style.display = "none";
      dom.fallback.style.display = "grid";
      dom.fallback.style.animation = options.isPlaying ? "music-default-cover-spin 14s linear infinite" : "";
      dom.miniCover.style.display = "none";
      dom.miniFallback.style.display = "grid";
    }

    dom.title.textContent = options.currentMusic?.title || "选择一首歌曲开始播放";
    dom.subtitle.textContent = options.currentMusic?.album?.name || "当前队列";
    dom.miniTitle.textContent = options.currentMusic?.title || options.queue[0]?.title || "";
    dom.miniCopy.textContent = options.isPlaying ? "播放中" : options.queue.length ? `${options.queue.length} 首队列` : "已暂停";

    dom.shuffleButton.style.color = options.shuffleEnabled ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)";
    dom.shuffleButton.title = options.shuffleEnabled ? "随机播放中" : "随机播放";
    setIcon(dom.shuffleButton, "shuffle");
    dom.shuffleButton.style.opacity = options.hasQueue ? "1" : "0.34";
    dom.shuffleButton.style.pointerEvents = options.hasQueue ? "auto" : "none";

    dom.repeatButton.style.color = options.repeatMode !== "off" ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)";
    dom.repeatButton.title = repeatButtonLabel(options.repeatMode);
    setIcon(dom.repeatButton, repeatIconName(options.repeatMode));

    dom.prevButton.style.opacity = options.hasQueue ? "1" : "0.34";
    dom.prevButton.style.pointerEvents = options.hasQueue ? "auto" : "none";
    dom.nextButton.style.opacity = options.hasQueue ? "1" : "0.34";
    dom.nextButton.style.pointerEvents = options.hasQueue ? "auto" : "none";

    dom.queueHint.textContent = options.hasQueue
      ? `${repeatLabel(options.repeatMode)}，当前队列共 ${options.queue.length} 首。`
      : "点击歌曲会插队播放，`+列队` 会追加到末尾。";

    dom.queueHeaderTitle.textContent = `播放队列 · ${options.queue.length} 首`;
    dom.queueEmpty.style.display = options.queue.length ? "none" : "block";
    dom.clearQueueButton.style.display = options.queue.length ? "inline-flex" : "none";

    dom.queueList.replaceChildren();
    options.queue.forEach((music, index) => {
      const row = document.createElement("div");
      row.className = "music-player-controller__queue-row";
      Object.assign(row.style, {
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        gap: "10px",
        alignItems: "center",
        padding: "10px 12px",
        borderRadius: "14px",
        background: music.id === options.currentMusicId ? "var(--x-color-accent-soft)" : "var(--x-color-panel)",
        border: "1px solid var(--x-color-line)",
      });

      const indexNode = document.createElement("div");
      indexNode.className = "music-player-controller__queue-index";
      Object.assign(indexNode.style, {
        width: "24px",
        fontSize: "12px",
        color: "var(--x-color-ink-muted)",
        fontWeight: "700",
      });
      indexNode.textContent = String(index + 1).padStart(2, "0");
      row.appendChild(indexNode);

      const playButton = document.createElement("button");
      playButton.type = "button";
      playButton.className = "music-player-controller__queue-play";
      Object.assign(playButton.style, {
        minWidth: "0",
        display: "grid",
        gap: "2px",
        padding: "0",
        border: "none",
        background: "transparent",
        textAlign: "left",
        cursor: "pointer",
      });
      playButton.onclick = () => options.onPlayFromQueue(music.id);

      const playTitle = document.createElement("div");
      playTitle.className = "music-player-controller__queue-play-title";
      Object.assign(playTitle.style, {
        fontSize: "13px",
        fontWeight: "800",
        color: "var(--x-color-ink)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });
      playTitle.textContent = music.title;
      playButton.appendChild(playTitle);

      const playMeta = document.createElement("div");
      playMeta.className = "music-player-controller__queue-play-meta";
      Object.assign(playMeta.style, {
        fontSize: "12px",
        color: "var(--x-color-ink-muted)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });
      playMeta.textContent = music.album?.name || "未分配专辑";
      playButton.appendChild(playMeta);
      row.appendChild(playButton);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "music-player-controller__queue-remove";
      removeButton.textContent = "移除";
      Object.assign(removeButton.style, {
        border: "none",
        background: "transparent",
        color: "var(--x-color-danger)",
        fontSize: "12px",
        fontWeight: "700",
        cursor: "pointer",
      });
      removeButton.onclick = () => options.onRemoveFromQueue(music.id);
      row.appendChild(removeButton);

      dom.queueList.appendChild(row);
    });
  }

  private updateSource(options: SyncOptions) {
    const audio = this.dom?.audio;
    if (!audio) return;

    if (options.audioDisabled) {
      if (this.lastSource) {
        this.persistProgress();
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      this.lastSource = null;
      return;
    }

    const nextSource = options.audioSrc;
    if (!nextSource) {
      if (this.lastSource) {
        this.persistProgress();
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      this.lastSource = null;
      return;
    }

    const sourceChanged = nextSource !== this.lastSource;
    if (sourceChanged) {
      audio.src = nextSource;
      audio.load();
      this.lastSource = nextSource;
      this.restoreProgressForCurrentTrack();
    }

    if (options.autoplayKey !== this.lastAutoplayKey && options.autoplayKey > 0) {
      this.lastAutoplayKey = options.autoplayKey;
      window.setTimeout(() => {
        this.dom?.audio?.play().catch(() => undefined);
      }, 0);
    }
  }

  private persistProgress() {
    const audio = this.dom?.audio;
    if (!audio || !this.latestOptions?.currentMusicId) return;
    const now = Date.now();
    if (now - this.lastProgressSaveAt < 800) return;
    this.lastProgressSaveAt = now;
    try {
      window.localStorage.setItem(
        MusicPlayerController.PROGRESS_STORAGE_KEY,
        JSON.stringify({
          musicId: this.latestOptions.currentMusicId,
          currentTime: audio.currentTime || 0,
          wasPlaying: this.latestOptions.isPlaying,
          updatedAt: now,
        }),
      );
    } catch {
      // ignore localStorage failures
    }
  }

  private restoreProgressForCurrentTrack() {
    const audio = this.dom?.audio;
    if (!audio || !this.latestOptions?.currentMusicId) return;
    try {
      const saved = this.readNowPlayingState();
      if (!saved || saved.musicId !== this.latestOptions.currentMusicId) return;
      const savedTime = typeof saved.currentTime === "number" ? saved.currentTime : 0;
      const shouldResumePlaying = Boolean(saved.wasPlaying);
      const applyTime = () => {
        if (!this.dom?.audio) return;
        if (savedTime > 0) {
          this.dom.audio.currentTime = savedTime;
        }
        if (shouldResumePlaying) {
          this.dom.audio.play().catch(() => undefined);
        }
      };
      if (audio.readyState >= 1) {
        applyTime();
        return;
      }
      audio.addEventListener("loadedmetadata", applyTime, { once: true });
    } catch {
      // ignore localStorage failures
    }
  }

  private readNowPlayingState(): {
    musicId: number;
    currentTime: number;
    wasPlaying?: boolean;
    updatedAt?: number;
  } | null {
    try {
      const raw = window.localStorage.getItem(MusicPlayerController.PROGRESS_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<{
        musicId: number;
        currentTime: number;
        wasPlaying?: boolean;
        updatedAt?: number;
      }>;
      if (typeof parsed.musicId !== "number" || typeof parsed.currentTime !== "number") return null;
      return {
        musicId: parsed.musicId,
        currentTime: parsed.currentTime,
        wasPlaying: Boolean(parsed.wasPlaying),
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : undefined,
      };
    } catch {
      return null;
    }
  }

  private togglePanelView() {
    this.panelView = this.panelView === "player" ? "playlist" : "player";
    if (this.latestOptions) {
      this.render(this.latestOptions);
    }
  }

  private dismissPlayer() {
    this.panelView = "player";
    this.latestOptions?.onDismiss();
  }

  private getNavHeight(): number {
    const nav = document.getElementById("base_navbar");
    return nav?.getBoundingClientRect().height || 60;
  }
}

injectCssAnimation();

export const musicPlayerController = new MusicPlayerController();
