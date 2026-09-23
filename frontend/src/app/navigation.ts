/**
 * 主导航。**唯一**定义处，AppShell 和移动端抽屉都读它。
 *
 * 分组是给人看的心智模型，不是技术边界：
 *   我的     —— 跟"我"有关的（资料、邮箱）
 *   活动     —— 活动、相册、表单报名
 *   法务财务 —— 报销、总账、资产、法会
 *   共修     —— 歌本、唱游、音乐
 *   管理     —— 用户、权限、文件、CCTV
 *
 * `permission` 填后端权限名（backend/core/permissions.py 里的常量）。
 * 填了就只有有该权限的人看得见这一项 —— 看得见但点进去 403 是最差的体验。
 * 不填 = 所有登录用户可见。
 */
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Camera,
  FileText,
  FolderTree,
  Image,
  Mail,
  Music,
  Receipt,
  Users,
  UserCircle,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** 需要的权限（满足其一即可）。不填 = 所有登录用户可见。 */
  anyOf?: readonly string[];
}

export interface NavGroup {
  title: string;
  items: readonly NavItem[];
}

export const NAV: readonly NavGroup[] = [
  {
    title: "我的",
    items: [
      { to: "/profile", label: "我的资料", icon: UserCircle },
      { to: "/email", label: "公司邮箱", icon: Mail },
    ],
  },
  {
    title: "活动",
    items: [
      { to: "/events", label: "活动", icon: Image },
      { to: "/forms", label: "表单报名", icon: FileText },
    ],
  },
  {
    title: "法务财务",
    items: [
      { to: "/claims", label: "报销", icon: Receipt, anyOf: ["account_read", "account_edit", "account_submit_claim"] },
      // 总账只认 account_read / account_edit —— 后端 gl/permissions.py 的 user_can_read_gl
      // 不认 account_submit_claim。写上它的话，只有报销提交权限的人看得见菜单、
      // 点进去每条 /gl/* 都 403。
      { to: "/ledger", label: "总账", icon: BookOpen, anyOf: ["account_read", "account_edit"] },
      { to: "/assets", label: "资产", icon: FolderTree, anyOf: ["asset_read", "asset_edit"] },
    ],
  },
  {
    title: "共修",
    items: [
      { to: "/music/songbook", label: "歌本", icon: BookOpen },
      { to: "/music", label: "音乐", icon: Music },
    ],
  },
  {
    title: "管理",
    items: [
      { to: "/users", label: "用户与权限", icon: Users, anyOf: ["department", "department_edit", "permission", "permission_edit"] },
      { to: "/cctv", label: "监控", icon: Camera, anyOf: ["cctv"] },
    ],
  },
] as const;
