/**
 * 主导航。**与旧版对齐**：一条 60px 的居中图标条，**没有侧栏**。
 *
 * 旧版长这样（src/router/routeConfig.ts + AppLayout.tsx）：
 *   · 60px 高、渐变底、position sticky
 *   · 居中排列的 46px 方形图标按钮，激活态是 rgba(255,255,255,0.32) 白底
 *   · 只有 5 项：首页 / 简介 / CRM / 音乐 / 用户资料
 *   · CRM 是**聚合入口** —— 点进去是一页磁贴，再分到各个子模块
 *   · 进音乐模块时整条导航**换成音乐的几项** + 一个「返回主导航」按钮
 *
 * 为什么是聚合而不是把 17 个模块全摊在导航条上：图标条容不下，
 * 而且大多数模块是低频的管理功能，每天用的就那几个。
 */
import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Coins,
  FileText,
  FolderTree,
  Guitar,
  Home,
  IdCard,
  Images,
  Info,
  Layers,
  LogIn,
  Music,
  HandHeart,
  QrCode,
  Table,
  UserCircle,
  Users,
  Video,
} from "lucide-react";

export interface NavItem {
  key: string;
  /** 鼠标悬停的提示，也是无障碍标签 —— 图标条上没有文字 */
  title: string;
  icon: LucideIcon;
  to: string;
  /** true = 只有登录后才显示 */
  auth: boolean;
  /** 需要的权限（满足其一）。不填 = 登录即可见。 */
  anyOf?: readonly string[];
}

/** 主导航条。顺序与旧版一致。 */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "home", title: "首页", icon: Home, to: "/", auth: false },
  { key: "about", title: "简介", icon: Info, to: "/about", auth: false },
  { key: "crm", title: "CRM 管理", icon: Layers, to: "/crm", auth: true },
  { key: "music", title: "音乐", icon: Music, to: "/music", auth: true },
  { key: "login", title: "登录", icon: LogIn, to: "/login", auth: false },
  { key: "profile", title: "用户资料", icon: UserCircle, to: "/profile", auth: true },
] as const;

/**
 * 音乐模块内的导航。旧版在 /music 下时整条导航条会换成这几项，
 * 末尾加一个「返回主导航」按钮跳回进来之前的页面。
 */
export const MUSIC_NAV_ITEMS: readonly NavItem[] = [
  { key: "music_player", title: "音乐", icon: Music, to: "/music", auth: true },
  { key: "songbook", title: "歌本", icon: Guitar, to: "/music/songbook", auth: true },
  { key: "changyou", title: "唱游", icon: QrCode, to: "/music/rooms", auth: true },
] as const;

/** 进入音乐模块的路径前缀 —— 导航条据此切换。 */
export const MUSIC_ROOT = "/music";

// ─────────────────────────── CRM 聚合页 ───────────────────────────

export interface CrmModule {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  /** 需要的权限（满足其一）。不填 = 登录即可见。 */
  anyOf?: readonly string[];
}

/**
 * CRM 聚合页的磁贴。标题与描述沿用旧版（src/CRM/react/crmModules.ts）——
 * 那些文案用户已经认得，不要"顺手优化"。
 *
 * 还没搬到新前端的模块暂时不列，搬一个加一个。
 */
export const CRM_MODULES: readonly CrmModule[] = [
  {
    key: "user_control",
    title: "用户与部门",
    description: "用户名片与部门/权限维护。",
    icon: Users,
    to: "/users",
    anyOf: ["department", "department_edit", "permission", "permission_edit"],
  },
  {
    key: "event_table",
    title: "创建活动",
    description: "查看和管理活动主表数据。",
    icon: Table,
    to: "/events",
    anyOf: ["event_edit"],
  },
  {
    key: "finance",
    title: "财务",
    description: "报销与财务审批工作台。",
    icon: Coins,
    to: "/claims",
    anyOf: ["account_read", "account_edit", "account_submit_claim"],
  },
  {
    key: "ledger",
    title: "总账",
    description: "会计科目、凭证与过账。",
    icon: FileText,
    to: "/ledger",
    anyOf: ["account_read", "account_edit"],
  },
  {
    key: "asset",
    title: "资产库存",
    description: "仓库、库存、单据与库存流水。",
    icon: Boxes,
    to: "/assets",
    anyOf: ["asset_read", "asset_edit"],
  },
  {
    key: "register",
    title: "报名表格",
    description: "特别活动报名、注册与记录查询。",
    icon: IdCard,
    to: "/forms",
    anyOf: ["form_read", "form_edit"],
  },
  {
    key: "dharma_event",
    title: "法会",
    description: "YLP 盂兰盆法会与 LAMP 点灯法会管理。",
    icon: HandHeart,
    to: "/fahui",
    anyOf: ["fahui_read"],
  },
  {
    key: "files",
    title: "文件系统",
    description: "文件浏览、上传、权限和回收站管理。",
    icon: FolderTree,
    to: "/files",
  },
  {
    key: "songbook",
    title: "唱游歌簿",
    description: "管理唱游使用的歌词与 chord 歌簿。",
    icon: Guitar,
    to: "/music/songbook",
    anyOf: ["music_edit"],
  },
  {
    key: "cctv",
    title: "监控",
    description: "直播监控与 PTZ 控制入口。",
    icon: Video,
    to: "/cctv",
    anyOf: ["cctv"],
  },
  {
    key: "email",
    title: "公司邮箱",
    description: "用 {用户名}@utba.my 收发邮件。",
    icon: Images,
    to: "/email",
  },
] as const;
