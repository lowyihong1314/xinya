import type { CSSProperties } from "react";

export type MusicPlaybackSection = "browse" | "player" | "queue" | "history";

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
    gap: "8px",
    padding: "8px 12px calc(8px + env(safe-area-inset-bottom, 0px))",
    background: "linear-gradient(180deg, rgba(238,243,249,0.76), rgba(255,255,255,0.98))",
    borderTop: "1px solid var(--x-color-line)",
    backdropFilter: "blur(18px)",
    boxShadow: "0 -10px 30px var(--x-color-shadow-soft)",
  };
}

function mobileTabButtonStyle(active: boolean): CSSProperties {
  return {
    position: "relative",
    minHeight: "54px",
    display: "grid",
    placeItems: "center",
    padding: 0,
    border: "none",
    borderRadius: "16px",
    background: active ? "var(--x-color-panel)" : "transparent",
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)",
    cursor: "pointer",
  };
}

function tabIconShellStyle(active: boolean): CSSProperties {
  return {
    width: "40px",
    height: "40px",
    borderRadius: "14px",
    display: "grid",
    placeItems: "center",
    background: active ? "var(--x-color-accent-soft)" : "rgba(246,248,252,0.96)",
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)",
    fontSize: "14px",
  };
}

const mobileTabCountStyle: CSSProperties = {
  position: "absolute",
  top: "8px",
  right: "12px",
  minWidth: "18px",
  height: "18px",
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
