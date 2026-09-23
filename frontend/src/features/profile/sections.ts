/**
 * 资料页的五个分节。**与旧版对齐**（原 src/profile/react/ProfilePage.tsx
 * 的 SECTION_ITEMS）—— label 与 hint 一字未改。
 */
export const PROFILE_SECTIONS = [
  { key: "profile", label: "资料", hint: "个人 · 账号 · 转账" },
  { key: "membership", label: "会员", hint: "Membership" },
  { key: "email", label: "邮件", hint: "Email" },
  { key: "journey", label: "足迹", hint: "My journey" },
  { key: "app", label: "下载 App", hint: "Download" },
] as const;

export type ProfileSectionKey = (typeof PROFILE_SECTIONS)[number]["key"];

export const DEFAULT_SECTION: ProfileSectionKey = "profile";

export function isProfileSection(value: string | undefined): value is ProfileSectionKey {
  return PROFILE_SECTIONS.some((s) => s.key === value);
}
