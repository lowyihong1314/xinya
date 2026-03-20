export type RouteKey =
  | "home"
  | "info"
  | "CRM"
  | "profile"
  | "fileSystem"
  | "music"
  | "login"
  | "lamp_registration"
  | "event_detail"
  | "image_detail";

export type NavItem = {
  key: RouteKey;
  title: string;
  icon: string;
  auth: boolean;
  modal?: boolean;
  path: string;
};

export const NAV_ITEMS: NavItem[] = [
  { key: "home", title: "首页", icon: "fa-solid fa-house", auth: false, path: "/" },
  { key: "info", title: "简介", icon: "fas fa-info-circle", auth: false, path: "/info" },
  { key: "CRM", title: "CRM 管理", icon: "fas fa-layer-group", auth: true, path: "/crm" },
  { key: "profile", title: "用户资料", icon: "fas fa-user", auth: true, path: "/profile" },
  // { key: "fileSystem", title: "文件管理", icon: "fas fa-folder", auth: true, path: "/files" },
  { key: "music", title: "音乐播放器", icon: "fas fa-music", auth: true, path: "/music" },
  { key: "login", title: "登录", icon: "fas fa-right-to-bracket", auth: false, modal: true, path: "/login" },
];

export const legacyPageToPath: Record<string, string> = {
  home: "/",
  info: "/info",
  CRM: "/crm",
  profile: "/profile",
  fileSystem: "/files",
  music: "/music",
  login: "/login",
  lamp_registration: "/lamp-registration",
};

export function pageKeyFromPath(pathname: string) {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/info")) return "info";
  if (pathname.startsWith("/crm")) return "CRM";
  if (pathname.startsWith("/profile")) return "profile";
  if (pathname.startsWith("/files")) return "fileSystem";
  if (pathname.startsWith("/music")) return "music";
  if (pathname.startsWith("/lamp-registration")) return "lamp_registration";
  if (pathname.startsWith("/event/")) return "event_detail";
  if (pathname.startsWith("/image/")) return "image_detail";
  if (pathname.startsWith("/login")) return "login";
  return null;
}
