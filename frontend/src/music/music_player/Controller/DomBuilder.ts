import type { SyncOptions } from "./types";

export interface DomRefs {
  root: HTMLDivElement;
  mini: HTMLDivElement;
  panel: HTMLDivElement;
  panelHeader: HTMLDivElement;
  dragHandle: HTMLDivElement;
  cover: HTMLImageElement;
  fallback: HTMLDivElement;
  title: HTMLHeadingElement;
  subtitle: HTMLParagraphElement;
  miniTitle: HTMLDivElement;
  miniCopy: HTMLDivElement;
  miniCover: HTMLImageElement;
  miniFallback: HTMLDivElement;
  shuffleButton: HTMLSpanElement;
  repeatButton: HTMLSpanElement;
  prevButton: HTMLSpanElement;
  nextButton: HTMLSpanElement;
  miniOpenButton: HTMLButtonElement;
  miniCloseButton: HTMLButtonElement;
  miniMainButton: HTMLButtonElement;
  minimizeButton: HTMLButtonElement;
  toggleViewButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  queueHint: HTMLDivElement;
  queueView: HTMLDivElement;
  queueList: HTMLDivElement;
  queueEmpty: HTMLDivElement;
  queueHeaderTitle: HTMLDivElement;
  clearQueueButton: HTMLButtonElement;
  playerView: HTMLDivElement;
  audio: HTMLAudioElement;
}

function setIcon(button: HTMLElement, iconName: string): void {
  button.replaceChildren();
  const icon = document.createElement("i");
  icon.className = `fa-solid fa-${iconName}`;
  icon.setAttribute("aria-hidden", "true");
  icon.style.fontSize = "18px";
  button.appendChild(icon);
}

function setButtonIcon(button: HTMLButtonElement, iconName: string): void {
  button.replaceChildren();
  const icon = document.createElement("i");
  icon.className = `fa-solid fa-${iconName}`;
  icon.setAttribute("aria-hidden", "true");
  icon.style.fontSize = "15px";
  button.appendChild(icon);
}

function makePanelButton(iconName: string, onClick: () => void): HTMLSpanElement {
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
  setIcon(button, iconName);
  button.onclick = onClick;
  button.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };
  return button;
}

