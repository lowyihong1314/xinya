import type { CSSProperties } from "react";

export type MusicPlaybackSection = "browse" | "player" | "queue" | "playlists" | "history";

export type MusicSectionTab = {
  key: MusicPlaybackSection;
  label: string;
  iconClassName: string;
  count?: number;
};

export function MobileMusicSectionNav({
  sectionTabs,
  activeSection,
  onSectionChange,
}: {
  sectionTabs: MusicSectionTab[];
  activeSection: MusicPlaybackSection;
  onSectionChange: (section: MusicPlaybackSection) => void;
}) {
  return (
    <nav style={mobileBottomNavStyle(sectionTabs.length)}>
      {sectionTabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-label={tab.label}
          title={tab.label}
          style={mobileTabButtonStyle(activeSection === tab.key)}
          onClick={() => onSectionChange(tab.key)}
        >
          <span style={tabIconShellStyle(activeSection === tab.key)}>
            <i className={tab.iconClassName} />
          </span>
          {tab.count ? <span style={mobileTabCountStyle}>{tab.count}</span> : null}
        </button>
      ))}
    </nav>
  );
}

function mobileBottomNavStyle(columnCount: number): CSSProperties {
  return {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    display: "grid",
    gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
    gap: "4px",
    padding: "0 8px env(safe-area-inset-bottom, 0px)",
    background: "linear-gradient(180deg, var(--x-color-panel-glass), var(--x-color-panel-strong))",
    borderTop: "1px solid var(--x-color-line)",
    backdropFilter: "blur(18px)",
    boxShadow: "0 -10px 30px var(--x-color-shadow)",
  };
}

function mobileTabButtonStyle(active: boolean): CSSProperties {
  return {
    position: "relative",
    minHeight: "44px",
    display: "grid",
    placeItems: "center",
    padding: 0,
    border: "none",
    borderRadius: "12px",
    background: active ? "var(--x-color-panel)" : "transparent",
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)",
    cursor: "pointer",
  };
}

function tabIconShellStyle(active: boolean): CSSProperties {
  return {
    width: "34px",
    height: "34px",
    borderRadius: "11px",
    display: "grid",
    placeItems: "center",
    background: active ? "var(--x-color-accent-soft)" : "var(--x-color-panel-alt)",
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)",
    fontSize: "14px",
    boxShadow: active ? "0 10px 20px var(--x-color-shadow-soft)" : "none",
  };
}

const mobileTabCountStyle: CSSProperties = {
  position: "absolute",
  top: "3px",
  right: "10px",
  minWidth: "16px",
  height: "16px",
  display: "grid",
  placeItems: "center",
  padding: "0 5px",
  borderRadius: "999px",
  background: "var(--x-color-accent)",
  color: "white",
  fontSize: "11px",
  fontWeight: 700,
  lineHeight: 1,
};
