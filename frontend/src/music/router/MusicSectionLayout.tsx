import type { CSSProperties } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { ensureDesignTokens } from "../../theme/designTokens";
import { CHANGYOU_PATH, MUSIC_PLAYER_PATH } from "./paths";

const SECTION_ITEMS = [
  {
    key: "music_player",
    title: "Music",
    icon: "fas fa-music",
    path: MUSIC_PLAYER_PATH,
    end: true,
  },
  {
    key: "changyou",
    title: "Changyou",
    icon: "fas fa-microphone-lines",
    path: CHANGYOU_PATH,
    end: false,
  },
] as const;

export function MusicSectionLayout() {
  ensureDesignTokens();

  return (
    <>
      <nav style={sectionNavbarStyle}>
        <div style={sectionNavbarInnerStyle}>
          {SECTION_ITEMS.map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              end={item.end}
              title={item.title}
              aria-label={item.title}
              style={({ isActive }) => sectionNavButtonStyle(isActive)}
            >
              <i className={item.icon} />
            </NavLink>
          ))}
        </div>
      </nav>

      <Outlet />
    </>
  );
}

const sectionNavbarStyle: CSSProperties = {
  height: "56px",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "0 24px",
  background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
  position: "sticky",
  top: "60px",
  zIndex: 900,
};

const sectionNavbarInnerStyle: CSSProperties = {
  width: "min(1360px, 100%)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: "12px",
};

function sectionNavButtonStyle(active: boolean): CSSProperties {
  return {
    width: "42px",
    height: "42px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    color: "white",
    borderRadius: "10px",
    fontSize: "18px",
    cursor: "pointer",
    userSelect: "none",
    transition: "background 0.2s, transform 0.1s",
    border: "none",
    background: active ? "rgba(255,255,255,0.32)" : "transparent",
    textDecoration: "none",
  };
}
