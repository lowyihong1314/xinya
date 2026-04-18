import type { CSSProperties } from "react";

import { designTokens } from "../../../../theme/designTokens";

export const musicPlayerLightThemeStyle = {
  colorScheme: "light",
  accentColor: designTokens.colors.accent,
  color: "var(--x-color-ink)",
  backgroundColor: "var(--x-color-canvas)",
  "--bg-color": designTokens.colors.panel,
  "--text-color": designTokens.colors.ink,
  "--nav-bg-color": designTokens.colors.panelAlt,
  "--nav-link-color": designTokens.colors.inkMuted,
  "--nav-link-hover-color": designTokens.colors.accent,
  "--border-color": designTokens.colors.line,
  "--username-color": designTokens.colors.inkMuted,
  "--ping-color": designTokens.colors.inkMuted,
  "--notify-bg-color": designTokens.colors.panel,
  "--notify-text-color": designTokens.colors.ink,
  "--notify-border-color": designTokens.colors.line,
  "--notify-close-hover-bg": designTokens.colors.panelAlt,
  "--save-button-bg": designTokens.colors.success,
  "--save-button-bg-hover": designTokens.colors.successStrong,
  "--edit-button-bg": designTokens.colors.info,
  "--edit-button-bg-hover": designTokens.colors.info,
  "--delete-button-bg": designTokens.colors.danger,
  "--delete-button-bg-hover": designTokens.colors.danger,
  "--button-text-color": "#ffffff",
  "--title-color": designTokens.colors.accentStrong,
  "--title-color-right": designTokens.colors.accent,
  "--clear-button-color": "rgba(255, 255, 255, 0.55)",
} as CSSProperties;
