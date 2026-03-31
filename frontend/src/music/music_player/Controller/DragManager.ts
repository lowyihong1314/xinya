import type { FloatingPosition } from "./types";

interface DragRefs {
  root: HTMLDivElement;
  dragHandle: HTMLDivElement | null;
  mini: HTMLDivElement | null;
  panel: HTMLDivElement | null;
}

export class DragManager {
  static readonly POSITION_STORAGE_KEY = "xinya.music.player.position";

  private floatingPosition: FloatingPosition = null;
  private dragState: { startX: number; startY: number; originX: number; originY: number } | null = null;
  private refs: DragRefs | null = null;

  setRefs(refs: DragRefs): void {
    this.refs = refs;
  }

  getFloatingPosition(): FloatingPosition {
    return this.floatingPosition;
  }

  startDrag(event: MouseEvent): void {
    const root = this.refs?.root;
    if (!root) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = root.getBoundingClientRect();
    this.dragState = {
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
    };
    this.attachDragListeners();
    if (this.refs?.dragHandle) {
      this.refs.dragHandle.style.cursor = "grabbing";
    }
    if (this.refs?.mini) {
      this.refs.mini.style.cursor = "grabbing";
    }
  }

  private onDragMove = (event: MouseEvent): void => {
    const root = this.refs?.root;
    if (!this.dragState || !root) return;
    const nextX = this.dragState.originX + (event.clientX - this.dragState.startX);
    const nextY = this.dragState.originY + (event.clientY - this.dragState.startY);
    const maxX = Math.max(0, window.innerWidth - root.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - root.offsetHeight);
    this.floatingPosition = {
      x: Math.min(Math.max(0, nextX), maxX),
      y: Math.min(Math.max(60, nextY), maxY),
    };
    this.applyFloatingPosition();
  };

  private onDragEnd = (): void => {
    if (!this.dragState) return;
    this.dragState = null;
    this.detachDragListeners();
    this.persistPosition();
    if (this.refs?.dragHandle) {
      this.refs.dragHandle.style.cursor = "grab";
    }
    if (this.refs?.mini) {
      this.refs.mini.style.cursor = "grab";
    }
  };

  private attachDragListeners(): void {
    window.addEventListener("mousemove", this.onDragMove);
    window.addEventListener("mouseup", this.onDragEnd);
  }

  detachDragListeners(): void {
    window.removeEventListener("mousemove", this.onDragMove);
    window.removeEventListener("mouseup", this.onDragEnd);
  }

  applyRootPosition(
    isMobile: boolean,
    minimized: boolean,
    getNavHeight: () => number,
  ): void {
    const root = this.refs?.root;
    const panel = this.refs?.panel;
    if (!root) return;

    const navHeight = getNavHeight();
    const mobileExpanded = Boolean(isMobile && !minimized);
    root.style.width = mobileExpanded ? "calc(100vw - 24px)" : isMobile ? "min(320px, calc(100vw - 24px))" : "340px";

    if (mobileExpanded) {
      root.style.left = "12px";
      root.style.right = "12px";
      root.style.top = `${navHeight + 12}px`;
      if (panel) {
        panel.style.height = `calc(100vh - ${navHeight + 24}px)`;
        panel.style.maxHeight = `calc(100vh - ${navHeight + 24}px)`;
        panel.style.borderRadius = "24px";
        panel.style.overflow = "auto";
      }
      return;
    }

    if (!this.floatingPosition) {
      root.style.left = "auto";
      root.style.top = `${isMobile ? navHeight + 12 : 76}px`;
      root.style.right = isMobile ? "12px" : "24px";
      if (panel) {
        panel.style.height = "auto";
        panel.style.maxHeight = "";
        panel.style.borderRadius = isMobile ? "22px" : "28px";
        panel.style.overflow = "visible";
      }
      return;
    }

    if (panel) {
      panel.style.height = "auto";
      panel.style.maxHeight = "";
      panel.style.borderRadius = isMobile ? "22px" : "28px";
      panel.style.overflow = "visible";
    }
    this.applyFloatingPosition();
  }

  applyFloatingPosition(): void {
    const root = this.refs?.root;
    if (!root || !this.floatingPosition) return;
    root.style.left = `${this.floatingPosition.x}px`;
    root.style.top = `${this.floatingPosition.y}px`;
    root.style.right = "auto";
  }

  persistPosition(): void {
    try {
      if (!this.floatingPosition) {
        window.localStorage.removeItem(DragManager.POSITION_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(
        DragManager.POSITION_STORAGE_KEY,
        JSON.stringify(this.floatingPosition),
      );
    } catch {
      // ignore localStorage failures
    }
  }

  restorePosition(): void {
    try {
      const raw = window.localStorage.getItem(DragManager.POSITION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<{ x: number; y: number }>;
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        this.floatingPosition = { x: parsed.x, y: parsed.y };
      }
    } catch {
      this.floatingPosition = null;
    }
  }

  isDragging(): boolean {
    return this.dragState !== null;
  }
}
