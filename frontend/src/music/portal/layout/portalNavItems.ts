import { CHANGYOU_PATH, MUSIC_PLAYER_PATH, TURNTABLE_PATH } from "../../router/paths";

export type PortalNavKey = "music_player" | "changyou" | "turntable";

export type PortalNavItem = {
  key: PortalNavKey;
  title: string;
  icon: string;
  path: string;
};

export const PORTAL_ITEMS: PortalNavItem[] = [
  {
    key: "music_player",
    title: "音乐",
    icon: "fas fa-music",
    path: MUSIC_PLAYER_PATH,
  },
  {
    key: "changyou",
    title: "唱游",
    icon: "fas fa-microphone-lines",
    path: CHANGYOU_PATH,
  },
  {
    key: "turntable",
    title: "转盘",
    icon: "fas fa-record-vinyl",
    path: TURNTABLE_PATH,
  },
];
