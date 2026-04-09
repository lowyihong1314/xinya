import type { CSSProperties, ReactNode } from "react";

import { MobileMusicSectionNav, type MusicPlaybackSection, type MusicSectionTab } from "./MobileMusicSectionNav";

export function MobileMusicShell({
  activeSection,
  onSectionChange,
  sectionTabs,
  browsePane,
  playerPane,
  queuePane,
  historyPane,
}: {
  activeSection: MusicPlaybackSection;
  onSectionChange: (section: MusicPlaybackSection) => void;
  sectionTabs: MusicSectionTab[];
  browsePane: ReactNode;
  playerPane: ReactNode;
  queuePane: ReactNode;
  historyPane?: ReactNode;
}) {
  return (
    <div style={mobileShellStyle}>
      <div style={mobileViewportStyle}>
        <div style={panelMountStyle(activeSection === "browse")}>{browsePane}</div>
        <div style={panelMountStyle(activeSection === "player")}>{playerPane}</div>
        <div style={panelMountStyle(activeSection === "queue")}>{queuePane}</div>
        {historyPane ? <div style={panelMountStyle(activeSection === "history")}>{historyPane}</div> : null}
      </div>

      <MobileMusicSectionNav
        sectionTabs={sectionTabs}
        activeSection={activeSection}
        onSectionChange={onSectionChange}
      />
    </div>
  );
}

const mobileShellStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  minWidth: 0,
};

const mobileViewportStyle: CSSProperties = {
  minWidth: 0,
  paddingBottom: "calc(78px + env(safe-area-inset-bottom, 0px))",
};

function panelMountStyle(active: boolean): CSSProperties {
  return {
    display: active ? "block" : "none",
  };
}
