import type { CSSProperties } from "react";

type MusicPlaybackSection = "browse" | "player" | "queue" | "history";

type MusicSectionTab = {
  key: MusicPlaybackSection;
  label: string;
  iconClassName: string;
  count?: number;
};

export function DesktopMusicSectionSidebar({
  sectionTabs,
  activeSection,
  onSectionChange,
  currentMusicTitle,
  isPlaying,
  stickyTop,
  viewportHeight,
}: {
  sectionTabs: MusicSectionTab[];
  activeSection: MusicPlaybackSection;
  onSectionChange: (section: MusicPlaybackSection) => void;
  currentMusicTitle: string | null;
  isPlaying: boolean;
  stickyTop: number;
  viewportHeight: number | null;
}) {
  return (
    <aside style={sidebarStickyStyle(stickyTop, viewportHeight)}>
      <section style={sidebarShellStyle(viewportHeight)}>
        <div style={tabbarCopyStyle}>
          <div style={tabbarEyebrowStyle}>Control Panel</div>
          <div style={tabbarTitleStyle}>佛曲资料库</div>
          <div style={tabbarMetaStyle}>
            {currentMusicTitle
              ? `${currentMusicTitle}${isPlaying ? " · 播放中" : ""}`
              : "找歌、播放、列队都在这里切换"}
          </div>
        </div>

        <nav style={tabbarNavStyle}>
          {sectionTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              style={tabButtonStyle(activeSection === tab.key)}
              onClick={() => onSectionChange(tab.key)}
            >
              <span style={tabIconShellStyle(activeSection === tab.key)}>
                <i className={tab.iconClassName} />
              </span>
              <span style={tabTextWrapStyle}>{tab.label}</span>
              {tab.count ? <span style={tabCountStyle}>{tab.count}</span> : null}
            </button>
          ))}
        </nav>
      </section>
    </aside>
  );
}

function resolveViewportHeight(viewportHeight: number | null) {
  return viewportHeight ? `${viewportHeight}px` : "calc(100vh - 108px)";
}

function sidebarStickyStyle(stickyTop: number, viewportHeight: number | null): CSSProperties {
  return {
    position: "sticky",
    top: `${stickyTop}px`,
    height: resolveViewportHeight(viewportHeight),
    minHeight: resolveViewportHeight(viewportHeight),
  };
}

function sidebarShellStyle(viewportHeight: number | null): CSSProperties {
  return {
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    gap: "16px",
    height: "100%",
    minHeight: resolveViewportHeight(viewportHeight),
    padding: "18px",
    borderRadius: "24px",
    background:
      "linear-gradient(180deg, rgba(18,52,59,0.98), rgba(15,118,110,0.95) 46%, rgba(12,22,38,0.98) 100%)",
    color: "white",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 24px 52px rgba(15, 23, 42, 0.2)",
    overflow: "hidden",
  };
}

const tabbarCopyStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: "4px",
};

const tabbarEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "rgba(209,250,229,0.92)",
  fontWeight: 800,
};

const tabbarTitleStyle: CSSProperties = {
  fontSize: "22px",
  fontWeight: 800,
  color: "white",
};

const tabbarMetaStyle: CSSProperties = {
  fontSize: "12px",
  color: "rgba(230,244,248,0.76)",
  lineHeight: 1.5,
};

const tabbarNavStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  alignContent: "start",
  overflowY: "auto",
  paddingRight: "4px",
};

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    width: "100%",
    display: "grid",
    gridTemplateColumns: "44px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: "10px",
    minHeight: "52px",
    padding: "10px 12px",
    borderRadius: "16px",
    border: active ? "1px solid rgba(255,255,255,0.16)" : "1px solid rgba(255,255,255,0.06)",
    background: active ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.04)",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "left",
    backdropFilter: "blur(12px)",
  };
}

function tabIconShellStyle(active: boolean): CSSProperties {
  return {
    width: "36px",
    height: "36px",
    borderRadius: "12px",
    display: "grid",
    placeItems: "center",
    background: active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)",
    color: "white",
    fontSize: "14px",
  };
}

const tabTextWrapStyle: CSSProperties = {
  minWidth: 0,
  fontSize: "15px",
  fontWeight: 800,
  color: "white",
};

const tabCountStyle: CSSProperties = {
  minWidth: "20px",
  height: "20px",
  display: "grid",
  placeItems: "center",
  padding: "0 6px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.14)",
  color: "white",
  fontSize: "12px",
};
