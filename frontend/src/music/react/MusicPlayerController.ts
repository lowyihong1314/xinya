import type { MusicRecord } from "./types";

type RepeatMode = "off" | "all" | "one";
type PanelView = "player" | "playlist";
type FloatingPosition = { x: number; y: number } | null;

type SyncOptions = {
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

class MusicPlayerController {
  private static readonly POSITION_STORAGE_KEY = "xinya.music.player.position";
  private static readonly PROGRESS_STORAGE_KEY = "xinya.music.player.progress";
  private root: HTMLDivElement | null = null;
  private mini: HTMLDivElement | null = null;
  private panel: HTMLDivElement | null = null;
  private panelHeader: HTMLDivElement | null = null;
  private dragHandle: HTMLDivElement | null = null;
  private cover: HTMLImageElement | null = null;
  private fallback: HTMLDivElement | null = null;
  private title: HTMLHeadingElement | null = null;
  private subtitle: HTMLParagraphElement | null = null;
  private miniTitle: HTMLDivElement | null = null;
  private miniCopy: HTMLDivElement | null = null;
  private miniCover: HTMLImageElement | null = null;
  private miniFallback: HTMLDivElement | null = null;
  private shuffleButton: HTMLSpanElement | null = null;
  private repeatButton: HTMLSpanElement | null = null;
  private prevButton: HTMLSpanElement | null = null;
  private nextButton: HTMLSpanElement | null = null;
  private miniOpenButton: HTMLButtonElement | null = null;
  private miniCloseButton: HTMLButtonElement | null = null;
  private miniMainButton: HTMLButtonElement | null = null;
  private minimizeButton: HTMLButtonElement | null = null;

  private toggleViewButton: HTMLButtonElement | null = null;
  private closeButton: HTMLButtonElement | null = null;
  private queueHint: HTMLDivElement | null = null;
  private queueView: HTMLDivElement | null = null;
  private queueList: HTMLDivElement | null = null;
  private queueEmpty: HTMLDivElement | null = null;
  private queueHeaderTitle: HTMLDivElement | null = null;
  private clearQueueButton: HTMLButtonElement | null = null;
  private playerView: HTMLDivElement | null = null;
  private audio: HTMLAudioElement | null = null;
  private latestOptions: SyncOptions | null = null;
  private lastSource: string | null = null;
  private lastAutoplayKey = 0;
  private lastProgressSaveAt = 0;
  private panelView: PanelView = "player";
  private floatingPosition: FloatingPosition = null;
  private dragState: { startX: number; startY: number; originX: number; originY: number } | null = null;

  sync(options: SyncOptions) {
    this.latestOptions = options;
    this.ensureDom();
    this.updateSource(options);
    this.syncMediaSession(options);
    this.render(options);
  }

  destroy() {
    this.detachDragListeners();
    this.root?.remove();
    this.root = null;
    this.panelView = "player";
  }

  private ensureDom() {
    if (this.root) {
      return;
    }

    this.root = document.createElement("div");
    this.root.id = "music-player-controller-root";
    this.root.className = "music-player-controller";
    this.root.style.position = "fixed";
    this.root.style.zIndex = "950";
    this.root.style.pointerEvents = "none";
    document.body.appendChild(this.root);
    this.restorePosition();

    this.mini = document.createElement("div");
    this.mini.className = "music-player-controller__mini";
    Object.assign(this.mini.style, {
      display: "none",
      position: "absolute",
      inset: "0 auto auto 0",
      width: "100%",
      pointerEvents: "auto",
      gridTemplateColumns: "minmax(0,1fr) auto auto",
      gap: "8px",
      alignItems: "center",
      padding: "10px",
      borderRadius: "20px",
      background: "linear-gradient(180deg, rgba(255,255,255,0.97), rgba(244,248,252,0.98))",
      border: "1px solid rgba(216,223,235,0.9)",
      boxShadow: "0 16px 30px rgba(15, 23, 42, 0.1)",
      transformOrigin: "top right",
      transition: "opacity 240ms cubic-bezier(0.22, 1, 0.36, 1), transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease",
      cursor: "grab",
    });
    this.mini.onmousedown = (event) => this.startDrag(event);
    this.root.appendChild(this.mini);

    this.miniMainButton = document.createElement("button");
    this.miniMainButton.type = "button";
    this.miniMainButton.className = "music-player-controller__mini-main";
    Object.assign(this.miniMainButton.style, {
      minWidth: "0",
      display: "grid",
      gridTemplateColumns: "44px minmax(0, 1fr)",
      gap: "10px",
      alignItems: "center",
      padding: "0",
      border: "none",
      background: "transparent",
      textAlign: "left",
      cursor: "pointer",
    });
    this.miniMainButton.onclick = () => this.latestOptions?.onExpand();
    this.miniMainButton.onmousedown = (event) => {
      event.stopPropagation();
    };
    this.mini.appendChild(this.miniMainButton);

    const miniArt = document.createElement("div");
    miniArt.className = "music-player-controller__mini-art";
    Object.assign(miniArt.style, {
      width: "44px",
      height: "44px",
      borderRadius: "14px",
      overflow: "hidden",
      background: "linear-gradient(160deg, rgba(15,118,110,0.16), rgba(18,52,59,0.92))",
    });
    this.miniMainButton.appendChild(miniArt);

    this.miniCover = document.createElement("img");
    this.miniCover.className = "music-player-controller__mini-cover";
    Object.assign(this.miniCover.style, { width: "100%", height: "100%", objectFit: "cover", display: "none" });
    miniArt.appendChild(this.miniCover);

    this.miniFallback = document.createElement("div");
    this.miniFallback.className = "music-player-controller__mini-fallback";
    Object.assign(this.miniFallback.style, {
      width: "100%",
      height: "100%",
      display: "grid",
      placeItems: "center",
      color: "rgba(255,255,255,0.88)",
      fontWeight: "800",
    });
    this.miniFallback.textContent = "♪";
    miniArt.appendChild(this.miniFallback);

    const miniMeta = document.createElement("div");
    miniMeta.className = "music-player-controller__mini-meta";
    Object.assign(miniMeta.style, { minWidth: "0", display: "grid", gap: "2px" });
    this.miniMainButton.appendChild(miniMeta);

    this.miniTitle = document.createElement("div");
    this.miniTitle.className = "music-player-controller__mini-title";
    Object.assign(this.miniTitle.style, {
      fontSize: "13px",
      fontWeight: "800",
      color: "var(--x-color-ink)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    miniMeta.appendChild(this.miniTitle);

    this.miniCopy = document.createElement("div");
    this.miniCopy.className = "music-player-controller__mini-copy";
    Object.assign(this.miniCopy.style, { fontSize: "12px", color: "var(--x-color-ink-muted)" });
    miniMeta.appendChild(this.miniCopy);

    this.miniOpenButton = this.makeMiniButton("chevron-down", () => this.latestOptions?.onExpand());
    this.miniOpenButton.onmousedown = (event) => {
      event.stopPropagation();
    };
    this.mini.appendChild(this.miniOpenButton);
    this.miniCloseButton = this.makeMiniButton("xmark", () => this.dismissPlayer(), true);
    this.miniCloseButton.onmousedown = (event) => {
      event.stopPropagation();
    };
    this.mini.appendChild(this.miniCloseButton);

    this.panel = document.createElement("div");
    this.panel.className = "music-player-controller__panel";
    Object.assign(this.panel.style, {
      display: "grid",
      position: "relative",
      pointerEvents: "auto",
      gap: "16px",
      padding: "18px",
      borderRadius: "28px",
      background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(238,243,249,0.96))",
      border: "1px solid rgba(216, 223, 235, 0.95)",
      boxShadow: "0 18px 42px rgba(15, 23, 42, 0.08)",
      transformOrigin: "top right",
      transition: "opacity 260ms cubic-bezier(0.22, 1, 0.36, 1), transform 260ms cubic-bezier(0.22, 1, 0.36, 1), visibility 260ms ease",
    });
    this.root.appendChild(this.panel);

    this.panelHeader = document.createElement("div");
    this.panelHeader.className = "music-player-controller__header";
    Object.assign(this.panelHeader.style, {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) auto",
      alignItems: "center",
      gap: "10px",
    });
    this.panel.appendChild(this.panelHeader);

    this.dragHandle = document.createElement("div");
    this.dragHandle.className = "music-player-controller__drag-handle";
    this.dragHandle.textContent = "播放器";
    Object.assign(this.dragHandle.style, {
      fontSize: "12px",
      fontWeight: "800",
      letterSpacing: "0.16em",
      textTransform: "uppercase",
      color: "var(--x-color-ink-muted)",
      cursor: "grab",
      userSelect: "none",
      padding: "6px 4px",
    });
    this.dragHandle.onmousedown = (event) => this.startDrag(event);
    this.panelHeader.appendChild(this.dragHandle);

    const overlayActions = document.createElement("div");
    overlayActions.className = "music-player-controller__actions";
    Object.assign(overlayActions.style, {
      display: "flex",
      justifyContent: "flex-end",
      flexWrap: "wrap",
      gap: "6px",
    });
    this.panelHeader.appendChild(overlayActions);

    this.toggleViewButton = this.makeChipButton("list-ul", () => {
      this.togglePanelView();
    });
    overlayActions.appendChild(this.toggleViewButton);
    this.minimizeButton = this.makeChipButton("minus", () => this.latestOptions?.onMinimize());
    overlayActions.appendChild(this.minimizeButton);
    this.closeButton = this.makeChipButton("xmark", () => this.dismissPlayer(), true);
    overlayActions.appendChild(this.closeButton);

    this.playerView = document.createElement("div");
    this.playerView.className = "music-player-controller__player-view";
    Object.assign(this.playerView.style, { display: "grid", gap: "16px" });
    this.panel.appendChild(this.playerView);

    const hero = document.createElement("div");
    hero.className = "music-player-controller__hero";
    Object.assign(hero.style, { display: "grid", gap: "14px" });
    this.playerView.appendChild(hero);

    const coverShell = document.createElement("div");
    coverShell.className = "music-player-controller__cover-shell";
    Object.assign(coverShell.style, {
      borderRadius: "30px",
      overflow: "hidden",
      border: "1px solid rgba(15, 118, 110, 0.18)",
      boxShadow: "0 24px 50px rgba(15, 23, 42, 0.18)",
      background: "linear-gradient(160deg, rgba(15,118,110,0.16), rgba(18,52,59,0.92))",
      aspectRatio: "1 / 1",
      display: "grid",
      placeItems: "center",
    });
    hero.appendChild(coverShell);

    this.cover = document.createElement("img");
    this.cover.className = "music-player-controller__cover";
    Object.assign(this.cover.style, { width: "100%", height: "100%", objectFit: "cover", display: "none" });
    coverShell.appendChild(this.cover);

    this.fallback = document.createElement("div");
    this.fallback.className = "music-player-controller__fallback";
    Object.assign(this.fallback.style, {
      width: "84%",
      height: "84%",
      borderRadius: "999px",
      display: "grid",
      placeItems: "center",
      background:
        "radial-gradient(circle at center, rgba(255,255,255,0.14) 0 10%, rgba(255,255,255,0.02) 11% 14%, rgba(6,18,22,0.88) 15% 56%, rgba(21,78,74,0.98) 57% 74%, rgba(245,250,252,0.22) 75% 78%, rgba(7,12,18,0.95) 79% 100%)",
      color: "white",
      fontSize: "28px",
      boxShadow: "0 18px 34px rgba(15, 23, 42, 0.22)",
    });
    this.fallback.textContent = "♪";
    coverShell.appendChild(this.fallback);

    const meta = document.createElement("div");
    meta.className = "music-player-controller__meta";
    Object.assign(meta.style, { display: "grid", gap: "8px" });
    hero.appendChild(meta);

    const eyebrow = document.createElement("div");
    eyebrow.className = "music-player-controller__eyebrow";
    eyebrow.textContent = "Now Playing";
    Object.assign(eyebrow.style, {
      fontSize: "12px",
      fontWeight: "700",
      letterSpacing: "0.18em",
      textTransform: "uppercase",
      color: "var(--x-color-accent)",
    });
    meta.appendChild(eyebrow);

    this.title = document.createElement("h2");
    this.title.className = "music-player-controller__title";
    Object.assign(this.title.style, { margin: "0", fontSize: "22px", lineHeight: "1.12", color: "var(--x-color-ink)" });
    meta.appendChild(this.title);

    this.subtitle = document.createElement("p");
    this.subtitle.className = "music-player-controller__subtitle";
    Object.assign(this.subtitle.style, { margin: "0", fontSize: "13px", color: "var(--x-color-ink-muted)" });
    meta.appendChild(this.subtitle);

    this.audio = document.createElement("audio");
    this.audio.className = "music-player-controller__audio";
    this.audio.controls = true;
    this.audio.style.width = "100%";
    this.audio.style.height = "50px";
    this.audio.style.minHeight = "50px";
    this.audio.style.maxHeight = "50px";
    this.audio.addEventListener("play", () => this.latestOptions?.onPlayStateChange(true));
    this.audio.addEventListener("pause", () => this.latestOptions?.onPlayStateChange(false));
    this.audio.addEventListener("ended", () => this.latestOptions?.onEnded());
    this.audio.addEventListener("timeupdate", () => this.persistProgress());
    this.audio.addEventListener("timeupdate", () => this.syncMediaSessionPositionState());
    this.audio.addEventListener("loadedmetadata", () => this.syncMediaSessionPositionState());
    this.audio.addEventListener("ratechange", () => this.syncMediaSessionPositionState());
    this.playerView.appendChild(this.audio);

    const actions = document.createElement("div");
    actions.className = "music-player-controller__transport";
    Object.assign(actions.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "22px",
      padding: "2px 0 4px",
    });
    this.playerView.appendChild(actions);

    this.prevButton = this.makePanelButton("backward-step", () => this.latestOptions?.onPrev());
    actions.appendChild(this.prevButton);
    this.nextButton = this.makePanelButton("forward-step", () => this.latestOptions?.onNext());
    actions.appendChild(this.nextButton);
    this.shuffleButton = this.makePanelButton("shuffle", () => this.latestOptions?.onToggleShuffle());
    actions.appendChild(this.shuffleButton);
    this.repeatButton = this.makePanelButton("repeat", () => this.latestOptions?.onCycleRepeat());
    actions.appendChild(this.repeatButton);

    this.queueHint = document.createElement("div");
    this.queueHint.className = "music-player-controller__hint";
    Object.assign(this.queueHint.style, { fontSize: "12px", color: "var(--x-color-ink-muted)" });
    this.playerView.appendChild(this.queueHint);

    this.queueView = document.createElement("div");
    this.queueView.className = "music-player-controller__queue-view";
    Object.assign(this.queueView.style, { display: "none", gap: "12px" });
    this.panel.appendChild(this.queueView);

    const queueHeader = document.createElement("div");
    queueHeader.className = "music-player-controller__queue-header";
    Object.assign(queueHeader.style, { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" });
    this.queueView.appendChild(queueHeader);

    this.queueHeaderTitle = document.createElement("div");
    this.queueHeaderTitle.className = "music-player-controller__queue-title";
    Object.assign(this.queueHeaderTitle.style, { fontSize: "14px", fontWeight: "800", color: "var(--x-color-ink)" });
    queueHeader.appendChild(this.queueHeaderTitle);

    this.clearQueueButton = document.createElement("button");
    this.clearQueueButton.type = "button";
    this.clearQueueButton.className = "music-player-controller__queue-clear";
    this.clearQueueButton.textContent = "清空";
    Object.assign(this.clearQueueButton.style, {
      border: "1px solid var(--x-color-line)",
      background: "var(--x-color-panel)",
      color: "var(--x-color-danger)",
      borderRadius: "12px",
      padding: "8px 10px",
      fontWeight: "700",
      cursor: "pointer",
    });
    this.clearQueueButton.onclick = () => this.latestOptions?.onClearQueue();
    queueHeader.appendChild(this.clearQueueButton);

    this.queueEmpty = document.createElement("div");
    this.queueEmpty.className = "music-player-controller__queue-empty";
    Object.assign(this.queueEmpty.style, {
      fontSize: "12px",
      color: "var(--x-color-ink-muted)",
      padding: "10px 0",
    });
    this.queueEmpty.textContent = "当前播放队列为空";
    this.queueView.appendChild(this.queueEmpty);

    this.queueList = document.createElement("div");
    this.queueList.className = "music-player-controller__queue-list";
    Object.assign(this.queueList.style, {
      display: "grid",
      gap: "8px",
      maxHeight: "320px",
      overflowY: "auto",
    });
    this.queueView.appendChild(this.queueList);
  }

  togglePlay() {
    if (!this.audio) return;
    if (this.audio.paused) {
      this.audio.play().catch(() => undefined);
    } else {
      this.audio.pause();
    }
  }

  seekTo(time: number) {
    if (this.audio) {
      this.audio.currentTime = time;
    }
  }

  getProgress(): number {
    return this.audio?.currentTime ?? 0;
  }

  getDuration(): number {
    return this.audio?.duration ?? 0;
  }

  private render(options: SyncOptions) {
    if (!this.root || !this.panel || !this.mini || !this.audio || !this.playerView || !this.queueView || !this.queueList || !this.queueEmpty || !this.queueHeaderTitle) {
      return;
    }

    if (options.hidden) {
      this.root.style.display = "none";
      return;
    }

    const showPlayer = Boolean(options.hasPlaybackSession && (options.currentMusic || options.queue.length));
    this.root.style.display = showPlayer ? "block" : "none";
    if (!showPlayer) {
      return;
    }

    const mobile = options.isMobile;

    this.applyRootPosition(mobile);

    this.playerView.style.display = this.panelView === "player" ? "grid" : "none";
    this.queueView.style.display = this.panelView === "playlist" ? "grid" : "none";
    if (this.toggleViewButton) {
      this.toggleViewButton.title = this.panelView === "player" ? "查看播放队列" : "查看播放器";
      this.toggleViewButton.style.color = this.panelView === "playlist" ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)";
      this.setButtonIcon(this.toggleViewButton, this.panelView === "player" ? "list-ul" : "compact-disc");
    }
    if (this.dragHandle) {
      this.dragHandle.style.cursor = this.dragState ? "grabbing" : "grab";
      this.dragHandle.textContent = this.panelView === "player" ? "播放器" : "播放队列";
    }

    const minimized = options.minimized;
    this.mini.style.display = "grid";
    Object.assign(this.panel.style, {
      opacity: minimized ? "0" : "1",
      visibility: minimized ? "hidden" : "visible",
      pointerEvents: minimized ? "none" : "auto",
      transform: minimized ? "translateY(-18px) scale(0.94)" : "translateY(0) scale(1)",
    });
    Object.assign(this.mini.style, {
      opacity: minimized ? "1" : "0",
      visibility: minimized ? "visible" : "hidden",
      pointerEvents: minimized ? "auto" : "none",
      transform: minimized ? "translateY(0) scale(1)" : "translateY(-14px) scale(0.94)",
    });
    this.mini.style.display = "grid";
    this.mini.style.cursor = this.dragState ? "grabbing" : "grab";

    if (options.currentMusic?.cover_url) {
      if (this.cover) {
        this.cover.src = options.currentMusic.cover_url;
        this.cover.alt = options.currentMusic.title;
        this.cover.style.display = "block";
      }
      if (this.fallback) this.fallback.style.display = "none";
      if (this.miniCover) {
        this.miniCover.src = options.currentMusic.cover_url;
        this.miniCover.alt = options.currentMusic.title;
        this.miniCover.style.display = "block";
      }
      if (this.miniFallback) this.miniFallback.style.display = "none";
    } else {
      if (this.cover) this.cover.style.display = "none";
      if (this.fallback) {
        this.fallback.style.display = "grid";
        this.fallback.style.animation = options.isPlaying ? "music-default-cover-spin 14s linear infinite" : "";
      }
      if (this.miniCover) this.miniCover.style.display = "none";
      if (this.miniFallback) this.miniFallback.style.display = "grid";
    }

    if (this.title) this.title.textContent = options.currentMusic?.title || "选择一首歌曲开始播放";
    if (this.subtitle) this.subtitle.textContent = options.currentMusic?.album?.name || "当前队列";
    if (this.miniTitle) this.miniTitle.textContent = options.currentMusic?.title || options.queue[0]?.title || "";
    if (this.miniCopy) this.miniCopy.textContent = options.isPlaying ? "播放中" : options.queue.length ? `${options.queue.length} 首队列` : "已暂停";

    if (this.shuffleButton) {
      this.applyToggleButton(this.shuffleButton, options.shuffleEnabled);
      this.shuffleButton.title = options.shuffleEnabled ? "随机播放中" : "随机播放";
      this.setIcon(this.shuffleButton, "shuffle");
      this.shuffleButton.style.opacity = options.hasQueue ? "1" : "0.34";
      this.shuffleButton.style.pointerEvents = options.hasQueue ? "auto" : "none";
    }
    if (this.repeatButton) {
      this.applyToggleButton(this.repeatButton, options.repeatMode !== "off");
      this.repeatButton.title = repeatButtonLabel(options.repeatMode);
      this.setIcon(this.repeatButton, repeatIconName(options.repeatMode));
    }
    if (this.prevButton) {
      this.prevButton.style.opacity = options.hasQueue ? "1" : "0.34";
      this.prevButton.style.pointerEvents = options.hasQueue ? "auto" : "none";
    }
    if (this.nextButton) {
      this.nextButton.style.opacity = options.hasQueue ? "1" : "0.34";
      this.nextButton.style.pointerEvents = options.hasQueue ? "auto" : "none";
    }
    if (this.queueHint) {
      this.queueHint.textContent = options.hasQueue
        ? `${repeatLabel(options.repeatMode)}，当前队列共 ${options.queue.length} 首。`
        : "点击歌曲会插队播放，`+列队` 会追加到末尾。";
    }

    this.queueHeaderTitle.textContent = `播放队列 · ${options.queue.length} 首`;
    this.queueEmpty.style.display = options.queue.length ? "none" : "block";
    if (this.clearQueueButton) {
      this.clearQueueButton.style.display = options.queue.length ? "inline-flex" : "none";
    }
    this.queueList.replaceChildren();
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
      const title = document.createElement("div");
      title.className = "music-player-controller__queue-play-title";
      Object.assign(title.style, {
        fontSize: "13px",
        fontWeight: "800",
        color: "var(--x-color-ink)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });
      title.textContent = music.title;
      playButton.appendChild(title);
      const meta = document.createElement("div");
      meta.className = "music-player-controller__queue-play-meta";
      Object.assign(meta.style, {
        fontSize: "12px",
        color: "var(--x-color-ink-muted)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });
      meta.textContent = music.album?.name || "未分配专辑";
      playButton.appendChild(meta);
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

      this.queueList?.appendChild(row);
    });
  }

  private updateSource(options: SyncOptions) {
    if (!this.audio) {
      return;
    }
    if (options.audioDisabled) {
      if (this.lastSource) {
        this.persistProgress();
        this.audio.pause();
        this.audio.removeAttribute("src");
        this.audio.load();
      }
      this.lastSource = null;
      return;
    }
    const nextSource = options.audioSrc;
    if (!nextSource) {
      if (this.lastSource) {
        this.persistProgress();
        this.audio.pause();
        this.audio.removeAttribute("src");
        this.audio.load();
      }
      this.lastSource = null;
      return;
    }

    const sourceChanged = nextSource !== this.lastSource;
    if (sourceChanged) {
      this.audio.src = nextSource;
      this.audio.load();
      this.lastSource = nextSource;
      this.restoreProgressForCurrentTrack();
    }

    if (options.autoplayKey !== this.lastAutoplayKey && options.autoplayKey > 0) {
      this.lastAutoplayKey = options.autoplayKey;
      window.setTimeout(() => {
        this.audio?.play().catch(() => undefined);
      }, 0);
    }
  }

  private syncMediaSession(options: SyncOptions) {
    if (!this.supportsMediaSession()) {
      return;
    }

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
          ? [
              {
                src: options.currentMusic.cover_url,
                sizes: "512x512",
                type: "image/jpeg",
              },
            ]
          : [],
        })
        : null;
    } else {
      navigator.mediaSession.metadata = null;
    }

    navigator.mediaSession.playbackState = options.isPlaying ? "playing" : "paused";
    this.syncMediaSessionPositionState();

    navigator.mediaSession.setActionHandler("play", () => {
      this.audio?.play().catch(() => undefined);
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      this.audio?.pause();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      options.onPrev();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      options.onNext();
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (!this.audio || details.seekTime == null) {
        return;
      }
      this.audio.currentTime = details.seekTime;
      this.persistProgress();
      this.syncMediaSessionPositionState();
    });
  }

  private syncMediaSessionPositionState() {
    if (!this.supportsMediaSession() || !this.audio || typeof navigator.mediaSession.setPositionState !== "function") {
      return;
    }
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
    if (!duration || duration <= 0) {
      return;
    }
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: this.audio.playbackRate || 1,
        position: Math.min(this.audio.currentTime || 0, duration),
      });
    } catch {
      // ignore unsupported position state updates
    }
  }

  private makePanelButton(iconName: string, onClick: () => void) {
    const button = document.createElement("span");
    button.setAttribute("role", "button");
    button.tabIndex = 0;
    Object.assign(button.style, {
      width: "28px",
      height: "28px",
      color: "var(--x-color-ink-muted)",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: "1",
      userSelect: "none",
      transition: "transform 160ms ease, color 160ms ease, opacity 160ms ease",
    });
    this.setIcon(button, iconName);
    button.onclick = onClick;
    button.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClick();
      }
    };
    return button;
  }

  private makeChipButton(label: string, onClick: () => void, danger = false) {
    const button = document.createElement("button");
    button.type = "button";
    Object.assign(button.style, {
      minHeight: "40px",
      minWidth: "40px",
      padding: "0",
      borderRadius: "999px",
      border: danger ? "1px solid rgba(194,65,12,0.18)" : "1px solid rgba(15,118,110,0.14)",
      background: danger ? "rgba(255,237,213,0.72)" : "rgba(15,118,110,0.08)",
      color: danger ? "var(--x-color-danger)" : "var(--x-color-ink-muted)",
      cursor: "pointer",
      transition: "color 180ms ease, transform 180ms ease, opacity 180ms ease",
      opacity: "1",
      pointerEvents: "auto",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 4px 10px rgba(15, 23, 42, 0.06)",
    });
    this.setButtonIcon(button, label);
    button.onmousedown = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    button.onpointerdown = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    };
    button.onmouseenter = () => {
      button.style.transform = "translateY(-1px)";
      button.style.background = danger ? "rgba(255,237,213,0.92)" : "rgba(15,118,110,0.14)";
      button.style.color = danger ? "var(--x-color-danger)" : "var(--x-color-accent-strong)";
    };
    button.onmouseleave = () => {
      button.style.transform = "translateY(0)";
      button.style.background = danger ? "rgba(255,237,213,0.72)" : "rgba(15,118,110,0.08)";
      button.style.color = danger ? "var(--x-color-danger)" : "var(--x-color-ink-muted)";
    };
    return button;
  }

  private makeMiniButton(label: string, onClick: () => void, danger = false) {
    const button = document.createElement("button");
    button.type = "button";
    Object.assign(button.style, {
      minHeight: "36px",
      minWidth: "36px",
      padding: "0",
      borderRadius: "12px",
      border: danger ? "1px solid rgba(194,65,12,0.18)" : "1px solid rgba(15,118,110,0.18)",
      background: danger ? "rgba(255,237,213,0.72)" : "rgba(15,118,110,0.08)",
      color: danger ? "var(--x-color-danger)" : "var(--x-color-accent-strong)",
      cursor: "pointer",
      display: "grid",
      placeItems: "center",
    });
    this.setButtonIcon(button, label);
    button.onclick = onClick;
    return button;
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

  private startDrag(event: MouseEvent) {
    if (!this.root) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const rect = this.root.getBoundingClientRect();
    this.dragState = {
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
    };
    this.attachDragListeners();
    if (this.dragHandle) {
      this.dragHandle.style.cursor = "grabbing";
    }
    if (this.mini) {
      this.mini.style.cursor = "grabbing";
    }
  }

  private onDragMove = (event: MouseEvent) => {
    if (!this.dragState || !this.root) {
      return;
    }
    const nextX = this.dragState.originX + (event.clientX - this.dragState.startX);
    const nextY = this.dragState.originY + (event.clientY - this.dragState.startY);
    const maxX = Math.max(0, window.innerWidth - this.root.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - this.root.offsetHeight);
    this.floatingPosition = {
      x: Math.min(Math.max(0, nextX), maxX),
      y: Math.min(Math.max(60, nextY), maxY),
    };
    this.applyFloatingPosition();
  };

  private onDragEnd = () => {
    if (!this.dragState) {
      return;
    }
    this.dragState = null;
    this.detachDragListeners();
    this.persistPosition();
    if (this.dragHandle) {
      this.dragHandle.style.cursor = "grab";
    }
    if (this.mini) {
      this.mini.style.cursor = "grab";
    }
  };

  private attachDragListeners() {
    window.addEventListener("mousemove", this.onDragMove);
    window.addEventListener("mouseup", this.onDragEnd);
  }

  private detachDragListeners() {
    window.removeEventListener("mousemove", this.onDragMove);
    window.removeEventListener("mouseup", this.onDragEnd);
  }

  private applyRootPosition(isMobile: boolean) {
    if (!this.root) {
      return;
    }
    const navHeight = this.getNavHeight();
    const mobileExpanded = Boolean(isMobile && this.latestOptions && !this.latestOptions.minimized);
    this.root.style.width = mobileExpanded ? "calc(100vw - 24px)" : isMobile ? "min(320px, calc(100vw - 24px))" : "340px";
    if (mobileExpanded) {
      this.root.style.left = "12px";
      this.root.style.right = "12px";
      this.root.style.top = `${navHeight + 12}px`;
      if (this.panel) {
        this.panel.style.height = `calc(100vh - ${navHeight + 24}px)`;
        this.panel.style.maxHeight = `calc(100vh - ${navHeight + 24}px)`;
        this.panel.style.borderRadius = "24px";
        this.panel.style.overflow = "auto";
      }
      return;
    }
    if (!this.floatingPosition) {
      this.root.style.left = "auto";
      this.root.style.top = `${isMobile ? navHeight + 12 : 76}px`;
      this.root.style.right = isMobile ? "12px" : "24px";
      if (this.panel) {
        if (mobileExpanded) {
          this.panel.style.height = `calc(100vh - ${navHeight + 24}px)`;
          this.panel.style.maxHeight = `calc(100vh - ${navHeight + 24}px)`;
          this.panel.style.borderRadius = "24px";
          this.panel.style.overflow = "auto";
        } else {
          this.panel.style.height = "auto";
          this.panel.style.maxHeight = "";
          this.panel.style.borderRadius = isMobile ? "22px" : "28px";
          this.panel.style.overflow = "visible";
        }
      }
      return;
    }
    if (this.panel) {
      this.panel.style.height = "auto";
      this.panel.style.maxHeight = "";
      this.panel.style.borderRadius = isMobile ? "22px" : "28px";
      this.panel.style.overflow = "visible";
    }
    this.applyFloatingPosition();
  }

  private applyFloatingPosition() {
    if (!this.root || !this.floatingPosition) {
      return;
    }
    this.root.style.left = `${this.floatingPosition.x}px`;
    this.root.style.top = `${this.floatingPosition.y}px`;
    this.root.style.right = "auto";
  }

  private persistPosition() {
    try {
      if (!this.floatingPosition) {
        window.localStorage.removeItem(MusicPlayerController.POSITION_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(
        MusicPlayerController.POSITION_STORAGE_KEY,
        JSON.stringify(this.floatingPosition),
      );
    } catch {
      // ignore localStorage failures
    }
  }

  private restorePosition() {
    try {
      const raw = window.localStorage.getItem(MusicPlayerController.POSITION_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<{ x: number; y: number }>;
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        this.floatingPosition = { x: parsed.x, y: parsed.y };
      }
    } catch {
      this.floatingPosition = null;
    }
  }

  private persistProgress() {
    if (!this.audio || !this.latestOptions?.currentMusicId) {
      return;
    }
    const now = Date.now();
    if (now - this.lastProgressSaveAt < 800) {
      return;
    }
    this.lastProgressSaveAt = now;
    try {
      window.localStorage.setItem(
        MusicPlayerController.PROGRESS_STORAGE_KEY,
        JSON.stringify({
          musicId: this.latestOptions.currentMusicId,
          currentTime: this.audio.currentTime || 0,
          wasPlaying: this.latestOptions.isPlaying,
          updatedAt: now,
        }),
      );
    } catch {
      // ignore localStorage failures
    }
  }

  private restoreProgressForCurrentTrack() {
    if (!this.audio || !this.latestOptions?.currentMusicId) {
      return;
    }
    try {
      const saved = this.readNowPlayingState();
      if (!saved || saved.musicId !== this.latestOptions.currentMusicId) {
        return;
      }
      const savedTime = typeof saved.currentTime === "number" ? saved.currentTime : 0;
      const shouldResumePlaying = Boolean(saved.wasPlaying);
      const applyTime = () => {
        if (!this.audio) {
          return;
        }
        if (savedTime > 0) {
          this.audio.currentTime = savedTime;
        }
        if (shouldResumePlaying) {
          this.audio.play().catch(() => undefined);
        }
      };
      if (this.audio.readyState >= 1) {
        applyTime();
        return;
      }
      this.audio.addEventListener("loadedmetadata", applyTime, { once: true });
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
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<{
        musicId: number;
        currentTime: number;
        wasPlaying?: boolean;
        updatedAt?: number;
      }>;
      if (typeof parsed.musicId !== "number" || typeof parsed.currentTime !== "number") {
        return null;
      }
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

  private getNavHeight() {
    const nav = document.getElementById("base_navbar");
    return nav?.getBoundingClientRect().height || 60;
  }

  private supportsMediaSession() {
    return typeof navigator !== "undefined" && "mediaSession" in navigator;
  }

  private supportsMediaMetadata() {
    return typeof window !== "undefined" && "MediaMetadata" in window;
  }

  private applyToggleButton(button: HTMLSpanElement, active: boolean) {
    button.style.color = active ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)";
  }

  private setIcon(button: HTMLElement, iconName: string) {
    button.replaceChildren();
    const icon = document.createElement("i");
    icon.className = `fa-solid fa-${iconName}`;
    icon.setAttribute("aria-hidden", "true");
    icon.style.fontSize = "18px";
    button.appendChild(icon);
  }

  private setButtonIcon(button: HTMLButtonElement, iconName: string) {
    button.replaceChildren();
    const icon = document.createElement("i");
    icon.className = `fa-solid fa-${iconName}`;
    icon.setAttribute("aria-hidden", "true");
    icon.style.fontSize = "15px";
    button.appendChild(icon);
  }
}

function repeatLabel(repeatMode: RepeatMode) {
  if (repeatMode === "one") return "单曲循环";
  if (repeatMode === "all") return "列表循环";
  return "循环关闭";
}

function repeatButtonLabel(repeatMode: RepeatMode) {
  if (repeatMode === "one") return "单曲循环";
  if (repeatMode === "all") return "列表循环";
  return "循环关闭";
}

function repeatIconName(repeatMode: RepeatMode) {
  if (repeatMode === "one") return "repeat-1";
  return "repeat";
}

export const musicPlayerController = new MusicPlayerController();

if (typeof document !== "undefined" && !document.getElementById("music-default-cover-spin")) {
  const style = document.createElement("style");
  style.id = "music-default-cover-spin";
  style.textContent = `
    @keyframes music-default-cover-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}
