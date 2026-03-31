import type { RepeatMode } from "./types";

export function repeatLabel(repeatMode: RepeatMode): string {
  if (repeatMode === "one") return "单曲循环";
  if (repeatMode === "all") return "列表循环";
  return "循环关闭";
}

export function repeatButtonLabel(repeatMode: RepeatMode): string {
  if (repeatMode === "one") return "单曲循环";
  if (repeatMode === "all") return "列表循环";
  return "循环关闭";
}

export function repeatIconName(repeatMode: RepeatMode): string {
  if (repeatMode === "one") return "repeat-1";
  return "repeat";
}

export function injectCssAnimation(): void {
  if (typeof document === "undefined" || document.getElementById("music-default-cover-spin")) {
    return;
  }
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