function makeChipButton(label: string, onClick: () => void, danger = false): HTMLButtonElement {
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
  setButtonIcon(button, label);
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

function makeMiniButton(label: string, onClick: () => void, danger = false): HTMLButtonElement {
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
  setButtonIcon(button, label);
  button.onclick = onClick;
  return button;
}

export function buildPlayerDom(
  getOptions: () => SyncOptions | null,
  onStartDrag: (event: MouseEvent) => void,
  onTogglePanelView: () => void,
  onDismissPlayer: () => void,
  onPersistProgress: () => void,
  onSyncMediaSessionPositionState: () => void,
): DomRefs {
  const root = document.createElement("div");
  root.id = "music-player-controller-root";
  root.className = "music-player-controller";
  root.style.position = "fixed";
  root.style.zIndex = "950";
  root.style.pointerEvents = "none";
  document.body.appendChild(root);

  // --- Mini bar ---
  const mini = document.createElement("div");
  mini.className = "music-player-controller__mini";
  Object.assign(mini.style, {
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
  mini.onmousedown = (event) => onStartDrag(event);
  root.appendChild(mini);

  const miniMainButton = document.createElement("button");
  miniMainButton.type = "button";
  miniMainButton.className = "music-player-controller__mini-main";
  Object.assign(miniMainButton.style, {
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
  miniMainButton.onclick = () => getOptions()?.onExpand();
  miniMainButton.onmousedown = (event) => { event.stopPropagation(); };
  mini.appendChild(miniMainButton);

  const miniArt = document.createElement("div");
  miniArt.className = "music-player-controller__mini-art";
  Object.assign(miniArt.style, {
    width: "44px",
    height: "44px",
    borderRadius: "14px",
    overflow: "hidden",
    background: "linear-gradient(160deg, rgba(15,118,110,0.16), rgba(18,52,59,0.92))",
  });
  miniMainButton.appendChild(miniArt);

  const miniCover = document.createElement("img");
  miniCover.className = "music-player-controller__mini-cover";
  Object.assign(miniCover.style, { width: "100%", height: "100%", objectFit: "cover", display: "none" });
  miniArt.appendChild(miniCover);

  const miniFallback = document.createElement("div");
  miniFallback.className = "music-player-controller__mini-fallback";
  Object.assign(miniFallback.style, {
    width: "100%",
    height: "100%",
    display: "grid",
    placeItems: "center",
    color: "rgba(255,255,255,0.88)",
    fontWeight: "800",
  });
  miniFallback.textContent = "♪";
  miniArt.appendChild(miniFallback);

  const miniMeta = document.createElement("div");
  miniMeta.className = "music-player-controller__mini-meta";
  Object.assign(miniMeta.style, { minWidth: "0", display: "grid", gap: "2px" });
  miniMainButton.appendChild(miniMeta);

  const miniTitle = document.createElement("div");
  miniTitle.className = "music-player-controller__mini-title";
  Object.assign(miniTitle.style, {
    fontSize: "13px",
    fontWeight: "800",
    color: "var(--x-color-ink)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  });
  miniMeta.appendChild(miniTitle);

  const miniCopy = document.createElement("div");
  miniCopy.className = "music-player-controller__mini-copy";
  Object.assign(miniCopy.style, { fontSize: "12px", color: "var(--x-color-ink-muted)" });
  miniMeta.appendChild(miniCopy);

  const miniOpenButton = makeMiniButton("chevron-down", () => getOptions()?.onExpand());
  miniOpenButton.onmousedown = (event) => { event.stopPropagation(); };
  mini.appendChild(miniOpenButton);

  const miniCloseButton = makeMiniButton("xmark", () => onDismissPlayer(), true);
  miniCloseButton.onmousedown = (event) => { event.stopPropagation(); };
  mini.appendChild(miniCloseButton);

  // --- Full panel ---
  const panel = document.createElement("div");
  panel.className = "music-player-controller__panel";
  Object.assign(panel.style, {
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
  root.appendChild(panel);

  const panelHeader = document.createElement("div");
  panelHeader.className = "music-player-controller__header";
  Object.assign(panelHeader.style, {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    gap: "10px",
  });
  panel.appendChild(panelHeader);

  const dragHandle = document.createElement("div");
  dragHandle.className = "music-player-controller__drag-handle";
  dragHandle.textContent = "播放器";
  Object.assign(dragHandle.style, {
    fontSize: "12px",
    fontWeight: "800",
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    color: "var(--x-color-ink-muted)",
    cursor: "grab",
    userSelect: "none",
    padding: "6px 4px",
  });
  dragHandle.onmousedown = (event) => onStartDrag(event);
  panelHeader.appendChild(dragHandle);

  const overlayActions = document.createElement("div");
  overlayActions.className = "music-player-controller__actions";
  Object.assign(overlayActions.style, {
    display: "flex",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: "6px",
  });
  panelHeader.appendChild(overlayActions);

  const toggleViewButton = makeChipButton("list-ul", () => onTogglePanelView());
  overlayActions.appendChild(toggleViewButton);
  const minimizeButton = makeChipButton("minus", () => getOptions()?.onMinimize());
  overlayActions.appendChild(minimizeButton);
  const closeButton = makeChipButton("xmark", () => onDismissPlayer(), true);
  overlayActions.appendChild(closeButton);

  // --- Player view ---
  const playerView = document.createElement("div");
  playerView.className = "music-player-controller__player-view";
  Object.assign(playerView.style, { display: "grid", gap: "16px" });
  panel.appendChild(playerView);

  const hero = document.createElement("div");
  hero.className = "music-player-controller__hero";
  Object.assign(hero.style, { display: "grid", gap: "14px" });
  playerView.appendChild(hero);

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

  const cover = document.createElement("img");
  cover.className = "music-player-controller__cover";
  Object.assign(cover.style, { width: "100%", height: "100%", objectFit: "cover", display: "none" });
  coverShell.appendChild(cover);

  const fallback = document.createElement("div");
  fallback.className = "music-player-controller__fallback";
  Object.assign(fallback.style, {
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
  fallback.textContent = "♪";
  coverShell.appendChild(fallback);

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

  const title = document.createElement("h2");
  title.className = "music-player-controller__title";
  Object.assign(title.style, { margin: "0", fontSize: "22px", lineHeight: "1.12", color: "var(--x-color-ink)" });
  meta.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.className = "music-player-controller__subtitle";
  Object.assign(subtitle.style, { margin: "0", fontSize: "13px", color: "var(--x-color-ink-muted)" });
  meta.appendChild(subtitle);

  const audio = document.createElement("audio");
  audio.className = "music-player-controller__audio";
  audio.controls = true;
  audio.style.width = "100%";
  audio.style.height = "50px";
  audio.style.minHeight = "50px";
  audio.style.maxHeight = "50px";
  audio.addEventListener("play", () => getOptions()?.onPlayStateChange(true));
  audio.addEventListener("pause", () => getOptions()?.onPlayStateChange(false));
  audio.addEventListener("ended", () => getOptions()?.onEnded());
  audio.addEventListener("timeupdate", () => onPersistProgress());
  audio.addEventListener("timeupdate", () => onSyncMediaSessionPositionState());
  audio.addEventListener("loadedmetadata", () => onSyncMediaSessionPositionState());
  audio.addEventListener("ratechange", () => onSyncMediaSessionPositionState());
  playerView.appendChild(audio);

  const actions = document.createElement("div");
  actions.className = "music-player-controller__transport";
  Object.assign(actions.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "22px",
    padding: "2px 0 4px",
  });
  playerView.appendChild(actions);

  const prevButton = makePanelButton("backward-step", () => getOptions()?.onPrev());
  actions.appendChild(prevButton);
  const nextButton = makePanelButton("forward-step", () => getOptions()?.onNext());
  actions.appendChild(nextButton);
  const shuffleButton = makePanelButton("shuffle", () => getOptions()?.onToggleShuffle());
  actions.appendChild(shuffleButton);
  const repeatButton = makePanelButton("repeat", () => getOptions()?.onCycleRepeat());
  actions.appendChild(repeatButton);

  const queueHint = document.createElement("div");
  queueHint.className = "music-player-controller__hint";
  Object.assign(queueHint.style, { fontSize: "12px", color: "var(--x-color-ink-muted)" });
  playerView.appendChild(queueHint);

  // --- Queue view ---
  const queueView = document.createElement("div");
  queueView.className = "music-player-controller__queue-view";
  Object.assign(queueView.style, { display: "none", gap: "12px" });
  panel.appendChild(queueView);

  const queueHeader = document.createElement("div");
  queueHeader.className = "music-player-controller__queue-header";
  Object.assign(queueHeader.style, { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" });
  queueView.appendChild(queueHeader);

  const queueHeaderTitle = document.createElement("div");
  queueHeaderTitle.className = "music-player-controller__queue-title";
  Object.assign(queueHeaderTitle.style, { fontSize: "14px", fontWeight: "800", color: "var(--x-color-ink)" });
  queueHeader.appendChild(queueHeaderTitle);

  const clearQueueButton = document.createElement("button");
  clearQueueButton.type = "button";
  clearQueueButton.className = "music-player-controller__queue-clear";
  clearQueueButton.textContent = "清空";
  Object.assign(clearQueueButton.style, {
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-danger)",
    borderRadius: "12px",
    padding: "8px 10px",
    fontWeight: "700",
    cursor: "pointer",
  });
  clearQueueButton.onclick = () => getOptions()?.onClearQueue();
  queueHeader.appendChild(clearQueueButton);

  const queueEmpty = document.createElement("div");
  queueEmpty.className = "music-player-controller__queue-empty";
  Object.assign(queueEmpty.style, {
    fontSize: "12px",
    color: "var(--x-color-ink-muted)",
    padding: "10px 0",
  });
  queueEmpty.textContent = "当前播放队列为空";
  queueView.appendChild(queueEmpty);

  const queueList = document.createElement("div");
  queueList.className = "music-player-controller__queue-list";
  Object.assign(queueList.style, {
    display: "grid",
    gap: "8px",
    maxHeight: "320px",
    overflowY: "auto",
  });
  queueView.appendChild(queueList);

  return {
    root, mini, panel, panelHeader, dragHandle,
    cover, fallback, title, subtitle,
    miniTitle, miniCopy, miniCover, miniFallback,
    shuffleButton, repeatButton, prevButton, nextButton,
    miniOpenButton, miniCloseButton, miniMainButton, minimizeButton,
    toggleViewButton, closeButton,
    queueHint, queueView, queueList, queueEmpty, queueHeaderTitle, clearQueueButton,
    playerView, audio,
  };
}

export { setIcon, setButtonIcon };
