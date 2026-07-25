import { useInsertionEffect } from "react";

const STYLE_ID = "xinya-design-tokens";

export const designTokens = {
  colors: {
    ink: "#1d2433",
    inkMuted: "#5d6678",
    line: "#d8dfeb",
    lineSoft: "rgba(216, 223, 235, 0.9)",
    canvas: "#eef3f9",
    canvasAlt: "#e7edf4",
    panel: "#ffffff",
    panelAlt: "#f6f8fc",
    panelGlass: "rgba(255, 255, 255, 0.88)",
    panelStrong: "rgba(255, 255, 255, 0.92)",
    panelStrongest: "rgba(255, 255, 255, 0.96)",
    accent: "#0f766e",
    accentStrong: "#115e59",
    accentSoft: "#d9f3ef",
    accentTint: "rgba(15, 118, 110, 0.1)",
    accentTintStrong: "rgba(15, 118, 110, 0.12)",
    accentBorder: "rgba(15, 118, 110, 0.24)",
    danger: "#c2410c",
    dangerSoft: "#ffedd5",
    dangerBorder: "rgba(194, 65, 12, 0.24)",
    warning: "#d97706",
    warningSoft: "#fef3c7",
    warningTint: "rgba(255, 237, 213, 0.7)",
    warningBorder: "rgba(217, 119, 6, 0.16)",
    success: "#15803d",
    successSoft: "#dcfce7",
    successStrong: "#2ecc71",
    info: "#1d4ed8",
    infoSoft: "#dbeafe",
    infoTint: "rgba(29, 78, 216, 0.08)",
    infoTintStrong: "rgba(29, 78, 216, 0.16)",
    navStart: "#12343b",
    navEnd: "#0f766e",
    shadow: "rgba(15, 23, 42, 0.14)",
    shadowSoft: "rgba(15, 23, 42, 0.06)",
    shadowMedium: "rgba(15, 23, 42, 0.08)",
    shadowStrong: "rgba(15, 23, 42, 0.1)",
  },
  radius: {
    sm: "10px",
    md: "16px",
    lg: "24px",
  },
  fonts: {
    // 保留衬线标题（结构性改进，非配色）
    sans: '"Avenir Next", "Segoe UI", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif',
    serif: '"Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", "SimSun", serif',
    mono: '"IBM Plex Mono", "SFMono-Regular", monospace',
  },
};

export function ensureDesignTokens() {
  if (typeof document === "undefined") {
    return;
  }

  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    :root {
      --x-color-ink: ${designTokens.colors.ink};
      --x-color-ink-muted: ${designTokens.colors.inkMuted};
      --x-color-line: ${designTokens.colors.line};
      --x-color-line-soft: ${designTokens.colors.lineSoft};
      --x-color-canvas: ${designTokens.colors.canvas};
      --x-color-canvas-alt: ${designTokens.colors.canvasAlt};
      --x-color-panel: ${designTokens.colors.panel};
      --x-color-panel-alt: ${designTokens.colors.panelAlt};
      --x-color-panel-glass: ${designTokens.colors.panelGlass};
      --x-color-panel-strong: ${designTokens.colors.panelStrong};
      --x-color-panel-strongest: ${designTokens.colors.panelStrongest};
      --x-color-accent: ${designTokens.colors.accent};
      --x-color-accent-strong: ${designTokens.colors.accentStrong};
      --x-color-accent-soft: ${designTokens.colors.accentSoft};
      --x-color-accent-tint: ${designTokens.colors.accentTint};
      --x-color-accent-tint-strong: ${designTokens.colors.accentTintStrong};
      --x-color-accent-border: ${designTokens.colors.accentBorder};
      --x-color-danger: ${designTokens.colors.danger};
      --x-color-danger-soft: ${designTokens.colors.dangerSoft};
      --x-color-danger-border: ${designTokens.colors.dangerBorder};
      --x-color-warning: ${designTokens.colors.warning};
      --x-color-warning-soft: ${designTokens.colors.warningSoft};
      --x-color-warning-tint: ${designTokens.colors.warningTint};
      --x-color-warning-border: ${designTokens.colors.warningBorder};
      --x-color-success: ${designTokens.colors.success};
      --x-color-success-soft: ${designTokens.colors.successSoft};
      --x-color-success-strong: ${designTokens.colors.successStrong};
      --x-color-info: ${designTokens.colors.info};
      --x-color-info-soft: ${designTokens.colors.infoSoft};
      --x-color-info-tint: ${designTokens.colors.infoTint};
      --x-color-info-tint-strong: ${designTokens.colors.infoTintStrong};
      --x-color-nav-start: ${designTokens.colors.navStart};
      --x-color-nav-end: ${designTokens.colors.navEnd};
      --x-color-shadow: ${designTokens.colors.shadow};
      --x-color-shadow-soft: ${designTokens.colors.shadowSoft};
      --x-color-shadow-medium: ${designTokens.colors.shadowMedium};
      --x-color-shadow-strong: ${designTokens.colors.shadowStrong};
      --x-radius-sm: ${designTokens.radius.sm};
      --x-radius-md: ${designTokens.radius.md};
      --x-radius-lg: ${designTokens.radius.lg};
      --x-font-sans: ${designTokens.fonts.sans};
      --x-font-serif: ${designTokens.fonts.serif};
      --x-font-mono: ${designTokens.fonts.mono};
    }
  `;
  document.head.appendChild(style);
}

export function useEnsureDesignTokens() {
  useInsertionEffect(() => {
    ensureDesignTokens();
  }, []);
}
