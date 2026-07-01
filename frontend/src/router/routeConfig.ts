import { CHANGYOU_PATH, MUSIC_PLAYER_PATH, MUSIC_ROOT_PATH } from "../music/router/paths";

export type RouteKey =
  | "home"
  | "info"
  | "CRM"
  | "profile"
  | "fileSystem"
  | "music"
  | "login"
  | "lamp_registration"
  | "event_detail";

export type NavItem = {
  key: RouteKey;
  title: string;
  icon: string;
  auth: boolean;
  path: string;
};

export const NAV_ITEMS: NavItem[] = [
  { key: "home", title: "首页", icon: "fa-solid fa-house", auth: false, path: "/" },
  { key: "info", title: "简介", icon: "fas fa-info-circle", auth: false, path: "/info/history" },
  { key: "CRM", title: "CRM 管理", icon: "fas fa-layer-group", auth: true, path: "/crm" },
  // { key: "fileSystem", title: "文件管理", icon: "fas fa-folder", auth: true, path: "/files" },
  { key: "music", title: "音乐", icon: "fas fa-music", auth: true, path: MUSIC_PLAYER_PATH },
  { key: "login", title: "登录", icon: "fas fa-right-to-bracket", auth: false, path: "/login" },
  { key: "profile", title: "用户资料", icon: "fas fa-user", auth: true, path: "/profile" },
];

export const legacyPageToPath: Record<string, string> = {
  home: "/",
  info: "/info/history",
  CRM: "/crm",
  profile: "/profile",
  fileSystem: "/files",
  music: MUSIC_PLAYER_PATH,
  changyou: CHANGYOU_PATH,
  login: "/login",
  lamp_registration: "/lamp-registration",
};

export function resolveLegacyPath(page: string, searchParams: URLSearchParams) {
  if (page === "event_detail") {
    const eventId = searchParams.get("event_id");
    return eventId ? `/event/${eventId}` : "/not-found?reason=missing-event-id";
  }
  if (page === "image_detail") {
    const imageId = searchParams.get("image_id");
    return imageId ? `/image/${imageId}` : "/not-found?reason=missing-image-id";
  }
  if (page === "lamp_registration") {
    return "/lamp-registration";
  }
  return legacyPageToPath[page] ?? "/not-found";
}

export function pageKeyFromPath(pathname: string) {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/info")) return "info";
  if (pathname.startsWith("/crm")) return "CRM";
  if (pathname.startsWith("/profile")) return "profile";
  if (pathname.startsWith("/files")) return "fileSystem";
  if (pathname.startsWith(MUSIC_ROOT_PATH)) return "music";
  if (pathname.startsWith("/lamp-registration")) return "lamp_registration";
  if (pathname.startsWith("/event/")) return "event_detail";
  if (pathname.startsWith("/login")) return "login";
  return null;
}
